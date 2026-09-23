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
  Tooltip,
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
import { color, font, radius, space } from '../theme/tokens';

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

/**
 * Navigation is grouped by task rather than presented as one flat list of ten
 * items: sourcing contacts, running outreach, and working the pipeline are distinct
 * jobs, and a titled group makes the structure scannable (HIG: sidebars express
 * task structure).
 */
const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: 'Dashboard' },
  {
    type: 'group' as const,
    label: 'Audience',
    children: [
      { key: '/contacts', icon: <ContactsOutlined />, label: 'Contacts' },
      { key: '/companies', icon: <BankOutlined />, label: 'Companies' },
      { key: '/data-collector', icon: <CloudDownloadOutlined />, label: 'Data Collector' },
      { key: '/import', icon: <ImportOutlined />, label: 'Import' },
    ],
  },
  {
    type: 'group' as const,
    label: 'Outreach',
    children: [
      { key: '/campaigns', icon: <SendOutlined />, label: 'Campaigns' },
      { key: '/conversations', icon: <MessageOutlined />, label: 'Conversations' },
    ],
  },
  {
    type: 'group' as const,
    label: 'Pipeline',
    children: [
      { key: '/leads', icon: <FunnelPlotOutlined />, label: 'Leads' },
      { key: '/deals', icon: <DollarOutlined />, label: 'Deals' },
    ],
  },
  { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
];

/** Flat list of routes, used to resolve the selected key from the URL. */
const routeKeys = menuItems.flatMap((item) =>
  'children' in item && item.children
    ? item.children.map((child) => child.key)
    : 'key' in item && item.key
      ? [item.key]
      : [],
);

/**
 * Collapsed sidebar variant: the same items without group headings, which would
 * otherwise truncate to "Au…" / "Ou…" / "Pip…" in a 64px rail.
 */
const collapsedMenuItems = menuItems.flatMap((item) =>
  'children' in item && item.children ? item.children : [item],
);

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
  /**
   * Narrow viewports get a genuinely different navigation model rather than a
   * squeezed desktop one: the sidebar leaves the flow entirely and slides over the
   * content as an overlay. Previously `collapsed` was plain state with no breakpoint,
   * so a 390px window kept a fixed 236px sidebar and left 154px for content — text
   * wrapped to one character per line.
   */
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768,
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const apply = (matches: boolean) => {
      setIsMobile(matches);
      // Leaving mobile: drop the overlay so the sidebar returns to the flow expanded.
      if (!matches) setMobileNavOpen(false);
    };
    apply(query.matches);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Navigating on mobile should dismiss the overlay, matching platform behaviour.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const selectedKey =
    routeKeys
      .filter((key) => key !== '/' && location.pathname.startsWith(key))
      // Longest match wins so `/campaigns/:id` selects `/campaigns`.
      .sort((a, b) => b.length - a.length)[0] || '/';

  const fetchNotifications = useCallback(async () => {
    try {
      const [notifRes, unreadRes] = await Promise.all([
        notificationsAPI.list().catch(() => ({ data: [] })),
        notificationsAPI.unread().catch(() => ({ data: { count: 0 } })),
      ]);
      const notifData = notifRes.data;
      // The list endpoint answers with a paginated envelope, `{ data: [...] }`, while
      // some deployments return a bare array. Only the array case was handled, so the
      // envelope fell through to `[]` and the panel read "No notifications" while the
      // badge — which parses its own shape defensively — still showed a count.
      const rows = Array.isArray(notifData)
        ? notifData
        : Array.isArray(notifData?.data)
          ? notifData.data
          : [];
      setNotifications(rows.slice(0, 10));
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
      {
        key: 'account',
        label: (
          <div style={{ padding: '2px 0', lineHeight: 1.35 }}>
            <Text strong style={{ fontSize: font.size.footnote, display: 'block' }}>
              {user?.name || 'Admin'}
            </Text>
            <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
              {user?.email || ''}
            </Text>
          </div>
        ),
        disabled: true,
      },
      { type: 'divider' as const },
      { key: 'settings', icon: <SettingOutlined />, label: 'Settings' },
      { key: 'logout', icon: <LogoutOutlined />, label: 'Sign Out', danger: true },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'logout') logout();
      if (key === 'settings') navigate('/settings');
    },
  };

  const notifContent = (
    <div style={{ width: 320 }}>
      <Flex
        justify="space-between"
        align="center"
        style={{
          padding: `${space.sm}px ${space.md}px`,
          borderBottom: `1px solid ${color.separator}`,
        }}
      >
        <Text strong style={{ fontSize: font.size.footnote }}>
          Notifications
        </Text>
        {unreadCount > 0 && (
          <Button type="link" size="small" onClick={handleMarkAllRead} style={{ paddingInline: 0 }}>
            Mark all read
          </Button>
        )}
      </Flex>
      {notifications.length === 0 ? (
        <div style={{ padding: space.xl }}>
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
                  padding: `10px ${space.md}px`,
                  cursor: isRead ? 'default' : 'pointer',
                  background: isRead ? 'transparent' : color.accentSofter,
                }}
                onClick={() => {
                  if (!isRead) handleMarkRead(item.id);
                }}
              >
                <div>
                  <Flex align="center" gap={6}>
                    {/* Unread is marked by a dot as well as weight, so the state is
                        not communicated by background colour alone. */}
                    {!isRead && (
                      <span
                        aria-hidden
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: radius.pill,
                          background: color.accent,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <Text
                      strong={!isRead}
                      style={{ fontSize: font.size.footnote, display: 'block' }}
                    >
                      {item.title ?? 'Notification'}
                    </Text>
                  </Flex>
                  <Text style={{ fontSize: font.size.caption, color: color.textSecondary }}>
                    {item.message ?? item.body ?? ''}
                  </Text>
                  {item.created_at && (
                    <Text
                      style={{
                        fontSize: 11,
                        color: color.textTertiary,
                        display: 'block',
                        marginTop: 2,
                      }}
                    >
                      {new Date(item.created_at).toLocaleString()}
                    </Text>
                  )}
                </div>
              </List.Item>
            );
          }}
          style={{ maxHeight: 380, overflowY: 'auto' }}
        />
      )}
    </div>
  );

  // On mobile the sidebar is an overlay driven by `mobileNavOpen`; on desktop it is
  // in the flow and `collapsed` narrows it to icons.
  const sidebarCollapsed = isMobile ? false : collapsed;
  const sidebarWidth = 236;
  const contentOffset = isMobile ? 0 : collapsed ? 64 : sidebarWidth;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* Scrim: dismisses the overlay and prevents interaction with content behind it. */}
      {isMobile && mobileNavOpen && (
        <div
          onClick={() => setMobileNavOpen(false)}
          aria-hidden
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.28)',
            zIndex: 100,
          }}
        />
      )}

      <Sider
        trigger={null}
        collapsible
        collapsed={sidebarCollapsed}
        width={sidebarWidth}
        collapsedWidth={64}
        className="glass-sidebar"
        style={{
          borderRight: `1px solid ${color.separator}`,
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 101,
          overflowY: 'auto',
          overflowX: 'hidden',
          // Slide out of view on mobile until invoked.
          transform: isMobile && !mobileNavOpen ? `translateX(-${sidebarWidth}px)` : 'translateX(0)',
          transition: `transform var(--duration-base) var(--easing)`,
        }}
      >
        <Flex
          align="center"
          gap={10}
          style={{
            height: 52,
            padding: sidebarCollapsed ? '0 16px' : `0 ${space.lg}px`,
            marginBottom: space.sm,
            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
          }}
        >
          {/* Flat monogram. The previous indigo→violet gradient read as generic
              template branding; a solid mark is quieter and more precise. */}
          <div
            aria-hidden
            style={{
              width: 26,
              height: 26,
              borderRadius: radius.md,
              background: color.accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: color.textOnAccent,
              fontWeight: font.weight.bold,
              fontSize: 12,
              letterSpacing: '-0.02em',
              flexShrink: 0,
            }}
          >
            UP
          </div>
          {!sidebarCollapsed && (
            <Text
              strong
              style={{
                fontSize: font.size.callout,
                color: color.text,
                letterSpacing: '-0.01em',
                whiteSpace: 'nowrap',
              }}
            >
              UP Heritage Tours
            </Text>
          )}
        </Flex>

        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          // Group headings truncate to "Au…" at 64px wide, so drop to a flat list
          // when collapsed and let the icons carry the structure.
          items={sidebarCollapsed ? collapsedMenuItems : menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ border: 'none', padding: `0 ${space.sm}px`, background: 'transparent' }}
        />
      </Sider>

      <Layout
        style={{
          marginLeft: contentOffset,
          transition: `margin-left var(--duration-base) var(--easing)`,
          // Without this a wide table can stretch the flex child and break the
          // fixed-offset layout on narrow screens.
          minWidth: 0,
        }}
      >
        <Header
          className="glass-header"
          style={{
            padding: `0 ${isMobile ? space.lg : space.xl}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${color.separator}`,
            height: 52,
            position: 'sticky',
            top: 0,
            zIndex: 99,
          }}
        >
          <Tooltip title={isMobile ? 'Menu' : collapsed ? 'Show sidebar' : 'Hide sidebar'}>
            <Button
              type="text"
              aria-label={isMobile ? 'Open navigation menu' : collapsed ? 'Show sidebar' : 'Hide sidebar'}
              aria-expanded={isMobile ? mobileNavOpen : !collapsed}
              onClick={() =>
                isMobile ? setMobileNavOpen((open) => !open) : setCollapsed((value) => !value)
              }
              icon={
                isMobile || collapsed ? (
                  <MenuUnfoldOutlined style={{ fontSize: 16 }} />
                ) : (
                  <MenuFoldOutlined style={{ fontSize: 16 }} />
                )
              }
              style={{ color: color.textSecondary }}
            />
          </Tooltip>

          <Flex align="center" gap={space.sm}>
            <Popover
              content={notifContent}
              trigger="click"
              open={notifOpen}
              onOpenChange={setNotifOpen}
              placement="bottomRight"
              styles={{ root: { padding: 0 } }}
            >
              <Badge count={unreadCount} size="small" offset={[-4, 4]}>
                <Button
                  type="text"
                  aria-label={
                    unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
                  }
                  icon={<BellOutlined style={{ fontSize: 16 }} />}
                  style={{ color: color.textSecondary }}
                />
              </Badge>
            </Popover>

            <Dropdown menu={userMenu} placement="bottomRight" trigger={['click']}>
              <Flex
                align="center"
                gap={8}
                role="button"
                tabIndex={0}
                aria-label="Account menu"
                style={{
                  cursor: 'pointer',
                  padding: `4px ${space.sm}px 4px 4px`,
                  borderRadius: radius.pill,
                }}
              >
                <Avatar
                  size={26}
                  style={{
                    background: color.accentSoft,
                    color: color.accent,
                    fontWeight: font.weight.semibold,
                    fontSize: 12,
                  }}
                >
                  {user?.name?.charAt(0).toUpperCase() || 'A'}
                </Avatar>
                {/* The role line was hard-coded to "Admin" for every account. This is
                    a single-operator tool, so the name alone is the useful label.
                    Hidden on mobile where header space is scarce. */}
                {!isMobile && (
                  <Text style={{ fontSize: font.size.footnote, color: color.text }}>
                    {user?.name || 'Admin'}
                  </Text>
                )}
              </Flex>
            </Dropdown>
          </Flex>
        </Header>

        <Content
          style={{
            padding: isMobile
              ? `${space.lg}px ${space.lg}px ${space.xxl}px`
              : `${space.xl}px ${space.xxl}px ${space.xxxl}px`,
            minHeight: 'calc(100vh - 52px)',
            background: color.canvas,
          }}
        >
          <div
            className="page-transition"
            style={{ maxWidth: 1360, margin: '0 auto', minWidth: 0 }}
          >
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
