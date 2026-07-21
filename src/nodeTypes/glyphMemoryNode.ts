import type { AgentEdge, AgentNode, GraphEngine, NodeTypeDefinition } from "../engine/types";

/**
 * GlyphIndex memory nodes in the galaxy — AXIOM's leg of the ecosystem
 * GlyphIndex contract (spec: OSOVM/GLYPHINDEX_SPEC.md; canonical reference
 * implementation: Vantage/backend/glyph_index.py).
 *
 * Every sealed memory chunk is a content-addressed node (SHA-256 canonical
 * id, GIX-FOLD-v1 display glyph, Odù linkage). This module renders that
 * sovereign memory graph as a constellation and gives the scene its
 * semantic-zoom behavior: zoomed out, memories collapse into base-Odù
 * clusters (the Digital Calabash's 256 lineages); zoomed in, each glyph is
 * its own star. Only metadata reaches the browser — plaintext stays sealed
 * in the identity layer (BIPỌ̀N39 / Cloakseed), so the galaxy is safe to
 * render from an untrusted wire snapshot.
 */

export const GLYPH_MEMORY_NODE_TYPE_ID = "glyph-memory";

/** The visual identity for a glyph memory star: cool violet, faceted core. */
export const GLYPH_MEMORY_NODE_TYPE: NodeTypeDefinition = {
  id: GLYPH_MEMORY_NODE_TYPE_ID,
  label: "GlyphIndex Memory",
  description:
    "A sealed, content-addressed sovereign memory (GIX-FOLD-v1 glyph + Odù lineage). " +
    "Only metadata is shown; the chunk plaintext stays sealed in the identity layer. " +
    "Zoom out to collapse memories into their base-Odù clusters, zoom in to see each glyph.",
  color: 0x8a6cff,
  accentColor: 0xc9b8ff,
  scale: 0.6,
  geometry: "crystal",
  birthEffect: "ripple",
};

export function registerGlyphMemoryNodeType(engine: GraphEngine): void {
  engine.registerNodeType(GLYPH_MEMORY_NODE_TYPE);
}

// ---- GIX-FOLD-v1 (content → glyph) -----------------------------------------

const FOLD_RANGES: readonly (readonly [number, number])[] = [
  [0x0020, 0xd7ff - 0x0020 + 1],
  [0xe000, 0xfdcf - 0xe000 + 1],
  [0xfdf0, 0xfffd - 0xfdf0 + 1],
];
const FOLD_TOTAL = FOLD_RANGES.reduce((sum, [, count]) => sum + count, 0);

export async function contentHash(text: string): Promise<Uint8Array> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

export function canonicalId(digest: Uint8Array): string {
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function glyphFold(digest: Uint8Array): string {
  let rem = 0n;
  for (const byte of digest) rem = ((rem << 8n) | BigInt(byte)) % BigInt(FOLD_TOTAL);
  let idx = Number(rem);
  for (const [start, count] of FOLD_RANGES) {
    if (idx < count) return String.fromCodePoint(start + idx);
    idx -= count;
  }
  throw new Error("unreachable fold index");
}

export function oduLink(digest: Uint8Array): { base: number; composed: number } {
  return { base: digest[0] ?? 0, composed: ((digest[0] ?? 0) << 8) | (digest[1] ?? 0) };
}

// ---- wire shape (shared cross-language projection) --------------------------

export interface GlyphWireNode {
  canonical_id: string;
  glyph: string;
  odu_base: number;
  odu_composed: number;
  ts: number;
  tags: string[];
  walrus_blob_id: string | null;
}

export interface GlyphWireEdge {
  from: string;
  to: string;
  relation: string;
}

export interface GlyphWire {
  nodes: Record<string, GlyphWireNode>;
  edges: GlyphWireEdge[];
}

// ---- galaxy projection + semantic zoom -------------------------------------

/** A base-Odù cluster: the zoom-out unit (one of the Digital Calabash's 256). */
export interface OduCluster {
  oduBase: number;
  memberIds: string[];
  /** Cluster centroid on the galaxy shell, derived deterministically. */
  position: [number, number, number];
}

/**
 * Deterministic position for a base-Odù value on a galaxy shell. The 256
 * bases spread over a Fibonacci sphere so clusters never overlap and the
 * layout is stable across renders (no physics settling needed on load).
 */
function oduShellPosition(oduBase: number, radius: number): [number, number, number] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (oduBase / 255) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = golden * oduBase;
  return [Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius];
}

/**
 * Group a glyph wire snapshot into base-Odù clusters — the zoomed-out view.
 * Each cluster is one lineage of the Digital Calabash; member ids are sorted
 * so the projection is deterministic.
 */
export function semanticZoomClusters(wire: GlyphWire, shellRadius = 100): OduCluster[] {
  const byBase = new Map<number, string[]>();
  for (const [id, node] of Object.entries(wire.nodes)) {
    const members = byBase.get(node.odu_base) ?? [];
    members.push(id);
    byBase.set(node.odu_base, members);
  }
  return [...byBase.entries()]
    .sort(([a], [b]) => a - b)
    .map(([oduBase, memberIds]) => ({
      oduBase,
      memberIds: memberIds.sort(),
      position: oduShellPosition(oduBase, shellRadius),
    }));
}

/**
 * Project a glyph wire snapshot into galaxy AgentNodes + AgentEdges — the
 * zoomed-in view. Each memory becomes a `glyph-memory` node placed near its
 * base-Odù cluster centroid (so zooming out visibly collapses a cluster into
 * one region), with the glyph as its label. `reputation` carries recency
 * (newer memories glow brighter) and `activity` marks whether the memory is
 * anchored on Walrus.
 */
export function projectGlyphGalaxy(
  wire: GlyphWire,
  options: { shellRadius?: number; now?: number } = {},
): { nodes: AgentNode[]; edges: AgentEdge[] } {
  const shellRadius = options.shellRadius ?? 100;
  const clusters = semanticZoomClusters(wire, shellRadius);
  const clusterOf = new Map<number, OduCluster>(clusters.map((c) => [c.oduBase, c]));

  const timestamps = Object.values(wire.nodes).map((n) => n.ts);
  const oldest = timestamps.length > 0 ? Math.min(...timestamps) : 0;
  const newest = options.now ?? (timestamps.length > 0 ? Math.max(...timestamps) : 1);
  const span = newest - oldest || 1;

  const nodes: AgentNode[] = Object.entries(wire.nodes)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, node]) => {
      const cluster = clusterOf.get(node.odu_base);
      const [cx, cy, cz] = cluster?.position ?? [0, 0, 0];
      // Deterministic jitter around the cluster centroid, seeded by the id.
      const seed = Number.parseInt(id.slice(0, 8), 16);
      const jitter = 8;
      const position: [number, number, number] = [
        cx + (((seed & 0xff) / 255) * 2 - 1) * jitter,
        cy + ((((seed >> 8) & 0xff) / 255) * 2 - 1) * jitter,
        cz + ((((seed >> 16) & 0xff) / 255) * 2 - 1) * jitter,
      ];
      return {
        id,
        typeId: GLYPH_MEMORY_NODE_TYPE_ID,
        label: node.glyph,
        framework: "glyphindex",
        status: "idle",
        capabilities: [],
        reputation: Math.max(0, Math.min(1, (node.ts - oldest) / span)),
        activity: node.walrus_blob_id !== null ? 1 : 0,
        memorySummary: `Odù ${node.odu_base}/${node.odu_composed} · ${node.tags.join(", ") || "untagged"}`,
        memoryEvents: [{ at: node.ts, text: `glyph ${node.glyph} (${id.slice(0, 12)}…)` }],
        position,
        createdAt: node.ts,
      };
    });

  const edges: AgentEdge[] = wire.edges
    .filter((edge) => wire.nodes[edge.from] && wire.nodes[edge.to])
    .map((edge) => ({
      id: `${edge.from}:${edge.to}:${edge.relation}`,
      sourceId: edge.from,
      targetId: edge.to,
      activity: edge.relation === "follows" ? 0.8 : 0.4,
    }));

  return { nodes, edges };
}
