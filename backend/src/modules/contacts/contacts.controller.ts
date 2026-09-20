import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { QueryContactDto } from './dto/query-contact.dto';

@ApiTags('Contacts')
@ApiBearerAuth()
@Controller('contacts')
export class ContactsController {
  constructor(private readonly svc: ContactsService) {}

  @Get()
  @ApiOperation({ summary: 'List contacts (paginated + filters)' })
  findAll(@Query() query: QueryContactDto) {
    return this.svc.findFiltered(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get contact by ID' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.findById(id, ['company']);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create contact' })
  create(@Body() dto: CreateContactDto) {
    return this.svc.createContact(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update contact' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContactDto) {
    return this.svc.updateContact(id, dto);
  }

  @Post(':id/opt-out')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Opt out contact' })
  optOut(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.optOut(id);
  }

  @Post(':id/verify-whatsapp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify WhatsApp' })
  verifyWhatsApp(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.verifyWhatsApp(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Permanently delete a contact',
    description:
      'Removes the contact along with its campaign memberships, messages, AI analyses, ' +
      'leads and deals. Data-collection results are kept but unlinked. This cannot be undone — ' +
      'use opt-out instead to stop messaging while retaining history.',
  })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteContact(id);
  }
}
