import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { AddContactsDto } from './dto/add-contacts.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Campaigns')
@ApiBearerAuth()
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly svc: CampaignsService) {}

  @Get()
  @ApiOperation({ summary: 'List campaigns (paginated)' })
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.svc.findAllPaginated(page ? +page : 1, limit ? +limit : 20, undefined, undefined, { created_at: 'DESC' });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get campaign by ID' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.findById(id, ['campaign_contacts', 'templates', 'creator']);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create campaign' })
  create(@Body() dto: CreateCampaignDto, @CurrentUser('userId') userId: string) {
    return this.svc.createCampaign(dto, userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update campaign' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCampaignDto) {
    return this.svc.updateCampaign(id, dto);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate campaign' })
  activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.activate(id);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause campaign' })
  pause(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.pause(id);
  }

  @Post(':id/contacts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add contacts to campaign' })
  addContacts(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddContactsDto) {
    return this.svc.addContacts(id, dto.contactIds);
  }

  @Get(':id/contacts')
  @ApiOperation({ summary: 'List campaign contacts' })
  listContacts(@Param('id', ParseUUIDPipe) id: string, @Query('page') p?: string, @Query('limit') l?: string) {
    return this.svc.listContacts(id, p ? +p : 1, l ? +l : 20);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Get campaign statistics' })
  getStats(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getStats(id);
  }
}
