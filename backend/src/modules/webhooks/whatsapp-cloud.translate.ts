/**
 * Translate a Meta WhatsApp Cloud API webhook into the portal's internal events.
 *
 * The inbound pipeline (replies, leads, AI analysis, delivery stats) was built around the
 * session gateway's event names: `message.received`, `message.ack`, `message.failed`.
 * Mapping Meta's payload onto those same events means both transports share one
 * pipeline, so every guard and stat behaves identically whichever one is connected.
 *
 * Pure function, so the mapping can be tested without Nest or a network.
 */

export interface InternalWebhookEvent {
  event: 'message.received' | 'message.ack' | 'message.failed';
  /** Dedup key: one per message per status, so `sent` never swallows `delivered`. */
  idempotencyKey: string;
  data: Record<string, unknown>;
}

/** Turn an inbound Cloud API message into display text, or null to ignore it. */
function describeInbound(msg: any): { body: string; type: string } | null {
  switch (msg?.type) {
    case 'text':
      return { body: msg.text?.body ?? '', type: 'text' };
    case 'button':
      // Quick-reply button on a template. The prospect tapped it, so it is a real reply.
      return { body: msg.button?.text ?? msg.button?.payload ?? '', type: 'text' };
    case 'interactive': {
      const i = msg.interactive ?? {};
      const title = i.button_reply?.title ?? i.list_reply?.title ?? i.nfm_reply?.body ?? '';
      return { body: title, type: 'text' };
    }
    case 'image':
    case 'video':
    case 'document':
    case 'audio':
    case 'sticker': {
      const media = msg[msg.type] ?? {};
      const caption = media.caption ?? media.filename ?? '';
      return { body: caption || `[${msg.type}]`, type: msg.type };
    }
    case 'location': {
      const l = msg.location ?? {};
      const label = [l.name, l.address].filter(Boolean).join(', ');
      return { body: `[location] ${label || `${l.latitude},${l.longitude}`}`, type: 'text' };
    }
    case 'contacts':
      return { body: '[contact card]', type: 'text' };
    // Reactions, system notices and unsupported types are not replies a salesperson
    // should act on, and counting them would inflate the reply rate.
    default:
      return null;
  }
}

export function translateCloudWebhook(payload: any): InternalWebhookEvent[] {
  const out: InternalWebhookEvent[] = [];
  if (payload?.object !== 'whatsapp_business_account') return out;

  for (const entry of payload.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== 'messages') continue;
      const value = change.value ?? {};
      const phoneNumberId: string | undefined = value.metadata?.phone_number_id;
      const sessionId = phoneNumberId ? `cloud:${phoneNumberId}` : null;
      const names = new Map<string, string>();
      for (const c of value.contacts ?? []) {
        if (c?.wa_id && c?.profile?.name) names.set(String(c.wa_id), c.profile.name);
      }

      for (const msg of value.messages ?? []) {
        const described = describeInbound(msg);
        if (!described || !msg?.id || !msg?.from) continue;
        const from = String(msg.from).replace(/[^\d]/g, '');
        out.push({
          event: 'message.received',
          idempotencyKey: `cloud:${msg.id}`,
          data: {
            id: msg.id,
            // Same JID shape the session gateway uses, so contact matching and the
            // stored chat id stay consistent across both transports.
            from: `${from}@c.us`,
            body: described.body,
            type: described.type,
            mediaUrl: null,
            sessionId,
            profileName: names.get(from) ?? null,
            fromMe: false,
          },
        });
      }

      for (const st of value.statuses ?? []) {
        if (!st?.id || !st?.status) continue;
        if (st.status === 'failed') {
          const err = st.errors?.[0] ?? {};
          const detail = err.error_data?.details;
          const reason = [
            err.code ? `(#${err.code})` : null,
            err.title ?? err.message ?? 'Delivery failed',
            detail ? `- ${detail}` : null,
          ]
            .filter(Boolean)
            .join(' ');
          out.push({
            event: 'message.failed',
            idempotencyKey: `cloud:${st.id}:failed`,
            data: { id: st.id, reason },
          });
        } else if (st.status === 'sent' || st.status === 'delivered' || st.status === 'read') {
          out.push({
            event: 'message.ack',
            idempotencyKey: `cloud:${st.id}:${st.status}`,
            data: { id: st.id, ack: st.status },
          });
        }
      }
    }
  }
  return out;
}
