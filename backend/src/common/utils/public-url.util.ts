import { ConfigService } from '@nestjs/config';

/**
 * The portal's API as the outside world reaches it, e.g. https://portal.example.com/api.
 *
 * Meta needs it twice: to call our webhook, and to download media we send by link. In
 * production the portal origin proxies /api (Caddy); a local Vite dev server does not,
 * so a localhost frontend URL falls back to the API's own address.
 */
export function publicApiBase(config: ConfigService): string {
  const strip = (s: string) => s.trim().replace(/\/+$/, '');
  const publicApi = config.get<string>('PUBLIC_API_URL')?.trim();
  if (publicApi) return strip(publicApi);
  const frontend = config.get<string>('FRONTEND_URL')?.trim();
  if (frontend && !/^https?:\/\/(localhost|127\.)/.test(frontend)) return `${strip(frontend)}/api`;
  return `${strip(config.get<string>('APP_URL')?.trim() || 'http://localhost:3000')}/api`;
}
