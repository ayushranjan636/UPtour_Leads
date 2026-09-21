import { useEffect, useState, useCallback, useRef } from 'react';
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
  message,
} from 'antd';
import {
  SearchOutlined,
  SendOutlined,
  RobotOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import { contactsAPI, messagesAPI } from '../services/endpoints';
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
  // Must match MessageDirection in backend/src/entities/message.entity.ts
  direction: 'incoming' | 'outgoing';
  body: string;
  created_at: string;
  status?: string;
  /** Populated by the backend when a send fails; surfaced as a tooltip. */
  failed_reason?: string;
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

export default function Conversations() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchContacts = useCallback(async () => {
    setLoadingContacts(true);
    try {
      const { data: res } = await contactsAPI.list({ page: 1, limit: 100, search: searchText || undefined });
      setContacts(res.data ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoadingContacts(false);
    }
  }, [searchText]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const fetchMessages = useCallback(async (contactId: string) => {
    setLoadingMessages(true);
    try {
      const { data: res } = await messagesAPI.getConversation(contactId, { page: 1, limit: 50 });
      const raw: Msg[] = Array.isArray(res.data) ? res.data : Array.isArray(res) ? res : [];
      // Flatten `ai_analyses[]` down to the most recent single analysis so the
      // UI can render it directly.
      const msgs = raw.map((m) => ({
        ...m,
        ai_analysis: m.ai_analysis ?? m.ai_analyses?.[0],
      }));
      setMessages(msgs.reverse());
    } catch {
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (selectedContact) {
      fetchMessages(selectedContact.id);
    }
  }, [selectedContact, fetchMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!messageText.trim() || !selectedContact) return;
    setSending(true);
    try {
      await messagesAPI.send({ contactId: selectedContact.id, body: messageText });
      setMessageText('');
      fetchMessages(selectedContact.id);
    } catch (err: unknown) {
      // The backend now returns a real error status (503 when WhatsApp is not
      // connected, 400 for an opted-out contact) instead of 201 with a failed row,
      // so show its message rather than a generic string. Keep the draft text so
      // the operator does not have to retype it.
      const detail = (err as { response?: { data?: { message?: string } } })?.response?.data
        ?.message;
      message.error(detail ?? 'Could not send the message. Check that WhatsApp is connected.');
      // Refresh anyway: the failed attempt is persisted and should appear as ⚠.
      fetchMessages(selectedContact.id);
    } finally {
      setSending(false);
    }
  };

  /** Human-readable tooltip for a delivery state. */

  const selectContact = (contact: Contact) => {
    setSelectedContact(contact);
  };

  if (!loadingContacts && contacts.length === 0 && !searchText) {
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
            <Input
              placeholder="Search contacts..."
              prefix={<SearchOutlined style={{ color: color.textTertiary }} />}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              allowClear
              style={{ borderRadius: radius.lg }}
            />
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loadingContacts ? (
              <Flex justify="center" style={{ padding: space.xl }}>
                <Spin />
              </Flex>
            ) : contacts.length === 0 ? (
              <Flex justify="center" style={{ padding: space.xl }}>
                <Text style={{ color: color.textTertiary }}>No contacts found</Text>
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
                  messages.map((msg) => {
                    const isOut = msg.direction === 'outgoing';

                    if (msg.ai_analysis && (msg.ai_analysis.intent || msg.ai_analysis.interest_level)) {
                      return (
                        <div key={`ai-${msg.id}`}>
                          <MsgBubble msg={msg} isOut={isOut} />
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
                              {msg.ai_analysis.intent && (
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
                                    {msg.ai_analysis.intent}
                                  </Text>
                                </Text>
                              )}
                              {msg.ai_analysis.interest_level != null && (
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
                                    {msg.ai_analysis.interest_level}
                                  </Text>
                                </Flex>
                              )}
                              {msg.ai_analysis.confidence != null && (
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
                                    percent={Math.round(msg.ai_analysis.confidence * 100)}
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
                        </div>
                      );
                    }

                    return <MsgBubble key={msg.id} msg={msg} isOut={isOut} />;
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
                <Flex gap={space.sm} align="center">
                  <Input
                    placeholder="Type a message..."
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    style={{ borderRadius: radius.pill, paddingLeft: space.lg }}
                    onPressEnter={handleSend}
                    disabled={sending}
                  />
                  <Button
                    type="primary"
                    shape="circle"
                    icon={<SendOutlined />}
                    loading={sending}
                    onClick={handleSend}
                    style={{
                      background: color.accent,
                      borderColor: color.accent,
                      color: color.textOnAccent,
                    }}
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
 */
function statusLabel(status?: string, failedReason?: string): string {
  if (status === 'failed') return failedReason ? `Failed: ${failedReason}` : 'Failed to send';
  if (status === 'queued') return 'Queued — not yet sent';
  if (status === 'read') return 'Read';
  if (status === 'delivered') return 'Delivered';
  if (status === 'sent') return 'Sent';
  return status ?? '';
}

function MsgBubble({ msg, isOut }: { msg: Msg; isOut: boolean }) {  const time = msg.created_at
    ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <Flex justify={isOut ? 'flex-end' : 'flex-start'} style={{ marginBottom: space.md }}>
      <div
        style={{
          maxWidth: '65%',
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
        <Text
          style={{
            fontSize: font.size.body,
            lineHeight: 1.5,
            color: isOut ? color.textOnAccent : color.text,
            whiteSpace: 'pre-wrap',
          }}
        >
          {msg.body}
        </Text>
        <Text
          style={{
            fontSize: font.size.caption,
            // Full-strength white rather than a translucent wash so the timestamp
            // and delivery ticks stay readable on the accent fill.
            color: isOut ? color.textOnAccent : color.textTertiary,
            display: 'block',
            textAlign: 'right',
            marginTop: space.xs,
          }}
        >
          {time}
          {isOut && msg.status && (
            <span style={{ marginLeft: space.xs }} title={statusLabel(msg.status, msg.failed_reason)}>
              {/* `failed` and `queued` previously both rendered a plain "✓",
                  indistinguishable from a delivered message — so a dead gateway
                  looked exactly like a successful send. */}
              {msg.status === 'failed'
                ? '⚠'
                : msg.status === 'queued'
                  ? '🕘'
                  : msg.status === 'read' || msg.status === 'delivered'
                    ? '✓✓'
                    : '✓'}
            </span>
          )}
        </Text>
      </div>
    </Flex>
  );
}
