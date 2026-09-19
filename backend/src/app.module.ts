import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

// Config
import databaseConfig from './config/database.config';

// Global infrastructure
import { RedisModule } from './common/redis/redis.module';

// Guards
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';

// Feature modules
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { MessagesModule } from './modules/messages/messages.module';
import { LeadsModule } from './modules/leads/leads.module';
import { DealsModule } from './modules/deals/deals.module';
import { ImportsModule } from './modules/imports/imports.module';
import { OpenwaModule } from './modules/openwa/openwa.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { AiModule } from './modules/ai/ai.module';
import { EngineModule } from './modules/engine/engine.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { CollectionModule } from './modules/collection/collection.module';
import { AuditModule } from './modules/audit/audit.module';
import { NotificationModule } from './modules/notifications/notification.module';
import { SearchModule } from './modules/search/search.module';
import { WorkflowTrackerModule } from './modules/workflow-tracker/workflow-tracker.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig],
    }),

    // Database
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres' as const,
        host: configService.get<string>('DATABASE_HOST', 'localhost'),
        port: configService.get<number>('DATABASE_PORT', 5432),
        database: configService.get<string>('DATABASE_NAME', 'uptour'),
        username: configService.get<string>('DATABASE_USERNAME', 'uptour'),
        password: configService.get<string>('DATABASE_PASSWORD', 'uptour_secret_2026'),
        autoLoadEntities: true,
        synchronize: configService.get('NODE_ENV') !== 'production',
        logging: configService.get('NODE_ENV') === 'development',
      }),
      inject: [ConfigService],
    }),

    // BullMQ with Redis
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
        },
      }),
      inject: [ConfigService],
    }),

    // Scheduler (cron jobs)
    ScheduleModule.forRoot(),

    // Rate limiting
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 100,
    }]),

    // Global modules first.
    // RedisModule, NotificationModule and WorkflowTrackerModule are @Global(), so
    // they must be registered at the root — a global module still has to be
    // imported exactly once for its providers to enter the injector. Otherwise
    // RedisService/NotificationService cannot be injected into ContactsService /
    // WebhooksService / CampaignSchedulerService and bootstrap fails.
    RedisModule,
    AuditModule,
    NotificationModule,
    WorkflowTrackerModule,

    // Feature modules
    AuthModule,
    UsersModule,
    CompaniesModule,
    ContactsModule,
    CampaignsModule,
    TemplatesModule,
    MessagesModule,
    LeadsModule,
    DealsModule,
    ImportsModule,
    OpenwaModule,
    WebhooksModule,
    AiModule,
    EngineModule,
    DashboardModule,
    CollectionModule,
    SearchModule,
  ],
  controllers: [HealthController],
  providers: [
    // Global JWT guard — all routes protected by default
    // Use @Public() decorator to make specific routes public
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Global throttler guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
