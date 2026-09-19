import { PartialType } from '@nestjs/swagger';
import { CreateCollectionJobDto } from './create-collection-job.dto';

export class UpdateCollectionJobDto extends PartialType(CreateCollectionJobDto) {}
