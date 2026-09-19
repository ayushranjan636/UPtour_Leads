import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { extname } from 'path';

import { ImportsService } from './imports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

/** MIME types browsers and tools use for CSV/Excel uploads. */
const ALLOWED_MIMES = new Set([
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Many clients (including curl on macOS and some browsers) do not know the
  // CSV/XLSX mime type and fall back to a generic binary type. Rejecting these
  // outright blocked perfectly valid uploads, so we fall back to the extension.
  'application/octet-stream',
  'application/vnd.ms-office',
]);

const ALLOWED_EXTENSIONS = new Set(['.csv', '.xls', '.xlsx']);

@ApiTags('Imports')
@ApiBearerAuth()
@Controller('imports')
@UseGuards(JwtAuthGuard)
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, callback) => {
        const ext = extname(file.originalname || '').toLowerCase();

        // The extension is authoritative; the mime type is only a hint, because
        // clients report it inconsistently for CSV/Excel.
        if (!ALLOWED_EXTENSIONS.has(ext)) {
          return callback(
            new BadRequestException(
              `Unsupported file extension "${ext || '(none)'}". Upload a .csv, .xls or .xlsx file.`,
            ),
            false,
          );
        }

        if (file.mimetype && !ALLOWED_MIMES.has(file.mimetype)) {
          return callback(
            new BadRequestException(
              `Unsupported content type "${file.mimetype}" for ${ext} file.`,
            ),
            false,
          );
        }

        // Throwing a plain Error here produced a 500; BadRequestException gives
        // the client a proper 400 with a usable message.
        return callback(null, true);
      },
    }),
  )
  @ApiOperation({
    summary: 'Upload a file for import',
    description:
      'Upload a CSV or Excel file (.csv, .xlsx, .xls) to begin the import process. Maximum file size is 50MB.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'CSV or Excel file to import',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'File uploaded successfully and import record created',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid file type or file too large',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Not authenticated',
  })
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('userId') userId: string,
  ) {
    // Multer leaves `file` undefined when the field is absent or filtered out.
    // Without this guard the service dereferences it and returns a 500.
    if (!file) {
      throw new BadRequestException(
        'No file uploaded. Attach a .csv, .xls or .xlsx file in the "file" field.',
      );
    }
    return this.importsService.upload(file, userId);
  }

  @Get()
  @ApiOperation({
    summary: 'List all import files',
    description:
      'Retrieve all import files ordered by creation date (newest first).',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of import files returned successfully',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Not authenticated',
  })
  async findAll() {
    return this.importsService.findAll();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get import file by ID',
    description: 'Retrieve a single import file record by its UUID.',
  })
  @ApiParam({
    name: 'id',
    description: 'Import file UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Import file found and returned successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Import file not found',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Not authenticated',
  })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.importsService.findById(id);
  }

  @Get(':id/preview')
  @ApiOperation({
    summary: 'Preview uploaded file',
    description:
      'Parse the uploaded file and return the first 10 rows along with column headers for mapping.',
  })
  @ApiParam({
    name: 'id',
    description: 'Import file UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Preview data returned with headers and sample rows',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Import file not found',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Not authenticated',
  })
  async getPreview(@Param('id', ParseUUIDPipe) id: string) {
    return this.importsService.getPreview(id);
  }

  @Post(':id/map')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set column mapping',
    description:
      'Map file columns to entity fields. Example: { "Company Name": "company_name", "Phone": "whatsapp_number" }',
  })
  @ApiParam({
    name: 'id',
    description: 'Import file UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        mapping: {
          type: 'object',
          additionalProperties: { type: 'string' },
          example: {
            'Company Name': 'company_name',
            Phone: 'whatsapp_number',
            Email: 'email',
            Name: 'name',
          },
        },
      },
      required: ['mapping'],
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Column mapping set successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid status for mapping or invalid mapping data',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Import file not found',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Not authenticated',
  })
  async setColumnMapping(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('mapping') mapping: Record<string, string>,
  ) {
    return this.importsService.setColumnMapping(id, mapping);
  }

  @Post(':id/validate')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Start validation',
    description:
      'Queue a background validation job that checks all rows for valid data, duplicate WhatsApp numbers, etc.',
  })
  @ApiParam({
    name: 'id',
    description: 'Import file UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Validation job queued successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Column mapping must be set before validation',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Import file not found',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Not authenticated',
  })
  async validate(@Param('id', ParseUUIDPipe) id: string) {
    await this.importsService.validate(id);
    return { message: 'Validation job queued successfully' };
  }

  @Get(':id/validation-report')
  @ApiOperation({
    summary: 'Get validation report',
    description:
      'Retrieve the validation results including counts of valid, duplicate, and error rows along with detailed error information.',
  })
  @ApiParam({
    name: 'id',
    description: 'Import file UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Validation report returned successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Import file not found',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Not authenticated',
  })
  async getValidationReport(@Param('id', ParseUUIDPipe) id: string) {
    return this.importsService.getValidationReport(id);
  }

  @Post(':id/execute')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Execute import',
    description:
      'Queue a background import job that creates contacts and companies from the uploaded file data.',
  })
  @ApiParam({
    name: 'id',
    description: 'Import file UUID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Import execution job queued successfully',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Import cannot be executed in current status',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Import file not found',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Not authenticated',
  })
  async execute(@Param('id', ParseUUIDPipe) id: string) {
    await this.importsService.execute(id);
    return { message: 'Import execution job queued successfully' };
  }
}
