import type { AgentEdge, AgentNode, GraphEngine, NodeTypeDefinition } from "../engine/types";

/**
 * Glyph Memory Vault — AXIOM's visualization of the GlyphIndex sovereign
 * memory layer (spec: OSOVM/GLYPHINDEX_SPEC.md).
 *
 * Every agent's sealed memory vault projects into the galaxy as one vault
 * node surrounded by its glyph constellation. Semantic zoom follows the
 * fractal REM structure: macro-glyphs (dream-folded clusters) render as
 * brighter nodes that unfold into their member glyphs when expanded —
 * Google-Maps-style navigation from "Weather Memories" down to a single
 * sealed conversation chunk. Plaintext never reaches the scene; nodes carry
 * only the metadata projection (glyph, canonical id, Odù lineage, recency).
 */
export const GLYPH_MEMORY_NODE_TYPE: NodeTypeDefinition = {
  id: "glyph-memory-vault",
  label: "Glyph Memory Vault",
  description:
    "Sovereign GlyphIndex vault: content-addressed, wallet-sealed agent memory. " +
    "Zoom unfolds macro-glyphs into their member memories; Odù lineage colors the constellation.",
  color: 0x46d6a8,
  accentColor: 0x9dfcd9,
  scale: 1.3,
  geometry: "geodesic",
  birthEffect: "ripple",
};

/** Metadata projection of one glyph (mirror of larql-glyph's GlyphNode). */
export interface GlyphNodeMeta {
  canonical_id: string;
  /** Single BMP character produced by GIX-FOLD-v1. */
  glyph: string;
  odu_base: number;
  odu_composed: number;
  ts: number;
  /** Canonical ids folded into this node by the REM dream cycle, if any. */
  macro_of?: string[];
  tags?: string[];
}

export interface GlyphVaultProjection {
  owner: string;
  nodes: GlyphNodeMeta[];
}

/** 16 hues for the 16 Odù wave lineages (odu_base >> 4). */
const ODU_WAVE_COLORS = [
  0xff7a45, 0xf5c542, 0xb8e04a, 0x5ce07a, 0x2fd4c7, 0x4ab8e0, 0x5c7aff, 0x8a5cff,
  0xb84ae0, 0xe64ac9, 0xff5c8a, 0xff8a5c, 0xd4a72f, 0x7ae05c, 0x5cd4ff, 0x9d8cff,
];

export function oduWaveColor(oduBase: number): number {
  return ODU_WAVE_COLORS[(oduBase >> 4) & 0x0f];
}

/**
 * Project a glyph vault into galaxy nodes + containment edges at a given
 * semantic zoom depth:
 *
 *   depth 0 — the vault node only (one glowing point per agent)
 *   depth 1 — vault + top-level glyphs (macro-glyphs stay folded)
 *   depth 2+ — macro-glyphs unfold; members hang off their macro node
 *
 * Recency drives `activity`, so freshly formed memories pulse.
 */
export function projectGlyphVault(
  projection: GlyphVaultProjection,
  depth: 0 | 1 | 2 = 1,
  now: number = Date.now() / 1000,
): { nodes: AgentNode[]; edges: AgentEdge[] } {
  const vaultId = `glyph-vault:${projection.owner}`;
  const newest = projection.nodes.reduce((acc, n) => Math.max(acc, n.ts), 0);
  const nodes: AgentNode[] = [
    {
      id: vaultId,
      typeId: GLYPH_MEMORY_NODE_TYPE.id,
      label: `𑀿 ${projection.owner}`,
      framework: "glyphindex",
      status: "active",
      capabilities: [
        { name: "glyph_search", description: "semantic top-k over sealed memories" },
        { name: "glyph_expand", description: "serve sealed blob + metadata by canonical id" },
        { name: "glyph_anchor", description: "emit vault merkle root for Sui anchoring" },
      ],
      reputation: 1,
      activity: newest ? recencyActivity(newest, now) : 0,
      memorySummary: `${projection.nodes.length} sealed glyphs`,
      memoryEvents: [],
      createdAt: now,
    },
  ];
  const edges: AgentEdge[] = [];
  if (depth === 0) return { nodes, edges };

  const macroMembers = new Set(
    projection.nodes.flatMap((n) => n.macro_of ?? []),
  );
  for (const meta of projection.nodes) {
    // At depth 1 macro members stay folded inside their macro node.
    if (depth < 2 && macroMembers.has(meta.canonical_id)) continue;
    nodes.push(glyphToAgentNode(meta, now));
    edges.push({
      id: `${vaultId}->${meta.canonical_id}`,
      sourceId: vaultId,
      targetId: meta.canonical_id,
      activity: recencyActivity(meta.ts, now),
    });
    if (depth >= 2 && meta.macro_of?.length) {
      for (const memberId of meta.macro_of) {
        edges.push({
          id: `${meta.canonical_id}->${memberId}`,
          sourceId: meta.canonical_id,
          targetId: memberId,
          activity: 0.2,
        });
      }
    }
  }
  return { nodes, edges };
}

function glyphToAgentNode(meta: GlyphNodeMeta, now: number): AgentNode {
  const isMacro = (meta.macro_of?.length ?? 0) > 0;
  return {
    id: meta.canonical_id,
    typeId: GLYPH_MEMORY_NODE_TYPE.id,
    label: `${meta.glyph} ${isMacro ? `⊕${meta.macro_of!.length}` : ""}`.trim(),
    framework: "glyphindex",
    status: "idle",
    capabilities: [],
    reputation: isMacro ? 0.9 : 0.5,
    activity: recencyActivity(meta.ts, now),
    memorySummary: `Odù ${meta.odu_base} / composed ${meta.odu_composed}` +
      (meta.tags?.length ? ` · ${meta.tags.join(", ")}` : ""),
    memoryEvents: [{ at: meta.ts, text: `sealed as ${meta.canonical_id.slice(0, 12)}…` }],
    createdAt: meta.ts,
  };
}

/** 0..1 activity from age: fresh memories pulse, week-old ones sleep. */
function recencyActivity(ts: number, now: number): number {
  const ageHours = Math.max(now - ts, 0) / 3600;
  return Math.max(0, Math.min(1, 1 - ageHours / 168));
}

export function registerGlyphMemoryNodeType(engine: GraphEngine): void {
  engine.registerNodeType(GLYPH_MEMORY_NODE_TYPE);
}
