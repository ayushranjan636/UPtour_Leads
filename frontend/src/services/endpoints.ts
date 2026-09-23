import api from './api';

/* ── Auth ─────────────────────────────────────────── */
export const authAPI = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  refresh: (refreshToken: string) =>
    api.post('/auth/refresh', { refreshToken }),
  logout: () => api.post('/auth/logout'),
};

/* ── Dashboard ────────────────────────────────────── */
export const dashboardAPI = {
  getOverview: () => api.get('/dashboard/overview'),
  getCampaigns: () => api.get('/dashboard/campaigns'),
  getPipeline: () => api.get('/dashboard/pipeline'),
};

/* ── Contacts ─────────────────────────────────────── */

/**
 * Array params must repeat the bare key — `?city=Agra&city=Delhi`.
 *
 * Axios defaults to `city[]=Agra&city[]=Delhi`, which only becomes an array again if
 * the server happens to run a bracket-aware query parser. `GET /contacts` documents
 * the repeated-key form, so pin it explicitly rather than relying on that.
 */
const REPEAT_ARRAY_PARAMS = { indexes: null } as const;

/** One collection job or one CSV import, as an addressable audience. */
export interface ContactDataset {
  id: string;
  name: string;
  /** Reachable contacts only, so the number matches what would be enrolled. */
  contactCount: number;
  createdAt: string;
}

/** Shape of `GET /contacts/datasets`. */
export interface ContactDatasets {
  collectionJobs: ContactDataset[];
  imports: ContactDataset[];
}

export const contactsAPI = {
  list: (params?: Record<string, unknown>) =>
    api.get('/contacts', { params, paramsSerializer: REPEAT_ARRAY_PARAMS }),
  get: (id: string) => api.get(`/contacts/${id}`),
  create: (data: Record<string, unknown>) => api.post('/contacts', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/contacts/${id}`, data),
  optOut: (id: string) => api.post(`/contacts/${id}/opt-out`),
  verifyWhatsApp: (id: string) => api.post(`/contacts/${id}/verify-whatsapp`),
  /**
   * Permanently deletes the contact and its campaign/message/lead history.
   * Irreversible — always confirm first. Use `optOut` to stop messaging while
   * keeping the record.
   */
  remove: (id: string) => api.delete(`/contacts/${id}`),
  /**
   * Bulk actions on a selection. All capped at 500 ids server-side.
   *
   * `bulkGroup` stores the label in the contact's tags, so a contact can belong to
   * several groups and a campaign audience can then target the group directly.
   */
  bulkGroup: (contactIds: string[], group: string) =>
    api.post<{ updated: number; group: string }>('/contacts/bulk/group', { contactIds, group }),
  bulkUngroup: (contactIds: string[], group: string) =>
    api.post<{ updated: number }>('/contacts/bulk/ungroup', { contactIds, group }),
  /** Checks each number against WhatsApp; those not on it are suppressed. */
  bulkVerify: (contactIds: string[]) =>
    api.post<{ verified: number; suppressed: number; failed: number }>(
      '/contacts/bulk/verify',
      { contactIds },
    ),
  /** Irreversible. Removes each contact with its message/campaign/lead history. */
  bulkDelete: (contactIds: string[]) =>
    api.post<{ deleted: number; failed: { id: string; reason: string }[] }>(
      '/contacts/bulk/delete',
      { contactIds },
    ),
  /** Group labels in use, with reachable-contact counts. */
  groups: () => api.get<{ name: string; contactCount: number }[]>('/contacts/groups'),
  /**
   * Distinct location values actually present in the data, for filter dropdowns.
   * Pass `country` to narrow states/cities and `state_region` to narrow districts,
   * so the UI can cascade Country → State → District.
   */
  locations: (params?: { country?: string; state_region?: string }) =>
    api.get('/contacts/locations', { params }),
  /**
   * The collection jobs and CSV imports that produced contacts, with reachable
   * counts. Lets an operator target "the Agra agencies I scraped on Tuesday" as one
   * choice instead of trying to rebuild that set out of location filters.
   */
  datasets: () => api.get<ContactDatasets>('/contacts/datasets'),
  /** Unpaginated total for a filter — the real audience size, not a page length. */
  count: (params?: Record<string, unknown>) =>
    api.get('/contacts/count', { params, paramsSerializer: REPEAT_ARRAY_PARAMS }),
};

/* ── Companies ────────────────────────────────────── */
export const companiesAPI = {
  list: (params?: Record<string, unknown>) =>
    api.get('/companies', { params }),
  get: (id: string) => api.get(`/companies/${id}`),
  create: (data: Record<string, unknown>) => api.post('/companies', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/companies/${id}`, data),
};

/* ── Campaigns ────────────────────────────────────── */
export const campaignsAPI = {
  list: (params?: Record<string, unknown>) =>
    api.get('/campaigns', { params }),
  get: (id: string) => api.get(`/campaigns/${id}`),
  create: (data: Record<string, unknown>) => api.post('/campaigns', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/campaigns/${id}`, data),
  activate: (id: string) => api.post(`/campaigns/${id}/activate`),
  pause: (id: string) => api.post(`/campaigns/${id}/pause`),
  addContacts: (id: string, contactIds: string[]) =>
    api.post(`/campaigns/${id}/contacts`, { contactIds }),
  /**
   * Enrols every contact matching a filter, resolved server-side. Removes the old
   * client-side ceiling where only the first 100 fetched contacts could be added.
   * Opted-out and suppressed contacts are always excluded.
   */
  addContactsByFilter: (id: string, filter: Record<string, unknown>) =>
    api.post(`/campaigns/${id}/contacts/by-filter`, filter),
  /** Audience size, exclusions, templates, schedule and blockers — shown before sending. */
  sendPreview: (id: string) => api.get(`/campaigns/${id}/send-preview`),
  getContacts: (id: string, params?: Record<string, unknown>) =>
    api.get(`/campaigns/${id}/contacts`, { params }),
  getStats: (id: string) => api.get(`/campaigns/${id}/stats`),
};

/* ── Templates ────────────────────────────────────── */
export const templatesAPI = {
  listByCampaign: (campaignId: string) =>
    api.get(`/templates/campaign/${campaignId}`),
  get: (id: string) => api.get(`/templates/${id}`),
  create: (data: Record<string, unknown>) => api.post('/templates', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/templates/${id}`, data),
  delete: (id: string) => api.delete(`/templates/${id}`),
};

/* ── Leads ────────────────────────────────────────── */
export const leadsAPI = {
  list: (params?: Record<string, unknown>) => api.get('/leads', { params }),
  get: (id: string) => api.get(`/leads/${id}`),
  create: (data: Record<string, unknown>) => api.post('/leads', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/leads/${id}`, data),
  assign: (id: string, userId: string) =>
    api.post(`/leads/${id}/assign`, { userId }),
};

/* ── Deals ────────────────────────────────────────── */
export const dealsAPI = {
  list: (params?: Record<string, unknown>) => api.get('/deals', { params }),
  get: (id: string) => api.get(`/deals/${id}`),
  create: (data: Record<string, unknown>) => api.post('/deals', data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch(`/deals/${id}`, data),
  delete: (id: string) => api.delete(`/deals/${id}`),
};

/* ── Messages ─────────────────────────────────────── */
export const messagesAPI = {
  getConversation: (contactId: string, params?: Record<string, unknown>) =>
    api.get(`/messages/conversation/${contactId}`, { params }),
  send: (data: { contactId: string; body: string }) =>
    api.post('/messages/send', data),
};

/* ── Collection ───────────────────────────────────── */
export const collectionAPI = {
  list: () => api.get('/collection'),
  status: () => api.get('/collection/status'),
  create: (data: Record<string, unknown>) => api.post('/collection', data),
  get: (id: string) => api.get(`/collection/${id}`),
  pause: (id: string) => api.patch(`/collection/${id}/pause`),
  resume: (id: string) => api.patch(`/collection/${id}/resume`),
  // A collection run performs several throttled Google Places requests, so it
  // needs a much longer timeout than the 30s default.
  runNow: (id: string) =>
    api.post(`/collection/${id}/run-now`, undefined, { timeout: 600_000 }),
  getResults: (id: string, params?: Record<string, unknown>) =>
    api.get(`/collection/${id}/results`, { params }),
};

/* ── Imports ──────────────────────────────────────── */
export const importsAPI = {
  list: () => api.get('/imports'),
  upload: (data: FormData) =>
    api.post('/imports/upload', data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  get: (id: string) => api.get(`/imports/${id}`),
  preview: (id: string) => api.get(`/imports/${id}/preview`),
  // Backend reads the mapping from a `mapping` property on the body.
  map: (id: string, mapping: Record<string, string>) =>
    api.post(`/imports/${id}/map`, { mapping }),
  validate: (id: string) => api.post(`/imports/${id}/validate`),
  validationReport: (id: string) => api.get(`/imports/${id}/validation-report`),
  execute: (id: string) => api.post(`/imports/${id}/execute`),
};

/* ── Notifications ────────────────────────────────── */
export const notificationsAPI = {
  list: () => api.get('/notifications'),
  unread: () => api.get('/notifications/unread'),
  markRead: (id: string) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.patch('/notifications/read-all'),
};

/* ── Search ───────────────────────────────────────── */
export const searchAPI = {
  search: (q: string, type = 'all') => api.get('/search', { params: { q, type } }),
};

/* ── Workflow ─────────────────────────────────────── */
export const workflowAPI = {
  getContactWorkflow: (contactId: string) =>
    api.get(`/workflow/contact/${contactId}`),
  getCampaignHealth: (campaignId: string) =>
    api.get(`/workflow/campaign/${campaignId}/health`),
  getCampaignFaults: (campaignId: string) =>
    api.get(`/workflow/campaign/${campaignId}/faults`),
};

/* ── Engine ───────────────────────────────────────── */
export const engineAPI = {
  // Backend reads snake_case @Query() params — see engine.controller.ts.
  getDistributionPlan: (params: {
    daily_limit: number;
    window_start: string;
    window_end: string;
  }) => api.get('/engine/distribution-plan', { params }),
};

/* ── Messaging gateway (WhatsApp) ─────────────────────
 * Beyond the raw health probe the portal now owns the pairing flow: an operator
 * can see whether a WhatsApp session is linked, scan a QR code to link one, and
 * unlink it — without leaving for the gateway's own dashboard.
 */

/**
 * Session lifecycle reported by `GET /whatsapp/connection`.
 *
 * `ready` is the only value that means messages can actually be sent;
 * `gateway_unreachable` means the gateway process itself is down, which is a
 * different (infrastructure) problem from a session that simply needs scanning.
 */
export type WhatsAppStatus =
  | 'ready'
  | 'qr_ready'
  | 'initializing'
  | 'authenticating'
  | 'disconnected'
  | 'no_session'
  | 'gateway_unreachable';

/** Current pairing state of the gateway's WhatsApp session. */
export interface WhatsAppConnection {
  connected: boolean;
  gatewayReachable: boolean;
  status: WhatsAppStatus;
  /** Linked phone number in E.164-ish form, or null when unpaired. */
  phone: string | null;
  sessionId: string | null;
  sessionName: string | null;
  /** True while a QR code is (or is about to be) waiting to be scanned. */
  awaitingScan: boolean;
  /** Human-readable explanation, safe to show directly in the UI. */
  message: string;
}

/** Result of kicking off a pairing attempt. */
export interface WhatsAppConnectResult {
  sessionId: string;
  status: WhatsAppStatus;
  /**
   * Data-URI PNG (`data:image/png;base64,...`), or null meaning "not generated
   * yet" — poll `qr()` rather than treating null as a failure.
   */
  qrCode: string | null;
  message: string;
}

/** A single QR snapshot. WhatsApp rotates the code, so this must be re-polled. */
export interface WhatsAppQrResult {
  sessionId: string;
  qrCode: string | null;
  status: WhatsAppStatus;
}

export const gatewayAPI = {
  /** Liveness of the gateway process. Pair with `isGatewayHealthy`. */
  getHealth: () => api.get('/whatsapp/health'),

  /**
   * Full pairing state — used for the Dashboard indicator and the Settings tab.
   * Never throws for a *disconnected* gateway: that is reported in the payload
   * via `gatewayReachable: false`.
   */
  connection: () => api.get<WhatsAppConnection>('/whatsapp/connection'),

  /**
   * Starts (or restarts) a pairing attempt and returns the first QR code if the
   * gateway already has one. A null `qrCode` is normal — keep polling `qr()`.
   */
  connect: () => api.post<WhatsAppConnectResult>('/whatsapp/connect'),

  /**
   * Latest QR code for the in-progress pairing. Poll every few seconds while the
   * modal is open, because WhatsApp expires each code after ~20s.
   */
  qr: () => api.get<WhatsAppQrResult>('/whatsapp/qr'),

  /**
   * Unlinks the session. Destructive in practice: reconnecting requires another
   * QR scan on the phone, so always confirm with the operator first.
   */
  disconnect: () => api.post<{ disconnected: boolean }>('/whatsapp/disconnect'),
  /**
   * Pre-authenticated link into the gateway dashboard. The API key travels in the URL
   * fragment (never sent to a server) and the gateway strips it on arrival, so an
   * operator already signed in here is not asked to paste a key.
   */
  portalLink: () => api.get<{ url: string }>('/whatsapp/portal-link'),
};

/**
 * True when the messaging gateway is usable for sending.
 *
 * The gateway reports readiness as `{"status":"ok"}`. An earlier check compared
 * against 'connected'/'healthy', neither of which it ever returns, so the portal
 * always displayed the gateway as down even while it was sending fine. Accept the
 * real value plus the historical aliases in case the upstream shape changes.
 */
export function isGatewayHealthy(health: { status?: string } | null | undefined): boolean {
  const status = health?.status?.toLowerCase();
  return status === 'ok' || status === 'up' || status === 'connected' || status === 'healthy';
}
