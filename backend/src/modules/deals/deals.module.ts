import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Deal } from '../../entities/deal.entity';
import { Lead } from '../../entities/lead.entity';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';

@Module({
  imports: [TypeOrmModule.forFeature([Deal, Lead])],
  controllers: [DealsController],
  providers: [DealsService],
  exports: [DealsService],
})
export class DealsModule {}
