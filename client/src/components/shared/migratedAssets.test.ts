import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('assets referenced by migrated surfaces', () => {
  const paths = [
    'public/brands/airtrail.svg',
    'public/brands/dawarich.svg',
    'public/images/portals/check24.png',
    'public/images/portals/pincamp.png',
    'public/images/portals/pitchup.ico',
    'public/images/portals/trivago.png',
  ];

  it('keeps every referenced brand and stay-portal asset in the client build input', () => {
    for (const relative of paths) {
      const file = resolve(process.cwd(), relative);
      expect(existsSync(file), relative).toBe(true);
      expect(statSync(file).size, relative).toBeGreaterThan(0);
    }
  });

  it('keeps SVG brand assets parseable as SVG documents', () => {
    for (const relative of paths.filter((file) => file.endsWith('.svg'))) {
      const body = readFileSync(resolve(process.cwd(), relative), 'utf8');
      expect(body.trimStart(), relative).toMatch(/^<svg\b/);
    }
  });
});
