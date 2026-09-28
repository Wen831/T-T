import apiClient from './client'

/**
 * The Footprint surface — TT's own location archive (the `builtin` half of the
 * Dawarich connection). Types mirror `server/src/nest/footprint/footprint.controller.ts`
 * directly: these responses are consumed by the connection card alone, and the
 * controller is the contract.
 */

/** The per-user ingest credential, as the settings card may show it — never the raw token. */
export interface FootprintTokenStatus {
  configured: boolean
  tokenPrefix: string | null
  createdAt: string | null
  lastUsedAt: string | null
}

export interface FootprintStatus {
  token: FootprintTokenStatus
  pointCount: number
  /** Unix seconds of the newest stored fix, null when the archive is empty. */
  latestPointAt: number | null
}

export interface FootprintMintResult extends FootprintTokenStatus {
  /** The raw token — returned exactly once, on mint. Only its hash is stored. */
  ingestToken: string
}

export const footprintApi = {
  status: (): Promise<FootprintStatus> => apiClient.get('/footprint/status').then(r => r.data),
  /** Mints — or rotates — the caller's ingest token. The raw value comes back here and only here. */
  mintIngestToken: (): Promise<FootprintMintResult> =>
    apiClient.post('/footprint/ingest-token', undefined).then(r => r.data),
}
