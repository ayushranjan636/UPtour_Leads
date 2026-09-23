import { useEffect, useState, useCallback, useRef, Fragment } from 'react';
import { Link } from 'react-router-dom';
import {
  Input,
  Typography,
  Flex,
  Avatar,
  Button,
  Card,
  Progress,
  Spin,
  Empty,
  Alert,
  Tag,
  Tooltip,
  message,
} from 'antd';
import {
  SearchOutlined,
  SendOutlined,
  RobotOutlined,
  MessageOutlined,
  PaperClipOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import DatasetFilter, {
  EMPTY_DATASET_FILTER,
  isDatasetFilterEmpty,
  type DatasetFilterValue,
} from '../components/DatasetFilter';
import {
  contactsAPI,
  gatewayAPI,
  messagesAPI,
  type WhatsAppConnection,
} from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';

const { Text } = Typography;

interface Contact {
  id: string;
  name: string;
  whatsapp_number: string;
  company?: { name: string };
}

interface Msg {
  id: string;
  // Must match MessageDirection in backend/src/entities/message.entity.ts.
  // `incoming` is a message the contact sent us; it arrives through the
  // `message.received` webhook and has no delivery state of *ours*.
  direction: 'incoming' | 'outgoing';
  body: string;
  /**
   * The only timestamp populated for both directions — see `messageTime`.
   * `@CreateDateColumn` on the entity, so never null.
   */
  created_at: string;
  type?: string;
  media_url?: string | null;
  /**
   * True when the assistant composed the body, false for a human or template
   * send. Surfaced as an always-visible "AI" tag: an operator must be able to
   * audit what was said automatically on the account's behalf.
   */
  is_ai_generated?: boolean;
  status?: string;
  /** Populated by the backend when a send fails; surfaced as a tooltip. */
  failed_reason?: string;
  /** Outgoing only — the inbound webhook never sets this. */
  sent_at?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
  // Backend attaches `ai_analyses` (plural, an array) — see
  // backend/src/modules/messages/messages.service.ts. We normalise it to a
  // single `ai_analysis` in fetchMessages below.
  ai_analyses?: AiAnalysis[];
  ai_analysis?: AiAnalysis;
}

interface AiAnalysis {
  intent?: string;
  /** Enum string: high | medium | low | none */
  interest_level?: string;
  /** 0..1 */
  confidence?: number;
  lead_score?: number;
}

/** How often the gateway's pairing state is re-checked while the page is open. */
const CONNECTION_POLL_MS = 30_000;

/**
 * How often the open thread is re-fetched, so a reply that arrives via the
 * `message.received` webhook (or an AI auto-reply to it) shows up without a
 * manual refresh. Deliberately slower than a chat app would poll: the payload
 * carries AI analyses and this runs for as long as the page is open.
 */
const MESSAGES_POLL_MS = 10_000;

/**
 * The instant a message is placed in the thread.
 *
 * `created_at` and not `sent_at`: `sent_at` is only written on the outbound path
 * (and is null for a queued or failed send), while the inbound webhook never sets
 * it at all — sorting on it would pile every received message at the epoch.
 * `created_at` is a `@CreateDateColumn`, so it is non-null for both directions.
 *
 * Returns NaN for an unparseable value, which `byTimeAsc` pushes to the end
 * rather than to 1970.
 */
function messageTime(msg: Msg): number {
  return msg.created_at ? new Date(msg.created_at).getTime() : Number.NaN;
}

/** Oldest → newest, id as a stable tie-break for messages saved in the same ms. */
function byTimeAsc(a: Msg, b: Msg): number {
  const ta = messageTime(a);
  const tb = messageTime(b);
  // An undated row sorts last: it is almost certainly the newest thing we just
  // wrote, and it must never jump above dated history.
  if (Number.isNaN(ta)) return Number.isNaN(tb) ? 0 : 1;
  if (Number.isNaN(tb)) return -1;
  if (ta !== tb) return ta - tb;
  return a.id.localeCompare(b.id);
}

/** Calendar-day key used to decide where a day separator belongs. */
function dayKey(msg: Msg): string {
  const t = messageTime(msg);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Today" / "Yesterday" / "12 Mar 2026" for a day separator. */
function dayLabel(msg: Msg): string {
  const t = messageTime(msg);
  if (Number.isNaN(t)) return 'Unknown date';
  const d = new Date(t);
  const today = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const daysAgo = Math.round((startOfDay(today) - startOfDay(d)) / 86_400_000);
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  return d.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

export default function Conversations() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [datasets, setDatasets] = useState<DatasetFilterValue>(EMPTY_DATASET_FILTER);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  /** null until the first probe resolves, so nothing is claimed before it is known. */
  const [connection, setConnection] = useState<WhatsAppConnection | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /*
   * Sending is gated on the gateway actually being paired. Previously the composer
   * looked identical whether or not WhatsApp was connected, so the only feedback was
   * a failed send after the message had been typed.
   *
   * `connected: false` is the explicit blocker; a probe that never resolves leaves
   * `connection` null, and the composer stays enabled rather than locking the
   * operator out of a gateway that might be fine.
   */
  const gatewayDown = connection !== null && !connection.connected;

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const { data } = await gatewayAPI.connection();
        if (!cancelled) setConnection(data);
      } catch {
        // The endpoint reports an unreachable gateway in its payload rather than
        // throwing, so a thrown error means the portal API itself is unreachable —
        // a different problem, and not grounds for blocking the composer.
        if (!cancelled) setConnection(null);
      }
    };
    probe();
    const timer = setInterval(probe, CONNECTION_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const fetchContacts = useCallback(async () => {
    setLoadingContacts(true);
    try {
      const params: Record<string, unknown> = {
        page: 1,
        limit: 100,
        search: searchText || undefined,
      };
      if (datasets.collection_job_ids.length) {
        params.collection_job_ids = datasets.collection_job_ids;
      }
      if (datasets.import_file_ids.length) {
        params.import_file_ids = datasets.import_file_ids;
      }
      const { data: res } = await contactsAPI.list(params);
      setContacts(res.data ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoadingContacts(false);
    }
    // `datasets` is rebuilt on every change, so depend on its serialised form.
  }, [searchText, JSON.stringify(datasets)]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  /**
   * Loads the thread for a contact.
   *
   * `quiet` suppresses the spinner and the on-error blanking, so the 10s poll can
   * refresh in place: a single failed poll must never wipe a thread the operator is
   * reading, and must never flash a spinner over it.
   *
   * `isStale` is consulted immediately before every `setState`. Two overlapping
   * requests (a poll in flight when the operator switches contact, or two polls
   * racing on a slow link) would otherwise let the older response land last and
   * clobber newer state, or paint contact A's thread under contact B's header.
   */
  const fetchMessages = useCallback(
    async (
      contactId: string,
      { quiet = false, isStale }: { quiet?: boolean; isStale?: () => boolean } = {},
    ) => {
      if (!quiet) setLoadingMessages(true);
      try {
        const { data: res } = await messagesAPI.getConversation(contactId, { page: 1, limit: 50 });
        // `GET /messages/conversation/:id` answers with a PaginatedResponseDto —
        // `{ data, total, page, limit, totalPages }` — so the rows are one level
        // in. The bare-array branch is kept as a fallback only.
        const raw: Msg[] = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        // Flatten `ai_analyses[]` down to the most recent single analysis so the
        // UI can render it directly.
        const msgs = raw.map((m) => ({
          ...m,
          ai_analysis: m.ai_analysis ?? m.ai_analyses?.[0],
        }));
        // The backend orders `created_at DESC` for pagination. Sort rather than
        // merely reverse: the returned page is ordered by the server's clock, and
        // an explicit oldest→newest sort is what the transcript actually needs.
        if (isStale?.()) return;
        setMessages(msgs.sort(byTimeAsc));
      } catch {
        if (isStale?.()) return;
        if (!quiet) setMessages([]);
      } finally {
        if (!quiet && !isStale?.()) setLoadingMessages(false);
      }
    },
    [],
  );

  // Identity, not the object: `contacts` is refetched whenever the search text or
  // dataset filter changes, and re-running the thread fetch for that is pointless.
  const selectedContactId = selectedContact?.id ?? null;

  /**
   * Loads the selected thread, then polls it. Inbound messages arrive server-side
   * through the `message.received` webhook, so without this an operator would have
   * to reload the page to see a reply — or the AI's answer to it.
   */
  useEffect(() => {
    // No contact selected: the pane shows the "Select a contact" empty state, so
    // whatever is in `messages` is unreachable and clearing it would only cost an
    // extra render.
    if (!selectedContactId) return;
    let cancelled = false;
    const isStale = () => cancelled;
    fetchMessages(selectedContactId, { isStale });
    const timer = setInterval(() => {
      fetchMessages(selectedContactId, { quiet: true, isStale });
    }, MESSAGES_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedContactId, fetchMessages]);

  const newestMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;

  /*
   * Stick to the newest message on load, on send, and when a reply arrives — but
   * not on every poll. Depending on `messages` would re-scroll every 10s even when
   * nothing changed, yanking the view out from under anyone reading back through
   * history.
   */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [selectedContactId, newestMessageId]);

  const handleSend = async () => {
    if (!messageText.trim() || !selectedContact || gatewayDown) return;
    setSending(true);
    try {
      await messagesAPI.send({ contactId: selectedContact.id, body: messageText });
      // Cleared only on success, so a failure never costs the draft.
      setMessageText('');
      // `quiet`: the thread is already on screen, so refresh it in place instead of
      // replacing it with a spinner.
      fetchMessages(selectedContact.id, { quiet: true });
    } catch (err: unknown) {
      // The backend now returns a real error status (503 when WhatsApp is not
      // connected, 400 for an opted-out contact) instead of 201 with a failed row,
      // so show its message rather than a generic string. Keep the draft text so
      // the operator does not have to retype it.
      const detail = (err as { response?: { data?: { message?: string | string[] } } })
        ?.response?.data?.message;
      // Nest's validation errors arrive as an array of strings.
      const text = Array.isArray(detail) ? detail.join('. ') : detail;
      message.error(text ?? 'Could not send the message. Check that WhatsApp is connected.');
      // Refresh anyway: the failed attempt is persisted and should appear as ⚠.
      fetchMessages(selectedContact.id, { quiet: true });
    } finally {
      setSending(false);
    }
  };

  const selectContact = (contact: Contact) => {
    setSelectedContact(contact);
  };

  if (!loadingContacts && contacts.length === 0 && !searchText && isDatasetFilterEmpty(datasets)) {
    return (
      <div>
        <PageHeader title="Conversations" subtitle="WhatsApp messaging" />
        <Flex justify="center" style={{ padding: '80px 0' }}>
          <Empty
            image={<MessageOutlined style={{ fontSize: 64, color: color.textTertiary }} />}
            description={
              <div style={{ marginTop: space.lg }}>
                <Text
                  strong
                  style={{
                    fontSize: font.size.headline,
                    display: 'block',
                    marginBottom: space.sm,
                    color: color.text,
                  }}
                >
                  No conversations yet
                </Text>
                <Text style={{ color: color.textSecondary }}>
                  Add contacts and start campaigns to begin conversations.
                </Text>
              </div>
            }
          />
        </Flex>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Conversations" subtitle="WhatsApp messaging" />

      <div
        style={{
          display: 'flex',
          height: 'calc(100vh - 180px)',
          background: color.surface,
          borderRadius: radius.xl,
          overflow: 'hidden',
          border: `1px solid ${color.separator}`,
        }}
      >
        {/* Left panel — contact list */}
        <div
          style={{
            width: 340,
            borderRight: `1px solid ${color.separator}`,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: '16px 16px 12px' }}>
            <Flex vertical gap={space.sm}>
              <Input
                placeholder="Search contacts..."
                aria-label="Search contacts"
                prefix={<SearchOutlined style={{ color: color.textTertiary }} />}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                allowClear
                style={{ borderRadius: radius.lg }}
              />
              {/* Narrows the list to one scrape or upload, so an operator working
                  through a single batch is not scrolling past every other contact. */}
              <DatasetFilter
                value={datasets}
                onChange={setDatasets}
                style={{ width: '100%', minWidth: 0 }}
              />
            </Flex>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loadingContacts ? (
              <Flex justify="center" style={{ padding: space.xl }}>
                <Spin />
              </Flex>
            ) : contacts.length === 0 ? (
              <Flex justify="center" style={{ padding: space.xl }}>
                <Text style={{ color: color.textTertiary }}>
                  {isDatasetFilterEmpty(datasets)
                    ? 'No contacts found'
                    : 'No contacts in the selected datasets'}
                </Text>
              </Flex>
            ) : (
              contacts.map((contact) => (
                <div
                  key={contact.id}
                  onClick={() => selectContact(contact)}
                  style={{
                    padding: '14px 16px',
                    cursor: 'pointer',
                    background:
                      selectedContact?.id === contact.id ? color.accentSoft : 'transparent',
                    // Selection is signalled by the tint *and* the leading accent
                    // bar, so it never relies on colour perception alone. The
                    // transparent border keeps unselected rows aligned.
                    borderLeft: `3px solid ${
                      selectedContact?.id === contact.id ? color.accent : 'transparent'
                    }`,
                    borderBottom: `1px solid ${color.separator}`,
                    transition: 'background 0.15s',
                  }}
                >
                  <Flex gap={space.md} align="flex-start">
                    <Avatar
                      size={42}
                      style={{
                        background: color.accentSoft,
                        color: color.accent,
                        fontWeight: font.weight.semibold,
                        fontSize: font.size.body,
                        flexShrink: 0,
                      }}
                    >
                      {contact.name?.charAt(0)?.toUpperCase() ?? '?'}
                    </Avatar>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text strong style={{ fontSize: font.size.body, color: color.text }}>
                        {contact.name}
                      </Text>
                      {contact.company?.name && (
                        <Text
                          style={{
                            fontSize: font.size.caption,
                            color: color.textSecondary,
                            display: 'block',
                          }}
                        >
                          {contact.company.name}
                        </Text>
                      )}
                      <Text
                        style={{
                          fontSize: font.size.caption,
                          color: color.textTertiary,
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {contact.whatsapp_number}
                      </Text>
                    </div>
                  </Flex>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right panel — chat */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {!selectedContact ? (
            <Flex
              justify="center"
              align="center"
              style={{ flex: 1, background: color.fill }}
            >
              <Empty description="Select a contact to start a conversation" />
            </Flex>
          ) : (
            <>
              {/* Chat header */}
              <div
                style={{
                  padding: '12px 20px',
                  borderBottom: `1px solid ${color.separator}`,
                  background: color.fill,
                }}
              >
                <Flex align="center" gap={space.md}>
                  <Avatar
                    size={38}
                    style={{
                      background: color.accentSoft,
                      color: color.accent,
                      fontWeight: font.weight.semibold,
                      fontSize: font.size.body,
                    }}
                  >
                    {selectedContact.name?.charAt(0)?.toUpperCase() ?? '?'}
                  </Avatar>
                  <div>
                    <Text strong style={{ display: 'block', fontSize: font.size.body }}>
                      {selectedContact.name}
                    </Text>
                    <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
                      {selectedContact.whatsapp_number}
                    </Text>
                  </div>
                </Flex>
              </div>

              {/* Messages */}
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '20px 24px',
                  // The transcript sits on `surface` so incoming bubbles (which use
                  // the quiet `fill` token) stay clearly distinguishable from the
                  // pane behind them without needing a second grey.
                  background: color.surface,
                }}
              >
                {loadingMessages ? (
                  <Flex justify="center" style={{ padding: 40 }}>
                    <Spin />
                  </Flex>
                ) : messages.length === 0 ? (
                  <Flex justify="center" style={{ padding: 40 }}>
                    <Empty description="No messages yet. Send the first message below." />
                  </Flex>
                ) : (
                  messages.map((msg, i) => {
                    const isOut = msg.direction === 'outgoing';
                    const prev = i > 0 ? messages[i - 1] : null;
                    // The thread is already oldest→newest, so a change of calendar
                    // day between neighbours is exactly where a separator belongs.
                    const showDay = !prev || dayKey(prev) !== dayKey(msg);
                    const analysis = msg.ai_analysis;
                    const showAnalysis = Boolean(
                      analysis && (analysis.intent || analysis.interest_level),
                    );

                    return (
                      <Fragment key={msg.id}>
                        {showDay && <DaySeparator label={dayLabel(msg)} />}
                        <MsgBubble msg={msg} isOut={isOut} />
                        {showAnalysis && analysis && (
                          <Flex justify="center" style={{ margin: '8px 0' }}>
                            <Card
                              size="small"
                              style={{
                                borderRadius: radius.lg,
                                background: color.warningSoft,
                                border: `1px solid ${color.separator}`,
                                maxWidth: 320,
                              }}
                              styles={{ body: { padding: '10px 14px' } }}
                            >
                              <Flex align="center" gap={6} style={{ marginBottom: 6 }}>
                                <RobotOutlined
                                  style={{ color: color.warning, fontSize: font.size.footnote }}
                                />
                                <Text
                                  style={{
                                    fontSize: font.size.caption,
                                    color: color.warning,
                                    fontWeight: font.weight.semibold,
                                  }}
                                >
                                  AI Analysis
                                </Text>
                              </Flex>
                              {analysis.intent && (
                                <Text
                                  style={{
                                    fontSize: font.size.caption,
                                    display: 'block',
                                    color: color.textSecondary,
                                    marginBottom: space.xs,
                                  }}
                                >
                                  Intent:{' '}
                                  <Text strong style={{ color: color.text }}>
                                    {analysis.intent}
                                  </Text>
                                </Text>
                              )}
                              {analysis.interest_level != null && (
                                <Flex align="center" gap={space.sm} style={{ marginBottom: space.xs }}>
                                  <Text
                                    style={{
                                      fontSize: font.size.caption,
                                      color: color.textSecondary,
                                    }}
                                  >
                                    Interest
                                  </Text>
                                  <Text
                                    strong
                                    style={{
                                      fontSize: font.size.caption,
                                      color: color.text,
                                      textTransform: 'capitalize',
                                    }}
                                  >
                                    {analysis.interest_level}
                                  </Text>
                                </Flex>
                              )}
                              {analysis.confidence != null && (
                                <Flex align="center" gap={space.sm}>
                                  <Text
                                    style={{
                                      fontSize: font.size.caption,
                                      color: color.textSecondary,
                                    }}
                                  >
                                    Confidence
                                  </Text>
                                  <Progress
                                    /* confidence is 0..1 from the model */
                                    percent={Math.round(analysis.confidence * 100)}
                                    size={['100px', 6]}
                                    strokeColor={color.success}
                                    trailColor={color.successSoft}
                                    format={(p) => (
                                      <Text
                                        style={{
                                          fontSize: font.size.caption,
                                          color: color.textSecondary,
                                        }}
                                      >
                                        {p}%
                                      </Text>
                                    )}
                                  />
                                </Flex>
                              )}
                            </Card>
                          </Flex>
                        )}
                      </Fragment>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message input */}
              <div
                style={{
                  padding: '12px 20px',
                  borderTop: `1px solid ${color.separator}`,
                  background: color.surface,
                }}
              >
                {gatewayDown && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: space.sm, borderRadius: radius.md }}
                    // antd 6 renamed Alert's `message` to `title`; the old name still
                    // works but logs a deprecation warning.
                    title="WhatsApp is not connected"
                    description={
                      <Flex vertical gap={space.xs}>
                        {/* The API's own explanation: it distinguishes a session that
                            needs scanning from a gateway process that is down, which
                            need different fixes. */}
                        <Text style={{ fontSize: font.size.footnote, color: color.textSecondary }}>
                          {connection?.message ??
                            'No WhatsApp session is linked, so messages cannot be sent.'}
                        </Text>
                        <Link to="/settings" style={{ fontSize: font.size.footnote }}>
                          Open Settings to link WhatsApp
                        </Link>
                      </Flex>
                    }
                  />
                )}
                <Flex gap={space.sm} align="center">
                  <Input
                    placeholder={
                      gatewayDown ? 'Connect WhatsApp to send messages' : 'Type a message...'
                    }
                    aria-label="Message to send"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    style={{ borderRadius: radius.pill, paddingLeft: space.lg }}
                    onPressEnter={handleSend}
                    disabled={sending || gatewayDown}
                  />
                  <Button
                    type="primary"
                    shape="circle"
                    aria-label="Send message"
                    title={gatewayDown ? 'WhatsApp is not connected' : 'Send message'}
                    icon={<SendOutlined />}
                    loading={sending}
                    disabled={gatewayDown}
                    onClick={handleSend}
                    // Explicit accent only while enabled: antd's disabled styling has
                    // to win, or a dead button would still look like a live one.
                    style={
                      gatewayDown
                        ? undefined
                        : {
                            background: color.accent,
                            borderColor: color.accent,
                            color: color.textOnAccent,
                          }
                    }
                  />
                </Flex>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Human-readable tooltip for a delivery state. Module scope so `MsgBubble` (a
 * sibling component, not nested) can use it.
 *
 * Outbound only — an incoming message has no delivery state *of ours*, so the
 * caller must never reach here for one.
 */
function statusLabel(status?: string, failedReason?: string): string {
  if (status === 'failed') return failedReason ? `Failed: ${failedReason}` : 'Failed to send';
  if (status === 'queued') return 'Queued — not yet sent';
  if (status === 'read') return 'Read';
  if (status === 'delivered') return 'Delivered';
  if (status === 'sent') return 'Sent';
  return status ?? '';
}

/** Glyph for a delivery state. */
function statusGlyph(status: string): string {
  // `failed` and `queued` previously both rendered a plain "✓",
  // indistinguishable from a delivered message — so a dead gateway looked
  // exactly like a successful send.
  if (status === 'failed') return '⚠';
  if (status === 'queued') return '🕘';
  if (status === 'read' || status === 'delivered') return '✓✓';
  return '✓';
}

/**
 * Date heading between two messages on different calendar days.
 *
 * A thread can span weeks, and a bare "09:14" is ambiguous across days — without
 * this, yesterday's question and this morning's answer read as one exchange.
 */
function DaySeparator({ label }: { label: string }) {
  return (
    <Flex align="center" gap={space.md} style={{ margin: `${space.lg}px 0 ${space.md}px` }}>
      <div style={{ flex: 1, height: 1, background: color.separator }} />
      <Text
        style={{
          fontSize: font.size.caption,
          fontWeight: font.weight.medium,
          color: color.textSecondary,
          background: color.fill,
          border: `1px solid ${color.separator}`,
          borderRadius: radius.pill,
          padding: `2px ${space.md}px`,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </Text>
      <div style={{ flex: 1, height: 1, background: color.separator }} />
    </Flex>
  );
}

/**
 * One message in the transcript.
 *
 * Inbound and outbound differ on three independent axes, so the two are never told
 * apart by colour alone:
 *   - alignment — the contact's messages sit left, ours right;
 *   - surface — quiet `fill` with a hairline border, versus the solid accent;
 *   - tail — the squared corner points at the side the message came from.
 *
 * Delivery ticks are outbound-only: a received message has no delivery state of
 * ours to report, and showing one would claim we had delivered the contact's own
 * message back to them.
 */
function MsgBubble({ msg, isOut }: { msg: Msg; isOut: boolean }) {
  const time = msg.created_at
    ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';
  // Auditing requirement: every assistant-composed message is labelled, always
  // visible and never hover-only, so an operator can tell at a glance what was said
  // automatically on the account's behalf versus what a human typed.
  const isAi = msg.is_ai_generated === true;
  // A media message can arrive with an empty body; without this the bubble would be
  // blank and the attachment invisible.
  const hasMedia = Boolean(msg.media_url) || (msg.type != null && msg.type !== 'text');
  const body = msg.body?.trim();

  return (
    <Flex justify={isOut ? 'flex-end' : 'flex-start'} style={{ marginBottom: space.md }}>
      <div
        role="group"
        // Direction and provenance are announced, not only drawn — alignment and
        // surface convey nothing to a screen reader.
        aria-label={
          isOut
            ? `Sent message${isAi ? ', AI generated' : ''}${
                msg.status ? `, ${statusLabel(msg.status, msg.failed_reason)}` : ''
              }`
            : 'Received message'
        }
        style={{
          maxWidth: '65%',
          minWidth: 0,
          padding: '10px 14px',
          borderRadius: isOut
            ? `${radius.xl}px ${radius.xl}px ${space.xs}px ${radius.xl}px`
            : `${radius.xl}px ${radius.xl}px ${radius.xl}px ${space.xs}px`,
          // Outgoing: accent + textOnAccent (#FFFFFF on #0B6BCB ≈ 5.1:1, AA for
          // normal text). Incoming: quiet fill + primary label (≈ 16:1).
          background: isOut ? color.accent : color.fill,
          color: isOut ? color.textOnAccent : color.text,
          border: isOut ? `1px solid ${color.accent}` : `1px solid ${color.separator}`,
        }}
      >
        {isAi && (
          <Tag
            icon={<RobotOutlined />}
            style={{
              // On the accent fill the tag has to be lighter than its background to
              // read at all, so it inverts: opaque surface with accent text
              // (≈ 5.1:1). Inbound keeps the usual soft tint.
              background: isOut ? color.surface : color.accentSoft,
              color: color.accent,
              border: 'none',
              borderRadius: radius.sm,
              fontSize: font.size.caption,
              fontWeight: font.weight.semibold,
              lineHeight: '18px',
              padding: `1px ${space.sm}px`,
              margin: `0 0 ${space.xs}px`,
            }}
          >
            AI
          </Tag>
        )}
        {hasMedia && (
          <Flex align="center" gap={space.xs} style={{ marginBottom: body ? space.xs : 0 }}>
            <PaperClipOutlined
              style={{
                fontSize: font.size.footnote,
                color: isOut ? color.textOnAccent : color.textSecondary,
              }}
            />
            <Text
              style={{
                fontSize: font.size.footnote,
                color: isOut ? color.textOnAccent : color.textSecondary,
              }}
            >
              {msg.type && msg.type !== 'text' ? `Attachment · ${msg.type}` : 'Attachment'}
            </Text>
          </Flex>
        )}
        {body && (
          <Text
            style={{
              fontSize: font.size.body,
              lineHeight: 1.5,
              color: isOut ? color.textOnAccent : color.text,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              display: 'block',
            }}
          >
            {body}
          </Text>
        )}
        <Text
          style={{
            fontSize: font.size.caption,
            // Full-strength white rather than a translucent wash so the timestamp
            // and delivery ticks stay readable on the accent fill.
            color: isOut ? color.textOnAccent : color.textTertiary,
            display: 'block',
            // Trailing edge on both sides: the metadata sits at the tail of the
            // bubble, which mirrors the alignment rather than fighting it.
            textAlign: isOut ? 'right' : 'left',
            marginTop: space.xs,
          }}
        >
          {time}
          {/* Outbound only. `isOut` is the gate, not `msg.status`: inbound rows are
              persisted with status `delivered` by the webhook, so keying off the
              status alone would put our ticks on the contact's own messages. */}
          {isOut && msg.status && (
            <Tooltip title={statusLabel(msg.status, msg.failed_reason)}>
              <span
                style={{ marginLeft: space.xs }}
                // Kept alongside the Tooltip so the reason survives without a
                // pointer, and remains readable to assistive tech.
                title={statusLabel(msg.status, msg.failed_reason)}
                aria-label={statusLabel(msg.status, msg.failed_reason)}
              >
                {statusGlyph(msg.status)}
              </span>
            </Tooltip>
          )}
        </Text>
      </div>
    </Flex>
  );
}
