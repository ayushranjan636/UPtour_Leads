import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { SearchService } from './search.service';

@ApiTags('Search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Global search across contacts, companies, leads, deals',
    description:
      'Search by keyword across all major entities. Uses PostgreSQL ILIKE for matching. ' +
      'Filter by type to narrow results.',
  })
  @ApiQuery({ name: 'q', required: true, description: 'Search query (min 2 chars)' })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['all', 'contacts', 'companies', 'leads', 'deals'],
    description: 'Filter by entity type',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per type' })
  async search(
    @Query('q') q: string,
    @Query('type') type?: 'all' | 'contacts' | 'companies' | 'leads' | 'deals',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.searchService.search(
      q,
      type || 'all',
      parseInt(page || '1', 10),
      parseInt(limit || '20', 10),
    );
  }
}
