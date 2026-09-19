import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';

import { ImportFile, ImportFileStatus } from '../../entities/import-file.entity';
import { Contact } from '../../entities/contact.entity';
import { Company } from '../../entities/company.entity';
import { ImportsService } from './imports.service';
@Processor('import-process')
export class ImportsProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportsProcessor.name);

  constructor(
    @InjectRepository(ImportFile)
    private readonly importFileRepository: Repository<ImportFile>,
    @InjectRepository(Contact)
    private readonly contactRepository: Repository<Contact>,
    @InjectRepository(Company)
    private readonly companyRepository: Repository<Company>,
    private readonly importsService: ImportsService,
  ) {
    super();
  }

  async process(job: Job<{ importFileId: string; action: string }>): Promise<void> {
    const { importFileId, action } = job.data;
    this.logger.log(`Processing job ${job.id}: action=${action}, importFileId=${importFileId}`);

    try {
      if (action === 'validate') {
        await this.handleValidation(importFileId);
      } else if (action === 'execute') {
        await this.handleExecution(importFileId);
      } else {
        this.logger.warn(`Unknown action: ${action}`);
      }
    } catch (error) {
      this.logger.error(
        `Job ${job.id} failed: ${error.message}`,
        error.stack,
      );

      await this.importFileRepository.update(importFileId, {
        status: ImportFileStatus.FAILED,
        errors: { message: error.message, stack: error.stack },
      });

      throw error;
    }
  }

  private async handleValidation(importFileId: string): Promise<void> {
    const importFile = await this.importFileRepository.findOne({
      where: { id: importFileId },
    });

    if (!importFile) {
      throw new Error(`Import file ${importFileId} not found`);
    }

    if (!importFile.column_mapping) {
      throw new Error('Column mapping is not set');
    }

    const filePath = this.importsService.getUploadPath(importFile.filename);
    const allRows = this.importsService.parseFile(filePath, importFile.mime_type);

    if (allRows.length < 2) {
      await this.importFileRepository.update(importFileId, {
        valid_rows: 0,
        duplicate_rows: 0,
        error_rows: 0,
        errors: { rows: [] },
        status: ImportFileStatus.MAPPED,
      });
      return;
    }

    const headers: string[] = allRows[0].map((h: any) => String(h));
    const dataRows = allRows.slice(1);

    let validRows = 0;
    let duplicateRows = 0;
    let errorRows = 0;
    const rowErrors: { row: number; errors: string[] }[] = [];
    const seenNumbers = new Set<string>();

    for (let i = 0; i < dataRows.length; i++) {
      const rawRow: Record<string, any> = {};
      headers.forEach((header, idx) => {
        rawRow[header] = dataRows[i][idx] !== undefined ? dataRows[i][idx] : null;
      });

      const result = this.importsService.normalizeAndValidateRow(
        rawRow,
        importFile.column_mapping,
      );

      if (!result.valid) {
        errorRows++;
        rowErrors.push({ row: i + 2, errors: result.errors });
        continue;
      }

      const whatsappNumber = result.data['whatsapp_number'];

      if (seenNumbers.has(whatsappNumber)) {
        duplicateRows++;
        rowErrors.push({
          row: i + 2,
          errors: [`Duplicate WhatsApp number in file: ${whatsappNumber}`],
        });
        continue;
      }
      seenNumbers.add(whatsappNumber);

      const existingContact = await this.contactRepository.findOne({
        where: { whatsapp_number: whatsappNumber },
      });

      if (existingContact) {
        duplicateRows++;
        rowErrors.push({
          row: i + 2,
          errors: [`WhatsApp number already exists in database: ${whatsappNumber}`],
        });
        continue;
      }

      validRows++;
    }

    await this.importFileRepository.update(importFileId, {
      valid_rows: validRows,
      duplicate_rows: duplicateRows,
      error_rows: errorRows,
      errors: { rows: rowErrors },
      status: ImportFileStatus.MAPPED,
    });

    this.logger.log(
      `Validation complete for ${importFileId}: valid=${validRows}, duplicates=${duplicateRows}, errors=${errorRows}`,
    );
  }

  private async handleExecution(importFileId: string): Promise<void> {
    const importFile = await this.importFileRepository.findOne({
      where: { id: importFileId },
    });

    if (!importFile) {
      throw new Error(`Import file ${importFileId} not found`);
    }

    if (!importFile.column_mapping) {
      throw new Error('Column mapping is not set');
    }

    const filePath = this.importsService.getUploadPath(importFile.filename);
    const allRows = this.importsService.parseFile(filePath, importFile.mime_type);

    if (allRows.length < 2) {
      await this.importFileRepository.update(importFileId, {
        valid_rows: 0,
        duplicate_rows: 0,
        error_rows: 0,
        status: ImportFileStatus.COMPLETED,
        completed_at: new Date(),
      });
      return;
    }

    const headers: string[] = allRows[0].map((h: any) => String(h));
    const dataRows = allRows.slice(1);

    let validRows = 0;
    let duplicateRows = 0;
    let errorRows = 0;
    const rowErrors: { row: number; errors: string[] }[] = [];

    const BATCH_SIZE = 100;

    for (let batchStart = 0; batchStart < dataRows.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, dataRows.length);
      const batch = dataRows.slice(batchStart, batchEnd);

      for (let i = 0; i < batch.length; i++) {
        const rowIndex = batchStart + i;
        const rawRow: Record<string, any> = {};
        headers.forEach((header, idx) => {
          rawRow[header] = batch[i][idx] !== undefined ? batch[i][idx] : null;
        });

        const result = this.importsService.normalizeAndValidateRow(
          rawRow,
          importFile.column_mapping,
        );

        if (!result.valid) {
          errorRows++;
          rowErrors.push({ row: rowIndex + 2, errors: result.errors });
          continue;
        }

        const whatsappNumber = result.data['whatsapp_number'];

        const existingContact = await this.contactRepository.findOne({
          where: { whatsapp_number: whatsappNumber },
        });

        if (existingContact) {
          duplicateRows++;
          continue;
        }

        let companyId: string | null = null;

        // Company fields live on the Company entity, not Contact. Pull them out
        // of the row data before it is spread into the contact.
        const companyName = result.data['company_name']
          ? String(result.data['company_name']).trim()
          : null;
        const country = result.data['country'] ?? null;
        const city = result.data['city'] ?? null;
        const agencyType = result.data['agency_type'] ?? null;

        delete result.data['company_name'];
        delete result.data['country'];
        delete result.data['city'];
        delete result.data['agency_type'];

        if (companyName) {
          let company = await this.companyRepository.findOne({
            where: { name: companyName },
          });

          if (!company) {
            company = this.companyRepository.create({
              name: companyName,
              country,
              city,
              agency_type: agencyType,
              source: 'csv_import',
            });
            company = await this.companyRepository.save(company);
          }

          companyId = company.id;
        }

        const contact = this.contactRepository.create({
          ...result.data,
          company_id: companyId,
          import_file_id: importFileId,
          source: result.data['source'] || 'csv_import',
        });

        try {
          await this.contactRepository.save(contact);
          validRows++;
        } catch (err) {
          // A unique-violation here means a concurrent insert beat us to it.
          errorRows++;
          rowErrors.push({
            row: rowIndex + 2,
            errors: [(err as Error).message],
          });
        }
      }
    }

    await this.importFileRepository.update(importFileId, {
      valid_rows: validRows,
      duplicate_rows: duplicateRows,
      error_rows: errorRows,
      errors: rowErrors.length > 0 ? { rows: rowErrors } : null,
      status: ImportFileStatus.COMPLETED,
      completed_at: new Date(),
    });

    this.logger.log(
      `Import execution complete for ${importFileId}: valid=${validRows}, duplicates=${duplicateRows}, errors=${errorRows}`,
    );
  }
}
