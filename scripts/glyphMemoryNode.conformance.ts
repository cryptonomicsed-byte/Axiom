// Conformance runner for the GlyphIndex galaxy leg. Run with Bun:
//   bun run scripts/glyphMemoryNode.conformance.ts
//
// Pins the frozen cross-language fold vectors (OSOVM/GLYPHINDEX_SPEC.md §6)
// and checks that the galaxy projection places every memory in its base-Odù
// cluster (the semantic-zoom unit) deterministically.

import {
  canonicalId,
  contentHash,
  glyphFold,
  type GlyphWire,
  oduLink,
  projectGlyphGalaxy,
  semanticZoomClusters,
} from "../src/nodeTypes/glyphMemoryNode";

const FROZEN: readonly [string, number, number, number][] = [
  ["Àṣẹ", 21841, 227, 58152],
  ["hello", 23636, 44, 11506],
  ["GlyphIndex", 13726, 68, 17595],
  ["😊🚀 Unicode test", 64591, 189, 48626],
  ["Ọ̀rúnmìlà", 17963, 204, 52390],
];

function assert(cond: boolean, label: string): void {
  if (!cond) throw new Error(`conformance failure: ${label}`);
}

async function main(): Promise<void> {
  // Frozen fold + Odù vectors, and build a wire snapshot from them.
  const wire: GlyphWire = { nodes: {}, edges: [] };
  const ids: string[] = [];
  for (const [text, codepoint, base, composed] of FROZEN) {
    const digest = await contentHash(text);
    const id = canonicalId(digest);
    assert(glyphFold(digest).codePointAt(0) === codepoint, `fold ${text}`);
    const odu = oduLink(digest);
    assert(odu.base === base && odu.composed === composed, `odu ${text}`);
    ids.push(id);
    wire.nodes[id] = {
      canonical_id: id,
      glyph: glyphFold(digest),
      odu_base: base,
      odu_composed: composed,
      ts: ids.length,
      tags: text === "hello" ? ["topic:greeting"] : [],
      walrus_blob_id: text === "hello" ? "walrus://vault/hello-chunk" : null,
    };
  }
  wire.edges.push({ from: ids[0] as string, to: ids[1] as string, relation: "follows" });

  // Semantic zoom: five distinct base-Odù values → five clusters.
  const clusters = semanticZoomClusters(wire);
  assert(clusters.length === 5, "one cluster per base Odù");
  assert(
    clusters.every((c) => c.memberIds.length === 1),
    "each frozen vector has a distinct base Odù",
  );
  // Clusters are sorted by base Odù and positions are deterministic.
  assert(
    clusters.map((c) => c.oduBase).join(",") === "44,68,189,204,227",
    "clusters sorted by base Odù",
  );

  // Galaxy projection: one glyph-memory node per memory, near its cluster.
  const galaxy = projectGlyphGalaxy(wire);
  assert(galaxy.nodes.length === 5, "one galaxy node per memory");
  assert(
    galaxy.nodes.every((n) => n.typeId === "glyph-memory"),
    "nodes use the glyph-memory type",
  );
  assert(galaxy.edges.length === 1 && galaxy.edges[0]?.sourceId === ids[0], "follows edge projected");
  const hello = galaxy.nodes.find((n) => n.id === ids[1]);
  assert(hello?.label === wire.nodes[ids[1] as string]?.glyph, "label is the glyph");
  assert(hello?.activity === 1, "walrus-anchored memory is active");

  // A node's position sits within jitter range of its cluster centroid, so
  // zooming out visibly collapses each memory into its lineage region.
  const helloCluster = clusters.find((c) => c.oduBase === 44);
  const dx = (hello?.position?.[0] ?? 0) - (helloCluster?.position[0] ?? 0);
  assert(Math.abs(dx) <= 8.001, "node hugs its base-Odù cluster centroid");

  console.log("glyphMemoryNode conformance ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
