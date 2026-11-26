import { describe, expect, it } from 'vitest';
import {
  AppError,
  asAccountId,
  asAlertId,
  asAuditLogId,
  asClaimId,
  asClipId,
  asFollowId,
  asItemId,
  asNotificationId,
  asUserId,
  asWorkspaceId,
  hasRoleAtLeast,
} from './types.js';

describe('branded IDs', () => {
  it('constructs all branded IDs from valid non-empty strings', () => {
    expect(asWorkspaceId(' ws-1 ')).toBe('ws-1');
    expect(asUserId('usr-1')).toBe('usr-1');
    expect(asAccountId('acc-1')).toBe('acc-1');
    expect(asItemId('itm-1')).toBe('itm-1');
    expect(asFollowId('flw-1')).toBe('flw-1');
    expect(asClaimId('clm-1')).toBe('clm-1');
    expect(asClipId('clp-1')).toBe('clp-1');
    expect(asAlertId('alt-1')).toBe('alt-1');
    expect(asNotificationId('ntf-1')).toBe('ntf-1');
    expect(asAuditLogId('aud-1')).toBe('aud-1');
  });

  it('rejects empty or oversized IDs', () => {
    expect(() => asWorkspaceId('')).toThrow();
    expect(() => asUserId('   ')).toThrow();
    expect(() => asItemId('x'.repeat(129))).toThrow();
  });
});

describe('hasRoleAtLeast', () => {
  it('enforces Owner > Admin > Member > Viewer hierarchy', () => {
    expect(hasRoleAtLeast('Owner', 'Owner')).toBe(true);
    expect(hasRoleAtLeast('Owner', 'Viewer')).toBe(true);
    expect(hasRoleAtLeast('Admin', 'Owner')).toBe(false);
    expect(hasRoleAtLeast('Admin', 'Member')).toBe(true);
    expect(hasRoleAtLeast('Member', 'Admin')).toBe(false);
    expect(hasRoleAtLeast('Viewer', 'Member')).toBe(false);
    expect(hasRoleAtLeast('Viewer', 'Viewer')).toBe(true);
  });
});

describe('AppError', () => {
  it('constructs typed HTTP error factories', () => {
    const bad = AppError.badRequest('invalid input', { field: 'url' });
    expect(bad).toBeInstanceOf(Error);
    expect(bad.name).toBe('AppError');
    expect(bad.code).toBe('BAD_REQUEST');
    expect(bad.status).toBe(400);
    expect(bad.details).toEqual({ field: 'url' });

    expect(AppError.unauthorized().status).toBe(401);
    expect(AppError.forbidden().status).toBe(403);
    expect(AppError.notFound().status).toBe(404);
    expect(AppError.conflict('overlap').status).toBe(409);
    expect(AppError.rateLimited().status).toBe(429);
    expect(AppError.internal().status).toBe(500);
  });
});
