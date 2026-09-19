import axios, {
  AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';

/**
 * Base URL is env-driven so the same build can target local dev, staging and
 * production. Defaults to the relative `/api` path, which the Vite dev server
 * proxies to the backend (see vite.config.ts) — this keeps the browser on a
 * single origin and sidesteps CORS entirely.
 */
const baseURL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ??
  '/api';

const api = axios.create({
  baseURL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/** Requests that must never trigger the refresh-and-retry flow. */
const AUTH_PATHS = ['/auth/login', '/auth/refresh'];

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
}

function redirectToLogin() {
  clearSession();
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

/*
 * Access tokens are short-lived (JWT_EXPIRY defaults to 15m). Previously any 401
 * dumped the user straight back to /login, so an active session died every 15
 * minutes even though a valid refresh token was sitting in localStorage.
 *
 * Now a 401 transparently refreshes once and replays the original request.
 * Concurrent 401s share a single in-flight refresh so we never fire N refreshes
 * (which would rotate the token N times and invalidate each other).
 */
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) throw new Error('No refresh token available');

  // Bare axios, not `api` — avoids recursing through this interceptor.
  const { data } = await axios.post(
    `${baseURL}/auth/refresh`,
    { refreshToken },
    { headers: { 'Content-Type': 'application/json' }, timeout: 30000 },
  );

  localStorage.setItem('token', data.accessToken);
  if (data.refreshToken) {
    localStorage.setItem('refreshToken', data.refreshToken);
  }
  if (data.user) {
    localStorage.setItem('user', JSON.stringify(data.user));
  }

  return data.accessToken as string;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const status = error.response?.status;
    const original = error.config as
      | (InternalAxiosRequestConfig & { _retried?: boolean })
      | undefined;

    const isAuthCall = AUTH_PATHS.some((p) => original?.url?.includes(p));

    if (status !== 401 || !original || original._retried || isAuthCall) {
      if (status === 401 && isAuthCall) redirectToLogin();
      return Promise.reject(error);
    }

    original._retried = true;

    try {
      refreshPromise = refreshPromise ?? refreshAccessToken();
      const newToken = await refreshPromise;
      refreshPromise = null;

      original.headers.Authorization = `Bearer ${newToken}`;
      return api(original as AxiosRequestConfig);
    } catch {
      refreshPromise = null;
      redirectToLogin();
      return Promise.reject(error);
    }
  },
);

export default api;
