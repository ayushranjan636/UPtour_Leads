import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DealsService } from './deals.service';
import { CreateDealDto } from './dto/create-deal.dto';
import { UpdateDealDto } from './dto/update-deal.dto';

@ApiTags('Deals')
@ApiBearerAuth()
@Controller('deals')
export class DealsController {
  constructor(private readonly svc: DealsService) {}

  @Get()
  @ApiOperation({ summary: 'List deals (paginated)' })
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.svc.findAllPaginated(page ? +page : 1, limit ? +limit : 20, undefined, ['lead', 'assignedTo'], { created_at: 'DESC' });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get deal by ID' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.findById(id, ['lead', 'lead.contact', 'lead.company', 'assignedTo']);
  }

  @Post()
  @ApiOperation({ summary: 'Create deal' })
  create(@Body() dto: CreateDealDto) {
    return this.svc.createDeal(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update deal (with stage sync)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDealDto) {
    return this.svc.updateDeal(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete deal' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(id);
  }
}
