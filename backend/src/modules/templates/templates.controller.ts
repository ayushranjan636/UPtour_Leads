import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { PreviewTemplateDto } from './dto/preview-template.dto';

@ApiTags('Templates')
@ApiBearerAuth()
@Controller('templates')
export class TemplatesController {
  constructor(private readonly svc: TemplatesService) {}

  @Get('campaign/:campaignId')
  @ApiOperation({ summary: 'List templates by campaign' })
  findByCampaign(@Param('campaignId', ParseUUIDPipe) campaignId: string) {
    return this.svc.findByCampaign(campaignId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get template by ID' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.findById(id, ['campaign']);
  }

  @Post()
  @ApiOperation({ summary: 'Create template' })
  create(@Body() dto: CreateTemplateDto) {
    return this.svc.create(dto);
  }

  @Post('preview')
  @ApiOperation({
    summary: 'Preview a template rendered with sample data',
    description:
      'Renders the template body by substituting placeholders with sample contact/company data. ' +
      'Returns the rendered text and media info.',
  })
  preview(@Body() dto: PreviewTemplateDto) {
    return this.svc.previewTemplate(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update template' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTemplateDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete template' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(id);
  }
}
