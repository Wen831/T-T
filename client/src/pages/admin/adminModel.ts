/** Shared types for the admin page + its data hook. No React, no side effects. */

export interface AdminUser {
  id: number;
  username: string;
  email: string;
  role: 'admin' | 'user';
  created_at: string;
  last_login?: string | null;
  online?: boolean;
  oidc_issuer?: string | null;
  avatar_url?: string | null;
}

export interface AdminStats {
  totalUsers: number;
  totalTrips: number;
  totalPlaces: number;
  totalFiles: number;
}

export interface OidcConfig {
  issuer: string;
  client_id: string;
  client_secret: string;
  client_secret_set: boolean;
  display_name: string;
  discovery_url: string;
}

/**
 * The prepared update: what to run, and whether a backup was taken first.
 *
 * `deployment` mirrors the server's own answer rather than being recomputed here,
 * so the browser and the server cannot disagree about which instructions apply.
 * `backup.created` is stated rather than implied: a failure must not read as
 * "backed up".
 */
export interface UpdatePreparation {
  ready: boolean;
  reason?: 'up-to-date';
  current: string;
  latest: string;
  release_url?: string | null;
  deployment?: 'docker-image' | 'docker-source' | 'manual';
  deployment_reason?: string;
  backup?: { created: boolean; filename: string | null; error: string | null };
  steps?: Array<{ labelKey: string; command: string | null; noteKey: string | null }>;
}

export interface UpdateInfo {
  update_available: boolean;
  latest: string;
  current: string;
  release_url?: string;
  is_docker?: boolean;
  is_prerelease?: boolean;
}
