/**
 * Campaign counters must match reality.
 *
 * A campaign that had actually sent 3 messages reported 6. WhatsApp acks the same message
 * repeatedly as it progresses (sent, then delivered, then read) and re-acks on reconnect,
 * while the send path already counts the send at enqueue time — so incrementing on every
 * ack double-counted every send and inflated delivered/read on each redelivery.
 *
 * The bug was invisible until a webhook was registered, because before that no ack ever
 * arrived. Reported numbers are what an operator judges deliverability and ban risk by, so
 * a stat that overstates reach is actively misleading.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhooksService } from '../modules/webhooks/webhooks.service';

/** Ack levels as WhatsApp reports them. */
const ACK = { SENT: 1, DELIVERED: 2, READ: 3 } as const;

function makeService() {
  const message: any = {
    id: 'm1',
    campaign_contact_id: 'cc1',
    contact_id: 'ct1',
    status: 'sent',
    sent_at: new Date(),
    delivered_at: null,
    read_at: null,
  };
  const campaignContact: any = { id: 'cc1', campaign_id: 'camp1', status: 'sent' };
  const increments: { field: string; by: number }[] = [];

  const svc = Object.create(WebhooksService.prototype) as any;
  svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  svc.messageRepo = {
    findOne: vi.fn(async () => message),
    save: vi.fn(async (m: any) => Object.assign(message, m)),
  };
  svc.campaignContactRepo = {
    findOne: vi.fn(async () => campaignContact),
    save: vi.fn(async (c: any) => Object.assign(campaignContact, c)),
  };
  svc.campaignRepo = {
    increment: vi.fn(async (_w: any, field: string, by: number) => {
      increments.push({ field, by });
    }),
  };

  return { svc, message, campaignContact, increments };
}

/** Total counted for one field across every ack processed. */
const totalFor = (incs: { field: string; by: number }[], field: string) =>
  incs.filter((i) => i.field === field).reduce((n, i) => n + i.by, 0);

describe('ack handling does not inflate stats_sent', () => {
  let h: ReturnType<typeof makeService>;
  beforeEach(() => {
    h = makeService();
  });

  it('never counts a send again, because the sender already did', async () => {
    await h.svc.handleMessageAck({ messageId: 'm1', ack: ACK.SENT });
    // The single source of truth for stats_sent is the send path.
    expect(totalFor(h.increments, 'stats_sent')).toBe(0);
  });

  it('counts a delivery exactly once, however many acks arrive', async () => {
    for (let i = 0; i < 4; i++) {
      await h.svc.handleMessageAck({ messageId: 'm1', ack: ACK.DELIVERED });
    }
    expect(totalFor(h.increments, 'stats_delivered')).toBe(1);
  });

  it('counts a read exactly once, however many acks arrive', async () => {
    await h.svc.handleMessageAck({ messageId: 'm1', ack: ACK.DELIVERED });
    for (let i = 0; i < 3; i++) {
      await h.svc.handleMessageAck({ messageId: 'm1', ack: ACK.READ });
    }
    expect(totalFor(h.increments, 'stats_read')).toBe(1);
  });

  it('counts each stage once across a full sent -> delivered -> read lifecycle', async () => {
    for (const ack of [ACK.SENT, ACK.DELIVERED, ACK.READ]) {
      await h.svc.handleMessageAck({ messageId: 'm1', ack });
    }
    expect(totalFor(h.increments, 'stats_sent')).toBe(0);
    expect(totalFor(h.increments, 'stats_delivered')).toBe(1);
    expect(totalFor(h.increments, 'stats_read')).toBe(1);
  });

  it('does not count backwards when a late, stale ack arrives', async () => {
    await h.svc.handleMessageAck({ messageId: 'm1', ack: ACK.READ });
    const afterRead = h.increments.length;

    // Out-of-order delivery is normal on reconnect; a delivered ack after a read must not
    // add to delivered, since the message had already progressed past it.
    await h.svc.handleMessageAck({ messageId: 'm1', ack: ACK.DELIVERED });
    expect(h.increments.length).toBe(afterRead);
    expect(h.campaignContact.status).toBe('read');
  });

  it('still records the timestamps, so the message history stays accurate', async () => {
    await h.svc.handleMessageAck({ messageId: 'm1', ack: ACK.DELIVERED });
    expect(h.message.delivered_at).toBeInstanceOf(Date);

    await h.svc.handleMessageAck({ messageId: 'm1', ack: ACK.READ });
    expect(h.message.read_at).toBeInstanceOf(Date);
  });

  it('counts nothing for a message that belongs to no campaign', async () => {
    h.message.campaign_contact_id = null;
    await h.svc.handleMessageAck({ messageId: 'm1', ack: ACK.DELIVERED });
    expect(h.increments).toHaveLength(0);
  });
});
