import { useState, useEffect, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Layout,
  Menu,
  Dropdown,
  Avatar,
  Typography,
  Flex,
  Badge,
  List,
  Button,
  Popover,
  Empty,
} from 'antd';
import {
  DashboardOutlined,
  ContactsOutlined,
  BankOutlined,
  SendOutlined,
  FunnelPlotOutlined,
  DollarOutlined,
  MessageOutlined,
  CloudDownloadOutlined,
  ImportOutlined,
  SettingOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  BellOutlined,
} from '@ant-design/icons';
import { useAuth } from '../contexts/AuthContext';
import { notificationsAPI } from '../services/endpoints';

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/contacts', icon: <ContactsOutlined />, label: 'Contacts' },
  { key: '/companies', icon: <BankOutlined />, label: 'Companies' },
  { key: '/campaigns', icon: <SendOutlined />, label: 'Campaigns' },
  { key: '/leads', icon: <FunnelPlotOutlined />, label: 'Leads' },
  { key: '/deals', icon: <DollarOutlined />, label: 'Deals' },
  { key: '/conversations', icon: <MessageOutlined />, label: 'Conversations' },
  { key: '/data-collector', icon: <CloudDownloadOutlined />, label: 'Data Collector' },
  { key: '/import', icon: <ImportOutlined />, label: 'Import' },
  { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
];

interface Notification {
  id: string;
  title?: string;
  message?: string;
  body?: string;
  read?: boolean;
  is_read?: boolean;
  created_at?: string;
}

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);

  const selectedKey =
    menuItems.find(
      (item) => item.key !== '/' && location.pathname.startsWith(item.key),
    )?.key || '/';

  const fetchNotifications = useCallback(async () => {
    try {
      const [notifRes, unreadRes] = await Promise.all([
        notificationsAPI.list().catch(() => ({ data: [] })),
        notificationsAPI.unread().catch(() => ({ data: { count: 0 } })),
      ]);
      const notifData = notifRes.data;
      setNotifications(Array.isArray(notifData) ? notifData.slice(0, 10) : []);
      const count = typeof unreadRes.data === 'number'
        ? unreadRes.data
        : unreadRes.data?.count ?? 0;
      setUnreadCount(count);
    } catch {
      /* notifications optional */
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const handleMarkRead = async (id: string) => {
    try {
      await notificationsAPI.markRead(id);
      fetchNotifications();
    } catch { /* ignore */ }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationsAPI.markAllRead();
      fetchNotifications();
    } catch { /* ignore */ }
  };

  const userMenu = {
    items: [
      { type: 'divider' as const },
      { key: 'logout', icon: <LogoutOutlined />, label: 'Logout', danger: true },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'logout') logout();
    },
  };

  const notifContent = (
    <div style={{ width: 340 }}>
      <Flex
        justify="space-between"
        align="center"
        style={{ padding: '8px 12px', borderBottom: '1px solid #F0F0F0' }}
      >
        <Text strong style={{ fontSize: 14 }}>Notifications</Text>
        {unreadCount > 0 && (
          <Button type="link" size="small" onClick={handleMarkAllRead}>
            Mark all read
          </Button>
        )}
      </Flex>
      {notifications.length === 0 ? (
        <div style={{ padding: 24 }}>
          <Empty description="No notifications" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      ) : (
        <List
          dataSource={notifications}
          renderItem={(item) => {
            const isRead = item.read ?? item.is_read ?? false;
            return (
              <List.Item
                style={{
                  padding: '10px 12px',
                  cursor: 'pointer',
                  background: isRead ? 'transparent' : '#F0F5FF',
                }}
                onClick={() => {
                  if (!isRead) handleMarkRead(item.id);
                }}
              >
                <div>
                  <Text strong={!isRead} style={{ fontSize: 13, display: 'block' }}>
                    {item.title ?? 'Notification'}
                  </Text>
                  <Text style={{ fontSize: 12, color: '#6B7280' }}>
                    {item.message ?? item.body ?? ''}
                  </Text>
                  {item.created_at && (
                    <Text style={{ fontSize: 11, color: '#9CA3AF', display: 'block', marginTop: 2 }}>
                      {new Date(item.created_at).toLocaleString()}
                    </Text>
                  )}
                </div>
              </List.Item>
            );
          }}
          style={{ maxHeight: 400, overflowY: 'auto' }}
        />
      )}
    </div>
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        width={260}
        style={{
          background: '#FFFFFF',
          borderRight: '1px solid #F0F0F0',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
          overflow: 'auto',
        }}
      >
        <Flex
          align="center"
          gap={12}
          style={{
            padding: collapsed ? '20px 16px' : '20px 24px',
            borderBottom: '1px solid #F0F0F0',
            marginBottom: 8,
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFF',
              fontWeight: 700,
              fontSize: 16,
              flexShrink: 0,
            }}
          >
            UP
          </div>
          {!collapsed && (
            <div style={{ overflow: 'hidden' }}>
              <Text
                strong
                style={{
                  fontSize: 15,
                  display: 'block',
                  lineHeight: 1.3,
                  color: '#111827',
                }}
              >
                UP Heritage
              </Text>
              <Text style={{ fontSize: 11, color: '#9CA3AF', lineHeight: 1.2 }}>
                Tours CRM
              </Text>
            </div>
          )}
        </Flex>

        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ border: 'none', padding: '0 8px' }}
        />
      </Sider>

      <Layout
        style={{
          marginLeft: collapsed ? 80 : 260,
          transition: 'margin-left 0.2s',
        }}
      >
        <Header
          style={{
            background: '#FFFFFF',
            padding: '0 32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #F0F0F0',
            height: 64,
            position: 'sticky',
            top: 0,
            zIndex: 99,
          }}
        >
          <div
            onClick={() => setCollapsed(!collapsed)}
            style={{ cursor: 'pointer', fontSize: 18, color: '#6B7280' }}
          >
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </div>

          <Flex align="center" gap={20}>
            <Popover
              content={notifContent}
              trigger="click"
              open={notifOpen}
              onOpenChange={setNotifOpen}
              placement="bottomRight"
            >
              <Badge count={unreadCount} size="small" offset={[-2, 2]}>
                <Button
                  type="text"
                  icon={<BellOutlined style={{ fontSize: 18 }} />}
                  style={{ color: '#6B7280' }}
                />
              </Badge>
            </Popover>

            <Dropdown menu={userMenu} placement="bottomRight" trigger={['click']}>
              <Flex align="center" gap={10} style={{ cursor: 'pointer' }}>
                <Avatar
                  size={34}
                  style={{
                    background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
                    fontWeight: 600,
                  }}
                >
                  {user?.name?.charAt(0) || 'A'}
                </Avatar>
                <div style={{ lineHeight: 1.3 }}>
                  <Text strong style={{ fontSize: 13, display: 'block' }}>
                    {user?.name || 'Admin'}
                  </Text>
                  <Text style={{ fontSize: 11, color: '#9CA3AF' }}>Admin</Text>
                </div>
              </Flex>
            </Dropdown>
          </Flex>
        </Header>

        <Content
          style={{
            padding: 32,
            minHeight: 'calc(100vh - 64px)',
            background: '#F5F7FA',
          }}
        >
          <div className="page-transition">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
