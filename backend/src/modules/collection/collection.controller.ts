import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CollectionService } from './collection.service';
import { CollectionRunnerService } from './collection-runner.service';
import { GooglePlacesProvider } from './google-places.provider';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../../entities/user.entity';
import { CreateCollectionJobDto } from './dto/create-collection-job.dto';
import { UpdateCollectionJobDto } from './dto/update-collection-job.dto';
import { QueryCollectionJobDto } from './dto/query-collection-job.dto';

@ApiTags('Data Collection')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('collection')
export class CollectionController {
  constructor(
    private readonly service: CollectionService,
    private readonly runner: CollectionRunnerService,
    private readonly places: GooglePlacesProvider,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all collection jobs' })
  findAll(@Query() query: QueryCollectionJobDto) {
    return this.service.findAll(query);
  }

  @Get('status')
  @ApiOperation({
    summary: 'Check whether the Google Maps data source is configured',
  })
  status() {
    return {
      provider: 'google_maps',
      configured: this.places.isConfigured(),
      requestsThisProcess: this.places.getRequestCount(),
    };
  }

  @Post()
  @ApiOperation({ summary: 'Create a new data collection job' })
  create(
    @Body() dto: CreateCollectionJobDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.service.create(dto, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get collection job details' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a collection job' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCollectionJobDto,
  ) {
    return this.service.update(id, dto);
  }

  @Patch(':id/pause')
  @ApiOperation({ summary: 'Pause a collection job' })
  pause(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.pause(id);
  }

  @Patch(':id/resume')
  @ApiOperation({ summary: 'Resume a collection job' })
  resume(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.resume(id);
  }

  @Post(':id/run-now')
  @ApiOperation({
    summary: 'Manually trigger a collection job run',
    description:
      'Runs the Google Maps scrape synchronously and returns a summary of what was collected.',
  })
  async runNow(@Param('id', ParseUUIDPipe) id: string) {
    if (!this.places.isConfigured()) {
      throw new BadRequestException(
        'GOOGLE_MAPS_API_KEY is not configured on the server. ' +
          'Add it to backend/.env and restart the API to enable data collection.',
      );
    }

    const job = await this.service.findById(id);
    const summary = await this.runner.executeJob(job);

    return {
      message: `Collected ${summary.imported} new contacts (${summary.duplicates} duplicates, ${summary.invalid} without a valid phone) from ${summary.scanned} Google Maps listings.`,
      ...summary,
    };
  }

  @Get(':id/results')
  @ApiOperation({ summary: 'Get collection results for a job' })
  getResults(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getResults(id, page ? +page : 1, limit ? +limit : 50);
  }
}
