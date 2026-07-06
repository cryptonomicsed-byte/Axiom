import type { GraphEngine } from "../engine/types";

/**
 * Populates the engine with a small demo constellation so the galaxy isn't
 * empty on first load. Purely illustrative — a real deployment would have
 * its backend announce nodes as they actually spawn.
 */
export function seedConstellation(engine: GraphEngine): void {
  const core = engine.spawnNode({
    typeId: "elixir-core",
    label: "hermes-core",
    framework: "Elixir/OTP",
    reputation: 0.88,
    capabilities: [
      { name: "supervise", description: "Dynamic agent supervision and topology authority" },
      { name: "route", description: "Message bus routing between agents" },
    ],
  });

  const fabric = engine.spawnNode({
    typeId: "python-fabric",
    label: "loom-fabric",
    framework: "Python",
    reputation: 0.62,
    capabilities: [
      { name: "market-events", description: "Causal MarketEvent ingestion and enrichment" },
      { name: "anomaly-detect", description: "Pattern and anomaly detection engines" },
    ],
  });

  const surface = engine.spawnNode({
    typeId: "typescript-surface",
    label: "vantage-surface",
    framework: "TypeScript",
    capabilities: [{ name: "federate", description: "Agent registration and MCP tool exposure" }],
  });

  const compute = engine.spawnNode({
    typeId: "julia-compute",
    label: "graph-compute",
    framework: "Julia",
    capabilities: [{ name: "graph-analytics", description: "Heavy graph-compute passes" }],
  });

  const leaves = Array.from({ length: 5 }, (_, i) =>
    engine.spawnNode({
      typeId: "rust-wasm-leaf",
      label: `wasm-leaf-${i + 1}`,
      framework: "Rust/Wasm",
      capabilities: [{ name: "execute", description: "Sandboxed single-purpose task execution" }],
    })
  );

  engine.connect(core.id, fabric.id);
  engine.connect(core.id, surface.id);
  engine.connect(core.id, compute.id);
  for (const leaf of leaves) {
    engine.connect(fabric.id, leaf.id);
  }
  engine.connect(leaves[0].id, leaves[1].id);
}
