import { z } from 'zod';

declare const brandSymbol: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brandSymbol]: B };

export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type UserId = Brand<string, 'UserId'>;
export type AccountId = Brand<string, 'AccountId'>;
export type ItemId = Brand<string, 'ItemId'>;
export type FollowId = Brand<string, 'FollowId'>;
export type ClaimId = Brand<string, 'ClaimId'>;
export type ClipId = Brand<string, 'ClipId'>;
export type AlertId = Brand<string, 'AlertId'>;
export type NotificationId = Brand<string, 'NotificationId'>;
export type AuditLogId = Brand<string, 'AuditLogId'>;

export const nonEmptyIdSchema = z.string().trim().min(1).max(128);

export function asWorkspaceId(id: string): WorkspaceId {
  return nonEmptyIdSchema.parse(id) as WorkspaceId;
}

export function asUserId(id: string): UserId {
  return nonEmptyIdSchema.parse(id) as UserId;
}

export function asAccountId(id: string): AccountId {
  return nonEmptyIdSchema.parse(id) as AccountId;
}

export function asItemId(id: string): ItemId {
  return nonEmptyIdSchema.parse(id) as ItemId;
}

export function asFollowId(id: string): FollowId {
  return nonEmptyIdSchema.parse(id) as FollowId;
}

export function asClaimId(id: string): ClaimId {
  return nonEmptyIdSchema.parse(id) as ClaimId;
}

export function asClipId(id: string): ClipId {
  return nonEmptyIdSchema.parse(id) as ClipId;
}

export function asAlertId(id: string): AlertId {
  return nonEmptyIdSchema.parse(id) as AlertId;
}

export function asNotificationId(id: string): NotificationId {
  return nonEmptyIdSchema.parse(id) as NotificationId;
}

export function asAuditLogId(id: string): AuditLogId {
  return nonEmptyIdSchema.parse(id) as AuditLogId;
}

export const roleSchema = z.enum(['Owner', 'Admin', 'Member', 'Viewer']);
export type Role = z.infer<typeof roleSchema>;

export const ROLE_RANK: Record<Role, number> = {
  Viewer: 1,
  Member: 2,
  Admin: 3,
  Owner: 4,
};

export const MAX_TEAM_SEATS = 3;

export function hasRoleAtLeast(userRole: Role, requiredRole: Role): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[requiredRole];
}

export function formatProviderSource(
  platform: Platform,
  hasApiKey = false,
): string {
  if (platform === 'youtube') {
    return hasApiKey ? 'YouTube API' : 'YouTube RSS';
  }
  if (platform === 'twitch') {
    return 'Twitch Helix';
  }
  return 'Kick API';
}

export const platformSchema = z.enum(['youtube', 'twitch', 'kick']);
export type Platform = z.infer<typeof platformSchema>;

export const healthStatusSchema = z.enum(['ok', 'degraded', 'down']);
export type HealthStatus = z.infer<typeof healthStatusSchema>;

export interface VerifiedIdentity {
  readonly userId: UserId;
  readonly email: string;
}

export interface Principal extends VerifiedIdentity {
  readonly workspaceId: WorkspaceId;
  readonly role: Role;
}

export type AppErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: AppErrorCode,
    status: number,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError('BAD_REQUEST', 400, message, details);
  }

  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError('UNAUTHORIZED', 401, message);
  }

  static forbidden(message = 'Forbidden'): AppError {
    return new AppError('FORBIDDEN', 403, message);
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError('NOT_FOUND', 404, message);
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError('CONFLICT', 409, message, details);
  }

  static rateLimited(message = 'Rate limit exceeded'): AppError {
    return new AppError('RATE_LIMITED', 429, message);
  }

  static internal(message = 'Internal server error'): AppError {
    return new AppError('INTERNAL_ERROR', 500, message);
  }
}
