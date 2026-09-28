export const ADDON_IDS = {
  MCP: 'mcp',
  PACKING: 'packing',
  BUDGET: 'budget',
  DOCUMENTS: 'documents',
  VACAY: 'vacay',
  ATLAS: 'atlas',
  COLLAB: 'collab',
  JOURNEY: 'journey',
  AIRTRAIL: 'airtrail',
  LLM_PARSING: 'llm_parsing',
  COLLECTIONS: 'collections',
  ROADTRIP: 'roadtrip',
  DAWARICH: 'dawarich',
  FOOTPRINT: 'footprint',
} as const;

export type AddonId = (typeof ADDON_IDS)[keyof typeof ADDON_IDS];

/**
 * The addons that gate an MCP surface, which is what decides whether switching
 * one off has to tear down the live sessions (TT port of upstream 4.3.0).
 *
 * A `when:` gate is evaluated once per session, at attach time. A client that
 * connected while an addon was on therefore keeps its tools registered and
 * callable after an admin switches it off — the gate never re-runs — while the
 * REST half answers 404 for the same user in the same moment. Only tearing the
 * sessions down closes that.
 */
export const MCP_GATED_ADDON_IDS: readonly AddonId[] = [
  ADDON_IDS.MCP,
  ADDON_IDS.AIRTRAIL,
  ADDON_IDS.ATLAS,
  ADDON_IDS.BUDGET,
  ADDON_IDS.COLLAB,
  ADDON_IDS.COLLECTIONS,
  ADDON_IDS.DAWARICH,
  ADDON_IDS.DOCUMENTS,
  ADDON_IDS.FOOTPRINT,
  ADDON_IDS.JOURNEY,
  ADDON_IDS.PACKING,
  ADDON_IDS.ROADTRIP,
  ADDON_IDS.VACAY,
];
