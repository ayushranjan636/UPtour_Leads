import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from '../../modules/audit/audit.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, user, ip } = request;

    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      return next.handle().pipe(
        tap((responseData) => {
          const entityId = responseData?.id || request.params?.id;
          const controllerName = context
            .getClass()
            .name.replace('Controller', '')
            .toLowerCase();
          this.auditService.log(
            user?.userId || null,
            `${method} ${url}`,
            controllerName,
            entityId,
            { body: this.sanitizeBody(body) },
            ip,
          );
        }),
      );
    }

    return next.handle();
  }

  private sanitizeBody(body: any): any {
    if (!body) return null;
    const sanitized = { ...body };
    delete sanitized.password;
    delete sanitized.refreshToken;
    return sanitized;
  }
}
