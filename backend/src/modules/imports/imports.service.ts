import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import * as XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

import { ImportFile, ImportFileStatus } from '../../entities/import-file.entity';
import { Contact } from '../../entities/contact.entity';
import { Company } from '../../entities/company.entity';
import { normalizePhone } from '../../common/utils/phone.util';

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);
  private readonly uploadDir: string;

  constructor(
    @InjectRepository(ImportFile)
    private readonly importFileRepository: Repository<ImportFile>,
    @InjectRepository(Contact)
    private readonly contactRepository: Repository<Contact>,
    @InjectRepository(Company)
    private readonly companyRepository: Repository<Company>,
    private readonly configService: ConfigService,
    @InjectQueue('import-process')
    private readonly importQueue: Queue,
  ) {
    this.uploadDir = path.resolve(
      this.configService.get<string>('UPLOAD_DIR', './uploads'),
    );
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async upload(
    file: Express.Multer.File,
    userId: string,
  ): Promise<ImportFile> {
    try {
      const ext = path.extname(file.originalname).toLowerCase();
      const allowedExtensions = ['.csv', '.xlsx', '.xls'];

      if (!allowedExtensions.includes(ext)) {
        throw new BadRequestException(
          `Invalid file type. Allowed: ${allowedExtensions.join(', ')}`,
        );
      }

      const uniqueFilename = `${uuidv4()}${ext}`;
      const filePath = path.join(this.uploadDir, uniqueFilename);

      fs.writeFileSync(filePath, file.buffer);

      const importFile = this.importFileRepository.create({
        filename: uniqueFilename,
        original_filename: file.originalname,
        file_size: file.size,
        mime_type: file.mimetype,
        status: ImportFileStatus.UPLOADED,
        imported_by: userId,
      });

      const saved = await this.importFileRepository.save(importFile);

      const rows = this.parseFile(filePath, file.mimetype);
      const totalRows = rows.length > 0 ? rows.length - 1 : 0;

      saved.total_rows = totalRows;
      await this.importFileRepository.save(saved);

      return saved;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.logger.error(`Failed to upload file: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to upload file');
    }
  }

  async getPreview(
    importFileId: string,
  ): Promise<{ headers: string[]; rows: any[]; totalRows: number }> {
    try {
      const importFile = await this.findById(importFileId);
      const filePath = path.join(this.uploadDir, importFile.filename);

      if (!fs.existsSync(filePath)) {
        throw new NotFoundException('Uploaded file not found on disk');
      }

      const allRows = this.parseFile(filePath, importFile.mime_type);

      if (allRows.length === 0) {
        return { headers: [], rows: [], totalRows: 0 };
      }

      const headers: string[] = allRows[0].map((h: any) => String(h));
      const dataRows = allRows.slice(1, 11).map((row: any[]) => {
        const obj: Record<string, any> = {};
        headers.forEach((header, idx) => {
          obj[header] = row[idx] !== undefined ? row[idx] : null;
        });
        return obj;
      });

      return {
        headers,
        rows: dataRows,
        totalRows: importFile.total_rows,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.logger.error(
        `Failed to get preview: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException('Failed to generate preview');
    }
  }

  async setColumnMapping(
    importFileId: string,
    mapping: Record<string, string>,
  ): Promise<ImportFile> {
    try {
      const importFile = await this.findById(importFileId);

      if (
        importFile.status !== ImportFileStatus.UPLOADED &&
        importFile.status !== ImportFileStatus.MAPPED
      ) {
        throw new BadRequestException(
          `Cannot set column mapping when status is '${importFile.status}'`,
        );
      }

      importFile.column_mapping = mapping;
      importFile.status = ImportFileStatus.MAPPED;

      return await this.importFileRepository.save(importFile);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.logger.error(
        `Failed to set column mapping: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException('Failed to set column mapping');
    }
  }

  async validate(importFileId: string): Promise<void> {
    try {
      const importFile = await this.findById(importFileId);

      if (importFile.status !== ImportFileStatus.MAPPED) {
        throw new BadRequestException(
          `Cannot validate when status is '${importFile.status}'. Column mapping must be set first.`,
        );
      }

      importFile.status = ImportFileStatus.VALIDATING;
      await this.importFileRepository.save(importFile);

      await this.importQueue.add('process', {
        importFileId,
        action: 'validate',
      });
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.logger.error(
        `Failed to queue validation: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException('Failed to queue validation');
    }
  }

  async getValidationReport(importFileId: string): Promise<{
    id: string;
    status: ImportFileStatus;
    total_rows: number;
    valid_rows: number;
    duplicate_rows: number;
    error_rows: number;
    errors: Record<string, any> | null;
  }> {
    try {
      const importFile = await this.findById(importFileId);

      return {
        id: importFile.id,
        status: importFile.status,
        total_rows: importFile.total_rows,
        valid_rows: importFile.valid_rows,
        duplicate_rows: importFile.duplicate_rows,
        error_rows: importFile.error_rows,
        errors: importFile.errors,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to get validation report: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        'Failed to get validation report',
      );
    }
  }

  async execute(importFileId: string): Promise<void> {
    try {
      const importFile = await this.findById(importFileId);

      // Import may be executed straight after mapping, or after an optional
      // validation pass (which returns the record to MAPPED). Both are valid.
      if (importFile.status !== ImportFileStatus.MAPPED) {
        throw new BadRequestException(
          `Cannot execute import when status is '${importFile.status}'. Column mapping must be set first.`,
        );
      }

      importFile.status = ImportFileStatus.IMPORTING;
      await this.importFileRepository.save(importFile);

      await this.importQueue.add('process', {
        importFileId,
        action: 'execute',
      });
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.logger.error(
        `Failed to queue execution: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException('Failed to queue import execution');
    }
  }

  async findAll(userId?: string): Promise<ImportFile[]> {
    try {
      const where = userId ? { imported_by: userId } : {};
      return await this.importFileRepository.find({
        where,
        order: { created_at: 'DESC' },
      });
    } catch (error) {
      this.logger.error(
        `Failed to fetch import files: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException('Failed to fetch import files');
    }
  }

  async findById(id: string): Promise<ImportFile> {
    try {
      const importFile = await this.importFileRepository.findOne({
        where: { id },
      });

      if (!importFile) {
        throw new NotFoundException(`Import file with ID '${id}' not found`);
      }

      return importFile;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to find import file: ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException('Failed to find import file');
    }
  }

  /**
   * Resolve the absolute path of an uploaded file.
   * Exposed so the worker uses the exact same directory as the upload step
   * (UPLOAD_DIR aware) instead of assuming './uploads' relative to cwd.
   */
  getUploadPath(filename: string): string {
    return path.join(this.uploadDir, filename);
  }

  parseFile(filePath: string, mimeType: string): any[][] {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.xlsx' || ext === '.xls') {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data: any[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
      });
      return data;
    }

    if (ext === '.csv') {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const records: any[][] = parse(fileContent, {
        relax_column_count: true,
        skip_empty_lines: true,
      });
      return records;
    }

    throw new BadRequestException(`Unsupported file type: ${ext}`);
  }

  normalizeAndValidateRow(
    row: Record<string, any>,
    mapping: Record<string, string>,
  ): { valid: boolean; data: Record<string, any>; errors: string[] } {
    const errors: string[] = [];
    const data: Record<string, any> = {};

    for (const [fileColumn, entityField] of Object.entries(mapping)) {
      const rawValue = row[fileColumn];
      data[entityField] = rawValue !== undefined && rawValue !== ''
        ? String(rawValue).trim()
        : null;
    }

    if (data['whatsapp_number']) {
      const normalized = normalizePhone(data['whatsapp_number']);
      if (normalized) {
        data['whatsapp_number'] = normalized;
      } else {
        errors.push(
          `Invalid WhatsApp number: '${data['whatsapp_number']}'`,
        );
      }
    } else {
      errors.push('WhatsApp number is required');
    }

    if (!data['name'] || String(data['name']).trim() === '') {
      errors.push('Name is required');
    }

    return {
      valid: errors.length === 0,
      data,
      errors,
    };
  }
}
