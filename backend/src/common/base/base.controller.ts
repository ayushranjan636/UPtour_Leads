import { Get, Post, Patch, Delete, Param, Body, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { BaseService } from './base.service';

/**
 * GENERIC BASE CRUD CONTROLLER
 * 
 * Eliminates ~80% of repeated controller code.
 * Subclasses just add custom endpoints.
 */
export abstract class BaseCrudController<T extends { id: string }> {
  protected abstract readonly service: BaseService<T>;

  @Get()
  @ApiOperation({ summary: 'List all (paginated)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.findAllPaginated(
      page ? +page : 1,
      limit ? +limit : 20,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create' })
  create(@Body() dto: any) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update' })
  update(@Param('id') id: string, @Body() dto: any) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
