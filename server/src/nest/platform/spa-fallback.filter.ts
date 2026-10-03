import { PUBLIC_DIR, shouldServeClient } from './client-serving';
import { ArgumentsHost, Catch, ExceptionFilter, NotFoundException } from '@nestjs/common';

import type { Request, Response } from 'express';
import path from 'node:path';

/**
 * Serves the built SPA (index.html) for any request the NestJS router did not
 * match — the production single-page-app fallback. This replaces the legacy
 * Express `app.get('*')` catch-all, which cannot run on the Nest instance: Nest's
 * router terminates an unmatched request by throwing NotFoundException (it never
 * falls through to a post-init Express route), so the SPA fallback has to live
 * inside the Nest pipeline as a NotFound filter instead.
 *
 * Behaviour matches the legacy catch-all exactly: whenever the server is serving
 * the client (production, or a desktop install with a built client staged — see
 * shouldServeClient), an unmatched GET returns index.html; everything else
 * (non-GET, or a checkout with no built client) keeps the standard TREK `{ error }`
 * 404 envelope. The `@Catch(NotFoundException)` is more specific than the global
 * TrekExceptionFilter, so Nest routes 404s here while every other error still
 * flows through TrekExceptionFilter.
 */
/**
 * Namespaces the SPA fallback must never answer with index.html. An unmatched
 * GET under them is an API/protocol miss and keeps the TREK 404 envelope,
 * staged client or not: without this guard, every install that serves its own
 * client (Docker, the Windows package) handed API clients a 200 HTML page for
 * mistyped URLs — the uploads parity contract ("a MISS falls through to the
 * Nest 404 envelope"), the docs kill-switch (a disabled /api/docs must 404)
 * and the discovery pins all document the envelope as the intended answer.
 * A matched /mcp GET never reaches this filter; the prefix only keeps
 * subpath typos from turning into the SPA.
 */
const NON_SPA_PREFIXES = ['/api', '/uploads', '/mcp', '/.well-known'];

function isSpaPath(pathname: string): boolean {
  return !NON_SPA_PREFIXES.some((base) => pathname === base || pathname.startsWith(`${base}/`));
}

@Catch(NotFoundException)
export class SpaFallbackFilter implements ExceptionFilter {
  catch(exception: NotFoundException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    // req.path is Express-derived from req.url; either may be absent on a
    // hand-built request, and '/' (a plain SPA deep link) is the neutral read.
    const pathname = req.path || req.url || '/';
    if (isSpaPath(pathname) && shouldServeClient() && req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
      return;
    }

    // An API/protocol namespace miss, not serving the client, or a non-GET
    // miss: keep the standard TREK 404 envelope (identical to what
    // TrekExceptionFilter produces for a NotFoundException).
    res.status(404).json({ error: exception.message || 'Not Found' });
  }
}
