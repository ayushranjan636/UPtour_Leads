import { translateCloudWebhook } from '../modules/webhooks/whatsapp-cloud.translate';
import { WhatsappSenderService } from '../modules/whatsapp-cloud/whatsapp-sender.service';
import { WhatsappCloudService, isCloudSessionId } from '../modules/whatsapp-cloud/whatsapp-cloud.service';

function envelope(value: any) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '111' }, ...value } }] }],
  };
}

describe('translateCloudWebhook', () => {
  it('maps an inbound text to message.received with a gateway-style JID and profile name', () => {
    const events = translateCloudWebhook(
      envelope({
        contacts: [{ wa_id: '919876543210', profile: { name: 'Asha Travels' } }],
        messages: [{ id: 'wamid.A', from: '919876543210', type: 'text', text: { body: 'Interested' } }],
      }),
    );
    expect(events).toEqual([
      {
        event: 'message.received',
        idempotencyKey: 'cloud:wamid.A',
        data: expect.objectContaining({
          id: 'wamid.A',
          from: '919876543210@c.us',
          body: 'Interested',
          type: 'text',
          sessionId: 'cloud:111',
          profileName: 'Asha Travels',
          fromMe: false,
        }),
      },
    ]);
  });

  it('treats a template quick-reply button as a reply and ignores reactions', () => {
    const events = translateCloudWebhook(
      envelope({
        messages: [
          { id: 'wamid.B', from: '91999', type: 'button', button: { text: 'Yes, send details' } },
          { id: 'wamid.C', from: '91999', type: 'reaction', reaction: { emoji: '👍' } },
        ],
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0].data.body).toBe('Yes, send details');
  });

  it('gives each status its own dedup key so delivered is not swallowed by sent', () => {
    const events = translateCloudWebhook(
      envelope({
        statuses: [
          { id: 'wamid.X', status: 'sent' },
          { id: 'wamid.X', status: 'delivered' },
          { id: 'wamid.X', status: 'read' },
        ],
      }),
    );
    expect(events.map((e) => e.idempotencyKey)).toEqual([
      'cloud:wamid.X:sent',
      'cloud:wamid.X:delivered',
      'cloud:wamid.X:read',
    ]);
    expect(events.every((e) => e.event === 'message.ack')).toBe(true);
    expect(events[1].data).toEqual({ id: 'wamid.X', ack: 'delivered' });
  });

  it('turns a failed status into message.failed with Meta’s reason', () => {
    const [evt] = translateCloudWebhook(
      envelope({
        statuses: [
          {
            id: 'wamid.F',
            status: 'failed',
            errors: [{ code: 131047, title: 'Re-engagement message', error_data: { details: 'More than 24 hours have passed' } }],
          },
        ],
      }),
    );
    expect(evt.event).toBe('message.failed');
    expect(evt.data.reason).toBe('(#131047) Re-engagement message - More than 24 hours have passed');
  });

  it('ignores payloads that are not WhatsApp business account events', () => {
    expect(translateCloudWebhook({ object: 'page', entry: [] })).toEqual([]);
    expect(translateCloudWebhook(null)).toEqual([]);
  });
});

describe('WhatsappSenderService routing', () => {
  function make(provider: 'session' | 'cloud') {
    const openwa = {
      resolveSessionId: vi.fn(async (p?: string | null) => p ?? 'uuid-1'),
      sendText: vi.fn(async () => ({ messageId: 'openwa-1' })),
      checkNumber: vi.fn(async () => false),
      assertSendable: vi.fn(async () => undefined),
      invalidateSessionCache: vi.fn(),
    };
    const cloud = {
      getProvider: vi.fn(async () => provider),
      sessionId: vi.fn(async () => 'cloud:111'),
      sendText: vi.fn(async () => ({ messageId: 'wamid.1' })),
      sendTemplate: vi.fn(async () => ({ messageId: 'wamid.2' })),
    };
    return { svc: new WhatsappSenderService(openwa as any, cloud as any), openwa, cloud };
  }

  it('resolves to the Cloud API number while the cloud provider is active', async () => {
    const { svc, openwa } = make('cloud');
    const id = await svc.resolveSessionId('campaign-session-uuid');
    expect(id).toBe('cloud:111');
    expect(isCloudSessionId(id)).toBe(true);
    expect(openwa.resolveSessionId).not.toHaveBeenCalled();
  });

  it('keeps using the session gateway, and never passes it a cloud id', async () => {
    const { svc, openwa } = make('session');
    await svc.resolveSessionId('cloud:111');
    expect(openwa.resolveSessionId).toHaveBeenCalledWith(null);
  });

  it('routes sends by the resolved id, not by the current setting', async () => {
    const { svc, openwa, cloud } = make('session');
    await svc.sendText('cloud:111', '919876543210@c.us', 'hi');
    await svc.sendText('uuid-1', '919876543210@c.us', 'hi');
    expect(cloud.sendText).toHaveBeenCalledWith('919876543210@c.us', 'hi');
    expect(openwa.sendText).toHaveBeenCalledWith('uuid-1', '919876543210@c.us', 'hi');
  });

  it('does not suppress contacts on the Cloud API, which has no number lookup', async () => {
    const { svc, openwa } = make('cloud');
    expect(await svc.checkNumber('cloud:111', '919876543210')).toBe(true);
    expect(openwa.checkNumber).not.toHaveBeenCalled();
  });

  it('refuses a Meta template through the session gateway', () => {
    const { svc } = make('session');
    expect(() => svc.sendTemplate('uuid-1', 'x@c.us', 'intro', 'en', [])).toThrow(/Cloud API/);
  });
});

describe('WhatsappCloudService.toRecipient', () => {
  it('strips the plus, the JID suffix and formatting', () => {
    expect(WhatsappCloudService.toRecipient('+91 98765-43210')).toBe('919876543210');
    expect(WhatsappCloudService.toRecipient('919876543210@c.us')).toBe('919876543210');
  });
});
