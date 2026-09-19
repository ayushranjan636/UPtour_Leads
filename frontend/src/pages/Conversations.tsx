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
    } catch {
      message.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const selectContact = (contact: Contact) => {
    setSelectedContact(contact);
  };

  if (!loadingContacts && contacts.length === 0 && !searchText) {
    return (
      <div>
        <PageHeader title="Conversations" subtitle="WhatsApp messaging" />
        <Flex justify="center" style={{ padding: '80px 0' }}>
          <Empty
            image={<MessageOutlined style={{ fontSize: 64, color: '#D1D5DB' }} />}
            description={
              <div style={{ marginTop: 16 }}>
                <Text strong style={{ fontSize: 16, display: 'block', marginBottom: 8 }}>
                  No conversations yet
                </Text>
                <Text style={{ color: '#6B7280' }}>
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
          background: '#FFF',
          borderRadius: 14,
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          border: '1px solid #F0F0F0',
        }}
      >
        {/* Left panel — contact list */}
        <div
          style={{
            width: 340,
            borderRight: '1px solid #F0F0F0',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: '16px 16px 12px' }}>
            <Input
              placeholder="Search contacts..."
              prefix={<SearchOutlined style={{ color: '#9CA3AF' }} />}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              allowClear
              style={{ borderRadius: 10 }}
            />
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loadingContacts ? (
              <Flex justify="center" style={{ padding: 24 }}>
                <Spin />
              </Flex>
            ) : contacts.length === 0 ? (
              <Flex justify="center" style={{ padding: 24 }}>
                <Text style={{ color: '#9CA3AF' }}>No contacts found</Text>
              </Flex>
            ) : (
              contacts.map((contact) => (
                <div
                  key={contact.id}
                  onClick={() => selectContact(contact)}
                  style={{
                    padding: '14px 16px',
                    cursor: 'pointer',
                    background: selectedContact?.id === contact.id ? '#EEF2FF' : 'transparent',
                    borderBottom: '1px solid #FAFAFA',
                    transition: 'background 0.15s',
                  }}
                >
                  <Flex gap={12} align="flex-start">
                    <Avatar
                      size={42}
                      style={{
                        background:
                          selectedContact?.id === contact.id
                            ? 'linear-gradient(135deg, #4F46E5, #7C3AED)'
                            : '#F3F4F6',
                        color: selectedContact?.id === contact.id ? '#FFF' : '#6B7280',
                        fontWeight: 600,
                        fontSize: 14,
                        flexShrink: 0,
                      }}
                    >
                      {contact.name?.charAt(0)?.toUpperCase() ?? '?'}
                    </Avatar>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text strong style={{ fontSize: 14, color: '#111827' }}>
                        {contact.name}
                      </Text>
                      {contact.company?.name && (
                        <Text style={{ fontSize: 12, color: '#6B7280', display: 'block' }}>
                          {contact.company.name}
                        </Text>
                      )}
                      <Text
                        style={{
                          fontSize: 12,
                          color: '#9CA3AF',
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
              style={{ flex: 1, background: '#F9FAFB' }}
            >
              <Empty description="Select a contact to start a conversation" />
            </Flex>
          ) : (
            <>
              {/* Chat header */}
              <div
                style={{
                  padding: '12px 20px',
                  borderBottom: '1px solid #F0F0F0',
                  background: '#FAFBFC',
                }}
              >
                <Flex align="center" gap={12}>
                  <Avatar
                    size={38}
                    style={{
                      background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
                      fontWeight: 600,
                      fontSize: 14,
                    }}
                  >
                    {selectedContact.name?.charAt(0)?.toUpperCase() ?? '?'}
                  </Avatar>
                  <div>
                    <Text strong style={{ display: 'block', fontSize: 14 }}>
                      {selectedContact.name}
                    </Text>
                    <Text style={{ fontSize: 12, color: '#6B7280' }}>
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
                  background: '#F9FAFB',
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
                                borderRadius: 10,
                                background: '#FEFCE8',
                                border: '1px solid #FDE68A',
                                maxWidth: 320,
                              }}
                              styles={{ body: { padding: '10px 14px' } }}
                            >
                              <Flex align="center" gap={6} style={{ marginBottom: 6 }}>
                                <RobotOutlined style={{ color: '#D97706', fontSize: 13 }} />
                                <Text style={{ fontSize: 11, color: '#92400E', fontWeight: 600 }}>
                                  AI Analysis
                                </Text>
                              </Flex>
                              {msg.ai_analysis.intent && (
                                <Text style={{ fontSize: 12, display: 'block', color: '#78350F', marginBottom: 4 }}>
                                  Intent: <Text strong style={{ color: '#92400E' }}>{msg.ai_analysis.intent}</Text>
                                </Text>
                              )}
                              {msg.ai_analysis.interest_level != null && (
                                <Flex align="center" gap={8} style={{ marginBottom: 4 }}>
                                  <Text style={{ fontSize: 11, color: '#92400E' }}>Interest</Text>
                                  <Text strong style={{ fontSize: 11, color: '#92400E', textTransform: 'capitalize' }}>
                                    {msg.ai_analysis.interest_level}
                                  </Text>
                                </Flex>
                              )}
                              {msg.ai_analysis.confidence != null && (
                                <Flex align="center" gap={8}>
                                  <Text style={{ fontSize: 11, color: '#92400E' }}>Confidence</Text>
                                  <Progress
                                    /* confidence is 0..1 from the model */
                                    percent={Math.round(msg.ai_analysis.confidence * 100)}
                                    size={['100px', 6]}
                                    strokeColor="#10B981"
                                    trailColor="#D1FAE5"
                                    format={(p) => (
                                      <Text style={{ fontSize: 11, color: '#065F46' }}>{p}%</Text>
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
                  borderTop: '1px solid #F0F0F0',
                  background: '#FFFFFF',
                }}
              >
                <Flex gap={10} align="center">
                  <Input
                    placeholder="Type a message..."
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    style={{ borderRadius: 20, paddingLeft: 16 }}
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
                      background: 'linear-gradient(135deg, #4F46E5, #6366F1)',
                      border: 'none',
                      boxShadow: '0 2px 8px rgba(79,70,229,0.3)',
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

function MsgBubble({ msg, isOut }: { msg: Msg; isOut: boolean }) {
  const time = msg.created_at
    ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <Flex justify={isOut ? 'flex-end' : 'flex-start'} style={{ marginBottom: 12 }}>
      <div
        style={{
          maxWidth: '65%',
          padding: '10px 14px',
          borderRadius: isOut ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
          background: isOut
            ? 'linear-gradient(135deg, #4F46E5, #6366F1)'
            : '#FFFFFF',
          color: isOut ? '#FFFFFF' : '#111827',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
          border: isOut ? 'none' : '1px solid #F0F0F0',
        }}
      >
        <Text
          style={{
            fontSize: 13.5,
            lineHeight: 1.5,
            color: isOut ? '#FFFFFF' : '#111827',
            whiteSpace: 'pre-wrap',
          }}
        >
          {msg.body}
        </Text>
        <Text
          style={{
            fontSize: 10,
            color: isOut ? 'rgba(255,255,255,0.7)' : '#9CA3AF',
            display: 'block',
            textAlign: 'right',
            marginTop: 4,
          }}
        >
          {time}
          {isOut && msg.status && (
            <span style={{ marginLeft: 4 }}>
              {msg.status === 'read' ? '✓✓' : msg.status === 'delivered' ? '✓✓' : '✓'}
            </span>
          )}
        </Text>
      </div>
    </Flex>
  );
}
