import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Flex, Modal, Spin, Typography, message } from 'antd';
import { QrcodeOutlined, ReloadOutlined } from '@ant-design/icons';
import { gatewayAPI } from '../services/endpoints';
import type { WhatsAppStatus } from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';

const { Text, Paragraph } = Typography;

/** How often the QR image and the connection state are re-fetched, in ms. */
const POLL_MS = 3_000;

/** Rendered size of the QR image (CSS px). Large enough to scan off a laptop screen. */
const QR_SIZE = 240;

/** Operator-facing wording for each session state. */
const statusLabels: Record<WhatsAppStatus, string> = {
  ready: 'Connected',
  qr_ready: 'Waiting for scan',
  initializing: 'Starting up',
  authenticating: 'Authenticating',
  disconnected: 'Disconnected',
  no_session: 'No session',
  gateway_unreachable: 'Gateway unreachable',
};

/**
 * Human-readable label for a raw session status.
 *
 * Exported so the Settings tab and this modal describe the same state with the
 * same words — the backend's snake_case values are not fit to show as-is.
 */
export function whatsAppStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown';
  return (
    statusLabels[status as WhatsAppStatus] ??
    status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

interface WhatsAppConnectModalProps {
  open: boolean;
  /** Called for both the Close button and the modal's own dismiss affordances. */
  onClose: () => void;
  /**
   * Fired once, immediately after the gateway reports `connected`. Callers use it
   * to refresh whatever indicator they render.
   */
  onConnected?: () => void;
}

/**
 * QR pairing dialog, shared by the Dashboard indicator and the Settings tab.
 *
 * It owns the whole short-lived polling lifecycle: opening the modal starts a
 * pairing attempt and a single 3s poller; closing it (or unmounting) tears the
 * poller down. One interval fetches the QR code and the connection state together
 * rather than running two timers, so there is exactly one handle to clear and the
 * two views can never disagree about which tick they belong to.
 */
export default function WhatsAppConnectModal({
  open,
  onClose,
  onConnected,
}: WhatsAppConnectModalProps) {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  /** Bumped to re-run the effect below, i.e. to retry after a failed start. */
  const [attempt, setAttempt] = useState(0);

  // Kept in refs so the poller can read them without being re-created (which
  // would restart the interval and reset the 3s cadence on every tick).
  const onConnectedRef = useRef(onConnected);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onConnectedRef.current = onConnected;
    onCloseRef.current = onClose;
  }, [onConnected, onClose]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    // Guards against a slow gateway stacking requests if a poll outlives its tick.
    let inFlight = false;
    let settled = false;

    setQrCode(null);
    setStatus(null);
    setHint(null);
    setError(null);
    setStarting(true);

    const finishConnected = () => {
      if (settled) return;
      settled = true;
      if (timer) clearInterval(timer);
      message.success('WhatsApp connected');
      onConnectedRef.current?.();
      onCloseRef.current();
    };

    const poll = async () => {
      if (cancelled || inFlight || settled) return;
      inFlight = true;
      try {
        // Settled together: a QR refresh is pointless once we are connected, and
        // the connection payload is what decides whether to close.
        const [qrRes, connRes] = await Promise.allSettled([
          gatewayAPI.qr(),
          gatewayAPI.connection(),
        ]);
        if (cancelled || settled) return;

        if (connRes.status === 'fulfilled') {
          const conn = connRes.value.data;
          setStatus(conn.status);
          setHint(conn.message ?? null);
          if (conn.connected) {
            finishConnected();
            return;
          }
        }

        if (qrRes.status === 'fulfilled' && qrRes.value.data?.qrCode) {
          setQrCode(qrRes.value.data.qrCode);
        }
      } catch {
        /* Transient poll failures are ignored — the next tick retries. */
      } finally {
        inFlight = false;
      }
    };

    const start = async () => {
      try {
        const { data } = await gatewayAPI.connect();
        if (cancelled) return;
        setStatus(data.status ?? null);
        setHint(data.message ?? null);
        if (data.qrCode) setQrCode(data.qrCode);
      } catch {
        if (cancelled) return;
        setError(
          'Could not start a WhatsApp session. The messaging gateway may be offline.',
        );
        return;
      } finally {
        if (!cancelled) setStarting(false);
      }
      if (cancelled) return;
      // The session may already have been authenticated (or a code may appear a
      // moment later), so poll immediately and then on a fixed cadence.
      void poll();
      timer = setInterval(() => void poll(), POLL_MS);
    };

    void start();

    return () => {
      cancelled = true;
      settled = true;
      if (timer) clearInterval(timer);
    };
  }, [open, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return (
    <Modal
      title={
        <Flex align="center" gap={space.sm}>
          <QrcodeOutlined style={{ color: color.accent }} />
          <Text strong style={{ fontSize: font.size.headline, color: color.text }}>
            Connect WhatsApp
          </Text>
        </Flex>
      }
      open={open}
      onCancel={onClose}
      width={400}
      // Nothing here is worth keeping between openings, and a fresh mount
      // guarantees the poller state cannot survive a close.
      destroyOnHidden
      footer={
        <Flex justify="flex-end" gap={space.sm}>
          {error && (
            <Button icon={<ReloadOutlined />} onClick={retry}>
              Try again
            </Button>
          )}
          <Button onClick={onClose}>Close</Button>
        </Flex>
      }
    >
      {error ? (
        <Alert type="error" showIcon message="Connection failed" description={error} />
      ) : (
        <Flex vertical align="center" gap={space.lg} style={{ paddingTop: space.sm }}>
          <div
            style={{
              width: QR_SIZE + space.xl,
              height: QR_SIZE + space.xl,
              borderRadius: radius.xl,
              background: color.surface,
              border: `1px solid ${color.separatorOpaque}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {qrCode ? (
              <img
                src={qrCode}
                alt="WhatsApp pairing QR code"
                width={QR_SIZE}
                height={QR_SIZE}
                style={{ display: 'block', borderRadius: radius.md }}
              />
            ) : (
              <Flex vertical align="center" gap={space.md}>
                <Spin />
                <Text
                  style={{ fontSize: font.size.footnote, color: color.textSecondary }}
                >
                  {starting ? 'Starting session…' : 'Preparing QR code…'}
                </Text>
              </Flex>
            )}
          </div>

          <Paragraph
            style={{
              margin: 0,
              textAlign: 'center',
              fontSize: font.size.footnote,
              color: color.textSecondary,
            }}
          >
            Open WhatsApp on your phone → Settings → Linked devices → Link a device,
            then scan this code
          </Paragraph>

          {(status || hint) && (
            <Text
              style={{
                fontSize: font.size.caption,
                color: color.textTertiary,
                textAlign: 'center',
              }}
            >
              {hint?.trim() || whatsAppStatusLabel(status)}
            </Text>
          )}
        </Flex>
      )}
    </Modal>
  );
}
