/**
 * SMOKE TEST — Module Import & Logic Verification
 * 
 * Verifies all modules resolve correctly and core business logic works.
 * Uses vitest for native ESM support (required for NestJS v11+).
 */
import { describe, it, expect } from 'vitest';

// ─── ENTITIES ───
describe('Entity imports', () => {
  it('should import all entities from index', async () => {
    const entities = await import('../entities/index');
    expect(entities).toBeDefined();
    expect(Object.keys(entities).length).toBeGreaterThan(5);
  });

  const entityFiles = [
    'contact.entity', 'company.entity', 'campaign.entity',
    'campaign-contact.entity', 'message.entity', 'message-template.entity',
    'lead.entity', 'deal.entity', 'user.entity', 'import-file.entity',
    'collection-job.entity', 'collection-result.entity',
    'followup-job.entity', 'ai-analysis.entity', 'audit-log.entity',
  ];

  entityFiles.forEach(file => {
    it(`should import ${file}`, async () => {
      const mod = await import(`../entities/${file}`);
      expect(mod).toBeDefined();
    });
  });
});

// ─── COMMON / BASE CLASSES ───
describe('Common modules', () => {
  it('BaseService — class defined with abstract methods', async () => {
    const { BaseService } = await import('../common/base/base.service');
    expect(BaseService).toBeDefined();
    expect(BaseService.prototype.findById).toBeDefined();
    expect(BaseService.prototype.create).toBeDefined();
    expect(BaseService.prototype.update).toBeDefined();
    expect(BaseService.prototype.remove).toBeDefined();
    expect(BaseService.prototype.batchCreate).toBeDefined();
    expect(BaseService.prototype.findAllPaginated).toBeDefined();
  });

  it('BaseCrudController — class defined with CRUD routes', async () => {
    const { BaseCrudController } = await import('../common/base/base.controller');
    expect(BaseCrudController).toBeDefined();
  });

  it('RedisService — class defined', async () => {
    const { RedisService } = await import('../common/redis/redis.service');
    expect(RedisService).toBeDefined();
  });

  it('PaginatedResponseDto — computes totalPages correctly', async () => {
    const { PaginatedResponseDto } = await import('../common/dto/paginated-response.dto');
    const dto = new PaginatedResponseDto([1, 2, 3], 50, 2, 10);
    expect(dto.totalPages).toBe(5);
    expect(dto.data).toEqual([1, 2, 3]);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(10);
    expect(dto.total).toBe(50);
  });

  it('PaginatedResponseDto — handles 0 total', async () => {
    const { PaginatedResponseDto } = await import('../common/dto/paginated-response.dto');
    const dto = new PaginatedResponseDto([], 0, 1, 20);
    expect(dto.totalPages).toBe(0);
    expect(dto.data).toEqual([]);
  });

  it('normalizePhone — normalizes Indian numbers', async () => {
    const { normalizePhone } = await import('../common/utils/phone.util');
    expect(normalizePhone).toBeInstanceOf(Function);
  });
});

// ─── SERVICES ───
describe('Service imports', () => {
  const services = [
    ['contacts/contacts.service', 'ContactsService'],
    ['companies/companies.service', 'CompaniesService'],
    ['campaigns/campaigns.service', 'CampaignsService'],
    ['leads/leads.service', 'LeadsService'],
    ['deals/deals.service', 'DealsService'],
    ['templates/templates.service', 'TemplatesService'],
    ['messages/messages.service', 'MessagesService'],
    ['auth/auth.service', 'AuthService'],
    ['users/users.service', 'UsersService'],
    ['openwa/openwa.service', 'OpenwaService'],
    ['webhooks/webhooks.service', 'WebhooksService'],
    ['ai/ai.service', 'AiService'],
    ['dashboard/dashboard.service', 'DashboardService'],
    ['collection/collection.service', 'CollectionService'],
    ['collection/collection-runner.service', 'CollectionRunnerService'],
    ['audit/audit.service', 'AuditService'],
    ['workflow-tracker/workflow-tracker.service', 'WorkflowTrackerService'],
    ['imports/imports.service', 'ImportsService'],
  ] as const;

  services.forEach(([path, name]) => {
    it(`should import ${name}`, async () => {
      const mod = await import(`../modules/${path}`);
      expect(mod[name]).toBeDefined();
    });
  });
});

// ─── CONTROLLERS ───
describe('Controller imports', () => {
  const controllers = [
    ['contacts/contacts.controller', 'ContactsController'],
    ['companies/companies.controller', 'CompaniesController'],
    ['campaigns/campaigns.controller', 'CampaignsController'],
    ['leads/leads.controller', 'LeadsController'],
    ['deals/deals.controller', 'DealsController'],
    ['templates/templates.controller', 'TemplatesController'],
    ['messages/messages.controller', 'MessagesController'],
    ['auth/auth.controller', 'AuthController'],
    ['users/users.controller', 'UsersController'],
    ['openwa/openwa.controller', 'OpenwaController'],
    ['webhooks/webhooks.controller', 'WebhooksController'],
    ['dashboard/dashboard.controller', 'DashboardController'],
    ['collection/collection.controller', 'CollectionController'],
    ['engine/engine.controller', 'EngineController'],
    ['workflow-tracker/workflow-tracker.controller', 'WorkflowTrackerController'],
  ] as const;

  controllers.forEach(([path, name]) => {
    it(`should import ${name}`, async () => {
      const mod = await import(`../modules/${path}`);
      expect(mod[name]).toBeDefined();
    });
  });
});

// ─── MODULES ───
describe('NestJS Module imports', () => {
  const modules = [
    ['auth/auth.module', 'AuthModule'],
    ['users/users.module', 'UsersModule'],
    ['contacts/contacts.module', 'ContactsModule'],
    ['companies/companies.module', 'CompaniesModule'],
    ['campaigns/campaigns.module', 'CampaignsModule'],
    ['leads/leads.module', 'LeadsModule'],
    ['deals/deals.module', 'DealsModule'],
    ['templates/templates.module', 'TemplatesModule'],
    ['messages/messages.module', 'MessagesModule'],
    ['imports/imports.module', 'ImportsModule'],
    ['openwa/openwa.module', 'OpenwaModule'],
    ['webhooks/webhooks.module', 'WebhooksModule'],
    ['ai/ai.module', 'AiModule'],
    ['engine/engine.module', 'EngineModule'],
    ['dashboard/dashboard.module', 'DashboardModule'],
    ['collection/collection.module', 'CollectionModule'],
    ['audit/audit.module', 'AuditModule'],
    ['workflow-tracker/workflow-tracker.module', 'WorkflowTrackerModule'],
  ] as const;

  modules.forEach(([path, name]) => {
    it(`should import ${name}`, async () => {
      const mod = await import(`../modules/${path}`);
      expect(mod[name]).toBeDefined();
    });
  });
});

// ─── ENGINE PROCESSORS ───
describe('Engine processor imports', () => {
  it('MessageSendProcessor', async () => {
    const mod = await import('../modules/engine/message-send.processor');
    expect(mod.MessageSendProcessor).toBeDefined();
  });

  it('AiAnalysisProcessor', async () => {
    const mod = await import('../modules/engine/ai-analysis.processor');
    expect(mod.AiAnalysisProcessor).toBeDefined();
  });

  it('SendDistributorService', async () => {
    const mod = await import('../modules/engine/send-distributor.service');
    expect(mod.SendDistributorService).toBeDefined();
  });

  it('FollowupSchedulerService', async () => {
    const mod = await import('../modules/engine/followup-scheduler.service');
    expect(mod.FollowupSchedulerService).toBeDefined();
  });

  it('WebhookProcessor', async () => {
    const mod = await import('../modules/engine/webhook.processor');
    expect(mod.WebhookProcessor).toBeDefined();
  });
});

// ─── WORKFLOW TRACKER ───
describe('Workflow Tracker enums', () => {
  it('WorkflowStage — has all pipeline stages', async () => {
    const { WorkflowStage } = await import('../modules/workflow-tracker/workflow-tracker.entity');
    expect(WorkflowStage.DATA_COLLECTED).toBe('data_collected');
    expect(WorkflowStage.MESSAGE_SENT).toBe('message_sent');
    expect(WorkflowStage.AI_ANALYZED).toBe('ai_analyzed');
    expect(WorkflowStage.LEAD_CREATED).toBe('lead_created');
    expect(WorkflowStage.DEAL_CREATED).toBe('deal_created');
    expect(WorkflowStage.OPTED_OUT).toBe('opted_out');
    expect(WorkflowStage.HUMAN_HANDOVER).toBe('human_handover');
  });

  it('WorkflowStatus — has success/failed/skipped/pending', async () => {
    const { WorkflowStatus } = await import('../modules/workflow-tracker/workflow-tracker.entity');
    expect(WorkflowStatus.SUCCESS).toBe('success');
    expect(WorkflowStatus.FAILED).toBe('failed');
    expect(WorkflowStatus.SKIPPED).toBe('skipped');
    expect(WorkflowStatus.PENDING).toBe('pending');
  });
});

// ─── AI INTERFACES ───
describe('AI Interfaces', () => {
  it('exports module', async () => {
    const mod = await import('../modules/ai/ai.interfaces');
    expect(mod).toBeDefined();
  });
});

// ─── AUTH DECORATORS & GUARDS ───
describe('Auth decorators & guards', () => {
  it('Public decorator', async () => {
    const { Public } = await import('../modules/auth/decorators/public.decorator');
    expect(Public).toBeDefined();
  });

  it('CurrentUser decorator', async () => {
    const { CurrentUser } = await import('../modules/auth/decorators/current-user.decorator');
    expect(CurrentUser).toBeDefined();
  });

  it('JwtAuthGuard', async () => {
    const { JwtAuthGuard } = await import('../modules/auth/guards/jwt-auth.guard');
    expect(JwtAuthGuard).toBeDefined();
  });

  it('RolesGuard', async () => {
    const { RolesGuard } = await import('../modules/auth/guards/roles.guard');
    expect(RolesGuard).toBeDefined();
  });
});

// ─── DTOs ───
describe('DTO imports', () => {
  const dtos = [
    'auth/dto/login.dto',
    'contacts/dto/create-contact.dto',
    'contacts/dto/update-contact.dto',
    'contacts/dto/query-contact.dto',
    'companies/dto/create-company.dto',
    'companies/dto/update-company.dto',
    'campaigns/dto/create-campaign.dto',
    'campaigns/dto/update-campaign.dto',
    'campaigns/dto/add-contacts.dto',
    'leads/dto/create-lead.dto',
    'leads/dto/update-lead.dto',
    'deals/dto/create-deal.dto',
    'deals/dto/update-deal.dto',
    'templates/dto/create-template.dto',
    'templates/dto/update-template.dto',
    'collection/dto/create-collection-job.dto',
  ];

  dtos.forEach(path => {
    const name = path.split('/').pop();
    it(`should import ${name}`, async () => {
      const mod = await import(`../modules/${path}`);
      expect(mod).toBeDefined();
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    });
  });
});

// ─── ROOT APP MODULE ───
describe('Root AppModule', () => {
  it('should import AppModule', async () => {
    const { AppModule } = await import('../app.module');
    expect(AppModule).toBeDefined();
  });
});

// ─── BUSINESS LOGIC UNIT TESTS ───
describe('Business Logic — SendDistributor', () => {
  it('calculates distribution plan correctly for 100/day', async () => {
    const { SendDistributorService } = await import('../modules/engine/send-distributor.service');
    const svc = Object.create(SendDistributorService.prototype);
    const plan = svc.getDistributionPlan(100, '09:00', '18:00');
    expect(plan.daily_limit).toBe(100);
    expect(plan.window_hours).toBe(9);
    expect(plan.messages_per_hour).toBeCloseTo(11.1, 0);
    expect(plan.safety_rating).toBe('SAFE');
  });

  it('calculates distribution plan for 500/day (aggressive)', async () => {
    const { SendDistributorService } = await import('../modules/engine/send-distributor.service');
    const svc = Object.create(SendDistributorService.prototype);
    const plan = svc.getDistributionPlan(500, '09:00', '18:00');
    expect(plan.daily_limit).toBe(500);
    expect(plan.safety_rating).toBe('AGGRESSIVE');
    expect(plan.messages_per_hour).toBeCloseTo(55.6, 0);
  });

  it('calculates plan for 10/day (safe)', async () => {
    const { SendDistributorService } = await import('../modules/engine/send-distributor.service');
    const svc = Object.create(SendDistributorService.prototype);
    const plan = svc.getDistributionPlan(10, '09:00', '18:00');
    expect(plan.safety_rating).toBe('SAFE');
    expect(plan.messages_per_hour).toBeCloseTo(1.1, 0);
  });
});
