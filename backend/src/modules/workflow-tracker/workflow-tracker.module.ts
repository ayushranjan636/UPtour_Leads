import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkflowEvent } from './workflow-tracker.entity';
import { WorkflowTrackerService } from './workflow-tracker.service';
import { WorkflowTrackerController } from './workflow-tracker.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([WorkflowEvent])],
  providers: [WorkflowTrackerService],
  controllers: [WorkflowTrackerController],
  exports: [WorkflowTrackerService],
})
export class WorkflowTrackerModule {}
