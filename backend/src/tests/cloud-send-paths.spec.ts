/**
 * End-to-end check that every kind of outbound message reaches Meta's official
 * WhatsApp Cloud API when it is the active provider, with the exact Graph payload.
 *
 * Uses the real MessageSendProcessor, MessagesService, WhatsappSenderService and
 * WhatsappCloudService. Only the database rows and the HTTP call to graph.facebook.com
 * are faked, so a regression anywhere between "campaign step due" and "request to
 * Meta" fails here.
 */
import axios from 'axios';
import { BadRequestException } from '@nestjs/common';
import { MessageSendProcessor } from '../modules/engine/message-send.processor';
import { MessagesService } from '../modules/messages/messages.service';
import { WhatsappCloudService } from '../modules/whatsapp-cloud/whatsapp-cloud.service';
import { WhatsappSenderService } from '../modules/whatsapp-cloud/whatsapp-sender.service';

const PNID = '1315760628293490';
const GRAPH_URL = `https://graph.facebook.com/v23.0/${PNID}/messages`;

function makeCloud(provider: 'cloud' | 'session' = 'cloud') {
  const settings: Record<string, unknown> = {
    'whatsapp.provider': provider,
    'whatsapp.cloud': {
      accessToken: 'EAAtest',
      phoneNumberId: PNID,
      wabaId: '2296119621207013',
      appSecret: 'secret',
      verifyToken: 'verify',
      apiVersion: 'v23.0',
    },
  };
  const dataSource = {
    query: vi.fn(async (_sql: string, params?: unknown[]) => {
      const key = params?.[0] as string;
      return key in settings ? [{ value: settings[key] }] : [];
    }),
  };
  const config = { get: vi.fn(() => undefined) };
  const cloud = new WhatsappCloudService(config as any, dataSource as any);
  (cloud as any).logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const openwa = {
    resolveSessionId: vi.fn(async () => 'openwa-session-uuid'),
    sendText: vi.fn(async () => ({ messageId: 'openwa-msg' })),
    assertSendable: vi.fn(async () => undefined),
    invalidateSessionCache: vi.fn(),
  };
  const sender = new WhatsappSenderService(openwa as any, cloud);
  return { sender, openwa };
}

const contact = {
  id: 'contact-1',
  name: 'Asha',
  whatsapp_number: '+919876543210',
  whatsapp_chat_id: null,
  is_opted_out: false,
  is_suppressed: false,
  company: { name: 'Hill Palace', city: 'Kochi', country: 'India' },
};
const campaign = { id: 'camp-1', name: 'Kerala heritage', product: 'Heritage tour' };

function makeProcessor(sender: WhatsappSenderService, templates: any[], recentInbound = false) {
  const cc = {
    id: 'cc-1',
    contact,
    campaign,
    current_sequence_step: 0,
    first_sent_at: new Date('2026-10-01'), // not the first send, so no follow-up planning
  };
  const ccRepo = { findOne: vi.fn(async () => cc), update: vi.fn(async () => ({})) };
  const contactRepo = { findOne: vi.fn(async () => contact) };
  const campaignRepo = { increment: vi.fn(async () => ({})) };
  const saved: any[] = [];
  const messageRepo = {
    create: (d: any) => d,
    save: vi.fn(async (d: any) => {
      saved.push(d);
      return d;
    }),
    findOne: vi.fn(async () => (recentInbound ? { id: 'inbound-1' } : null)),
  };
  const templateRepo = { find: vi.fn(async () => templates) };
  const proc = new MessageSendProcessor(
    ccRepo as any,
    contactRepo as any,
    campaignRepo as any,
    messageRepo as any,
    templateRepo as any,
    sender,
    { scheduleFollowups: vi.fn(async () => ({})) } as any,
  );
  (proc as any).logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { proc, saved, campaignRepo, ccRepo };
}

const campaignJob = {
  name: 'send-message',
  data: { campaignContactId: 'cc-1', campaignId: 'camp-1', contactId: 'contact-1', sessionId: 'old-qr-session' },
} as any;

let post: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { messages: [{ id: 'wamid.TEST' }] } } as any);
});
afterEach(() => vi.restoreAllMocks());

describe('Campaign messages through the official Cloud API', () => {
  it('sends the approved Meta template with merge fields filled per contact', async () => {
    const { sender } = makeCloud();
    const { proc, saved, campaignRepo } = makeProcessor(sender, [
      {
        id: 't1',
        name: 'Intro',
        type: 'text',
        body: 'Hi {{contact_name}}, a heritage tour for {{company_name}}?',
        sequence_order: 0,
        cloud_template_name: 'heritage_intro',
        cloud_template_language: 'en',
        cloud_template_params: ['{{contact_name}}', '{{company_name}}'],
      },
    ]);

    await expect(proc.process(campaignJob)).resolves.toMatchObject({ success: true, openwaId: 'wamid.TEST' });

    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, opts] = post.mock.calls[0] as any[];
    expect(url).toBe(GRAPH_URL);
    expect(opts.headers.Authorization).toBe('Bearer EAAtest');
    expect(body).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919876543210',
      type: 'template',
      template: {
        name: 'heritage_intro',
        language: { code: 'en' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: 'Asha' }, { type: 'text', text: 'Hill Palace' }] },
        ],
      },
    });
    // Stored so delivery/read receipts from Meta's webhook can find this row.
    expect(saved[0]).toMatchObject({
      openwa_message_id: 'wamid.TEST',
      openwa_session_id: `cloud:${PNID}`,
      status: 'sent',
    });
    expect(campaignRepo.increment).toHaveBeenCalledWith({ id: 'camp-1' }, 'stats_sent', 1);
  });

  it('attaches the template media as the header for an image step', async () => {
    const { sender } = makeCloud();
    const { proc } = makeProcessor(sender, [
      {
        id: 't1',
        name: 'Brochure',
        type: 'image',
        body: 'Our brochure',
        media_url: 'https://cdn.example.com/brochure.jpg',
        sequence_order: 0,
        cloud_template_name: 'brochure_image',
        cloud_template_language: 'en_US',
        cloud_template_params: [],
      },
    ]);
    await proc.process(campaignJob);
    const body = post.mock.calls[0][1] as any;
    expect(body.template.components).toEqual([
      { type: 'header', parameters: [{ type: 'image', image: { link: 'https://cdn.example.com/brochure.jpg' } }] },
    ]);
  });

  it('refuses free text to a cold contact instead of letting Meta drop it', async () => {
    const { sender } = makeCloud();
    const { proc, saved, ccRepo } = makeProcessor(sender, [
      { id: 't1', name: 'Plain intro', type: 'text', body: 'Hi {{contact_name}}', sequence_order: 0 },
    ]);
    await expect(proc.process(campaignJob)).rejects.toThrow(/approved Meta template/);
    expect(post).not.toHaveBeenCalled();
    expect(saved[0]).toMatchObject({ status: 'failed' });
    expect(saved[0].failed_reason).toMatch(/Set a Meta template on "Plain intro"/);
    expect(ccRepo.update).toHaveBeenCalledWith('cc-1', { status: 'failed' });
  });

  it('sends free text when the contact wrote in the last 24 hours (follow-up in a live chat)', async () => {
    const { sender } = makeCloud();
    const { proc } = makeProcessor(
      sender,
      [{ id: 't2', name: 'Follow-up', type: 'text', body: 'Thanks {{contact_name}}!', sequence_order: 0 }],
      true,
    );
    await proc.process(campaignJob);
    expect(post.mock.calls[0][1]).toMatchObject({ type: 'text', to: '919876543210', text: { body: 'Thanks Asha!' } });
  });

  it('sends AI replies through the Cloud API', async () => {
    const { sender, openwa } = makeCloud();
    const { proc } = makeProcessor(sender, []);
    await proc.process({
      name: 'send-ai-reply',
      data: { contactId: 'contact-1', body: 'Happy to help!', mediaType: null, mediaUrl: null },
    } as any);
    expect(post.mock.calls[0][1]).toMatchObject({ type: 'text', text: { body: 'Happy to help!' } });
    expect(openwa.sendText).not.toHaveBeenCalled();
  });

  it('never touches Meta while the QR session is the active provider', async () => {
    const { sender, openwa } = makeCloud('session');
    const { proc, saved } = makeProcessor(sender, [
      { id: 't1', name: 'Intro', type: 'text', body: 'Hi', sequence_order: 0, cloud_template_name: 'heritage_intro' },
    ]);
    await proc.process(campaignJob);
    expect(post).not.toHaveBeenCalled();
    // The campaign's stored session id is handed to the gateway to resolve.
    expect(openwa.resolveSessionId).toHaveBeenCalledWith('old-qr-session');
    expect(openwa.sendText).toHaveBeenCalledWith('openwa-session-uuid', '919876543210@c.us', 'Hi');
    expect(saved[0].openwa_session_id).toBe('openwa-session-uuid');
  });
});

describe('Manual messages from Conversations through the Cloud API', () => {
  function makeMessages(recentInbound: boolean) {
    const { sender } = makeCloud();
    const messageRepository = {
      create: (d: any) => d,
      save: vi.fn(async (d: any) => d),
      findOne: vi.fn(async () => (recentInbound ? { id: 'inbound-1' } : null)),
    };
    const contactRepository = { findOne: vi.fn(async () => contact) };
    const svc = new MessagesService(messageRepository as any, contactRepository as any, {} as any, sender);
    (svc as any).logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return svc;
  }

  it('sends a typed reply when the contact wrote in the last 24 hours', async () => {
    const saved = await makeMessages(true).sendManual('contact-1', 'See you on Monday', 'user-1');
    expect(post.mock.calls[0][0]).toBe(GRAPH_URL);
    expect(post.mock.calls[0][1]).toMatchObject({ type: 'text', text: { body: 'See you on Monday' } });
    expect(saved).toMatchObject({ status: 'sent', openwa_message_id: 'wamid.TEST' });
  });

  it('explains the 24-hour rule instead of sending into the void', async () => {
    await expect(makeMessages(false).sendManual('contact-1', 'Hello', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(post).not.toHaveBeenCalled();
  });
});

describe('Templates, webhook and campaign checks on the Cloud API', () => {
  function cloudWith(env: Record<string, string> = {}) {
    const settings: Record<string, unknown> = {
      'whatsapp.provider': 'cloud',
      'whatsapp.cloud': {
        accessToken: 'EAAtest',
        phoneNumberId: PNID,
        wabaId: '2296119621207013',
        appSecret: 'secret',
        verifyToken: 'verify-123',
        apiVersion: 'v23.0',
      },
    };
    const dataSource = {
      query: vi.fn(async (_sql: string, params?: unknown[]) => {
        const key = params?.[0] as string;
        return key in settings ? [{ value: settings[key] }] : [];
      }),
    };
    const svc = new WhatsappCloudService({ get: (k: string) => env[k] } as any, dataSource as any);
    (svc as any).logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return svc;
  }

  it('submits a template to Meta with numbered blanks and sample values', async () => {
    post.mockResolvedValueOnce({ data: { id: 'tpl-1', status: 'PENDING' } } as any);
    const res = await cloudWith().createTemplate({
      name: 'Heritage Tour Intro',
      language: 'en',
      category: 'MARKETING',
      body: 'Namaste {{1}}! Tours for guests of {{2}}?',
      examples: ['Asha', 'Hill Palace'],
      footer: 'Reply STOP to opt out',
      quickReplies: ['Yes, send details'],
    });
    expect(res).toEqual({ id: 'tpl-1', status: 'PENDING', name: 'heritage_tour_intro' });
    const [url, body] = post.mock.calls[0] as any[];
    expect(url).toBe('https://graph.facebook.com/v23.0/2296119621207013/message_templates');
    expect(body).toEqual({
      name: 'heritage_tour_intro',
      language: 'en',
      category: 'MARKETING',
      components: [
        {
          type: 'BODY',
          text: 'Namaste {{1}}! Tours for guests of {{2}}?',
          example: { body_text: [['Asha', 'Hill Palace']] },
        },
        { type: 'FOOTER', text: 'Reply STOP to opt out' },
        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Yes, send details' }] },
      ],
    });
  });

  it('explains a missing sample value instead of letting Meta reject it', async () => {
    await expect(
      cloudWith().createTemplate({ name: 'x', language: 'en', category: 'MARKETING', body: 'Hi {{1}}', examples: [] }),
    ).rejects.toThrow(/sample value for each blank/);
    expect(post).not.toHaveBeenCalled();
  });

  it('registers the portal as the webhook for the business account', async () => {
    vi.spyOn(axios, 'get').mockResolvedValue({ data: { data: [] } } as any);
    post.mockResolvedValueOnce({ data: { success: true } } as any);
    await cloudWith({ FRONTEND_URL: 'https://portal.foundros.space' }).registerWebhook();
    const [url, body] = post.mock.calls[0] as any[];
    expect(url).toBe('https://graph.facebook.com/v23.0/2296119621207013/subscribed_apps');
    expect(body).toEqual({
      override_callback_uri: 'https://portal.foundros.space/api/webhooks/whatsapp-cloud',
      verify_token: 'verify-123',
    });
  });

  it('refuses to register a localhost webhook, which Meta can never reach', async () => {
    await expect(cloudWith({ APP_URL: 'http://localhost:3000' }).registerWebhook()).rejects.toThrow(
      /public HTTPS/,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('blocks launching a campaign whose opening or no-reply steps have no Meta template', async () => {
    const { CampaignsService } = await import('../modules/campaigns/campaigns.service');
    const svc = new CampaignsService({} as any, {} as any, {} as any, {} as any, {} as any, cloudWith());
    const blockers: string[] = await (svc as any).cloudTemplateBlockers([
      { name: 'Opening', trigger_condition: 'initial', cloud_template_name: null },
      { name: 'Nudge', trigger_condition: 'no_reply_48h', cloud_template_name: '' },
      { name: 'Answer', trigger_condition: 'replied_interested', cloud_template_name: null },
      { name: 'Ready', trigger_condition: 'initial', cloud_template_name: 'heritage_intro' },
    ]);
    expect(blockers).toHaveLength(2);
    expect(blockers[0]).toMatch(/"Opening" needs an approved Meta template/);
    expect(blockers[1]).toMatch(/"Nudge"/);
  });

  it('sends a template from Conversations to someone outside the 24-hour window', async () => {
    const { sender } = makeCloud();
    const messageRepository = { create: (d: any) => d, save: vi.fn(async (d: any) => d), findOne: vi.fn() };
    const svc = new MessagesService(
      messageRepository as any,
      { findOne: vi.fn(async () => contact) } as any,
      {} as any,
      sender,
    );
    (svc as any).logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const saved = await svc.sendTemplateManual('contact-1', 'heritage_intro', 'en', ['Asha'], 'user-1', 'Namaste Asha!');
    expect(post.mock.calls[0][1]).toMatchObject({
      type: 'template',
      template: { name: 'heritage_intro', language: { code: 'en' } },
    });
    expect(saved).toMatchObject({ status: 'sent', body: 'Namaste Asha!', openwa_message_id: 'wamid.TEST' });
    // No 24-hour check: templates are exactly what Meta allows outside the window.
    expect(messageRepository.findOne).not.toHaveBeenCalled();
  });
});
