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
import {
  BulkContactIdsDto,
  BulkGroupDto,
  BulkVerifyDto,
} from './dto/bulk-contacts.dto';

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

  @Get('locations')
  @ApiOperation({
    summary: 'Distinct location values for filter dropdowns',
    description:
      'Returns the countries, states, districts, cities and agency types actually ' +
      'present in the data. Pass `country` to narrow states/cities, and `state_region` ' +
      'to narrow districts, so the UI can cascade Country → State → District.',
  })
  locations(
    @Query('country') country?: string,
    @Query('state_region') state_region?: string,
  ) {
    return this.svc.locationFacets({ country, state_region });
  }

  @Get('datasets')
  @ApiOperation({
    summary: 'Datasets a campaign audience can be built from',
    description:
      'Collection jobs and CSV imports that produced at least one reachable contact, ' +
      'with counts. Pass the chosen ids to /contacts (or the campaign audience filter) ' +
      'as collection_job_ids / import_file_ids to target exactly one scrape or upload.',
  })
  datasets() {
    return this.svc.listDatasets();
  }

  @Get('count')
  @ApiOperation({
    summary: 'Count contacts matching a filter',
    description:
      'Unpaginated total for the given filters. Used for the live audience size in ' +
      'the campaign builder, which needs the real total rather than a page length.',
  })
  async count(@Query() query: QueryContactDto) {
    return { count: await this.svc.countFiltered(query) };
  }

  @Get('groups')
  @ApiOperation({
    summary: 'Contact groups in use',
    description:
      'Distinct group labels with reachable-contact counts. Groups are stored as contact ' +
      'tags, so a contact can belong to several.',
  })
  groups() {
    return this.svc.listGroups();
  }

  @Post('bulk/group')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Add a group label to many contacts',
    description: 'Idempotent — contacts already in the group are skipped.',
  })
  bulkAddGroup(@Body() dto: BulkGroupDto) {
    return this.svc.bulkAddGroup(dto.contactIds, dto.group);
  }

  @Post('bulk/ungroup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a group label from many contacts' })
  bulkRemoveGroup(@Body() dto: BulkGroupDto) {
    return this.svc.bulkRemoveGroup(dto.contactIds, dto.group);
  }

  @Post('bulk/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify many numbers against WhatsApp',
    description:
      'Checks each number, caching results for 24h. Numbers not on WhatsApp are ' +
      'suppressed so campaigns skip them instead of wasting sends.',
  })
  bulkVerify(@Body() dto: BulkVerifyDto) {
    return this.svc.verifyBatch(dto.contactIds, dto.sessionId);
  }

  @Post('bulk/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Permanently delete many contacts',
    description:
      'Each contact is removed with its campaign, message and lead history. Failures ' +
      'are reported per id rather than aborting the batch. This cannot be undone.',
  })
  bulkDelete(@Body() dto: BulkContactIdsDto) {
    return this.svc.bulkDelete(dto.contactIds);
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
