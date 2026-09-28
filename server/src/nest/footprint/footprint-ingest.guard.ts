import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';

import type { Request } from 'express';
import { FootprintService } from './footprint.service';

/**
 * Authenticates `POST /api/v1/points/ingest` (and the Dawarich-compatible
 * `POST /api/v1/points`) by the caller's per-user ingest token — the
 * credential a phone tracker holds, not a browser session.
 *
 * Accepted transports, in order: `Authorization: Bearer <token>` (the standard
 * shape), `X-Ingest-Token: <token>`, `?token=`, and `?api_key=` (the parameter
 * the official Dawarich apps authenticate with — it lands on the same hash
 * lookup as every other transport). Only the hash is stored, so the token
 * cannot be read back anywhere.
 *
 * Declared AFTER AddonGuard in the controller's guard chain on purpose — a
 * disabled addon answers 404 to anonymous callers too, and the ingest token
 * must not leak that the route exists while the addon is off.
 */
@Injectable()
export class FootprintIngestGuard implements CanActivate {
  constructor(private readonly footprint: FootprintService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const token = extractIngestToken(req);
    const user = token ? this.footprint.verifyIngestToken(token) : null;
    if (!user) {
      throw new HttpException({ error: 'Invalid or missing ingest token' }, 401);
    }
    req.user = user;
    return true;
  }
}

function extractIngestToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const bearer = auth.slice('Bearer '.length).trim();
    if (bearer) return bearer;
  }
  const header = req.headers['x-ingest-token'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const query = req.query['token'];
  if (typeof query === 'string' && query.trim()) return query.trim();
  // The Dawarich-app spelling of the same credential.
  const apiKey = req.query['api_key'];
  if (typeof apiKey === 'string' && apiKey.trim()) return apiKey.trim();
  return null;
}
