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
export const contactsAPI = {
  list: (params?: Record<string, unknown>) =>
    api.get('/contacts', { params }),
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

/* ── Messaging gateway (infrastructure) ───────────────
 * The WhatsApp gateway is deliberately treated as opaque infrastructure here.
 * Session management, QR pairing and per-session admin live in the gateway's own
 * dashboard, NOT in this portal — so only a health probe is exposed.
 */
export const gatewayAPI = {
  getHealth: () => api.get('/whatsapp/health'),
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
