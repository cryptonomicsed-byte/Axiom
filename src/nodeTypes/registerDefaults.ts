import type { GraphEngine, NodeTypeDefinition } from "../engine/types";

/**
 * Default pluggable node types, one per illustrative framework tier. This is
 * intentionally a small, neutral starter set — any framework can add its own
 * NodeTypeDefinition at runtime via engine.registerNodeType(), it does not
 * need to live in this file or ship with AXIOM itself.
 */
export const DEFAULT_NODE_TYPES: NodeTypeDefinition[] = [
  {
    id: "rust-wasm-leaf",
    label: "Rust/Wasm Leaf",
    description: "Lightweight sandboxed leaf agent compiled to WebAssembly. Cheap to spawn by the thousand.",
    color: 0xff7a45,
    accentColor: 0xffb37a,
    scale: 0.7,
    geometry: "orb",
    birthEffect: "burst",
  },
  {
    id: "elixir-core",
    label: "Elixir Core",
    description: "Fault-tolerant supervisor / orchestration process on the BEAM. Owns topology authority.",
    color: 0x6a5cff,
    accentColor: 0x9d8cff,
    scale: 1.2,
    geometry: "geodesic",
    birthEffect: "burst",
  },
  {
    id: "python-fabric",
    label: "Python Fabric",
    description: "Existing market-intelligence / rapid-iteration agents (e.g. LOOM analytical engines).",
    color: 0x2fd4c7,
    accentColor: 0x7df2e8,
    scale: 1.0,
    geometry: "crystal",
    birthEffect: "burst",
  },
  {
    id: "typescript-surface",
    label: "TypeScript Surface",
    description: "Browser-facing agents and UI-adjacent services exposing tools over the surface layer.",
    color: 0xf5c542,
    accentColor: 0xffe08a,
    scale: 0.9,
    geometry: "prism",
    birthEffect: "burst",
  },
  {
    id: "go-flow",
    label: "Go Flow",
    description: "Sync: rhythm/rate-limit enforcement — Sabbath gating and per-agent primitive cooldowns.",
    color: 0x00b8d9,
    accentColor: 0x7ce8ff,
    scale: 0.85,
    geometry: "prism",
    birthEffect: "burst",
  },
  {
    id: "julia-compute",
    label: "Julia Compute",
    description: "Heavy numerical / graph-compute workers, invoked for expensive analytical passes.",
    color: 0xe64ac9,
    accentColor: 0xff8ae4,
    scale: 1.1,
    geometry: "toroid",
    birthEffect: "burst",
  },
  {
    id: "obatala-wisdom",
    label: "Policy (Wisdom)",
    description: "Symbolic reasoning & ethics engine — consent logic, privacy gating, Hermetic evaluation.",
    color: 0xf5f5f5,
    accentColor: 0xffffff,
    scale: 1.2,
    geometry: "geodesic",
    birthEffect: "burst",
  },
  {
    id: "move-onchain",
    label: "Move (Sui)",
    description: "Published on-chain package (omokoda-on-chain) — agent/soul/synapse/garden modules, queried live from Sui testnet.",
    color: 0x4da6ff,
    accentColor: 0xa8d4ff,
    scale: 1.3,
    geometry: "crystal",
    birthEffect: "burst",
  },
  {
    id: "fractal-oracle",
    label: "Fractal Oracle",
    description:
      "Mandelbrot dynamics engine (real Wasm). Scans strategy/market/swarm space: bounded orbits are robust islands, escape times map fragility. Its shell renders a live escape-time fractal.",
    color: 0x8a5cff,
    accentColor: 0xffd27a,
    scale: 1.5,
    geometry: "geodesic",
    birthEffect: "burst",
  },
];

export function registerDefaultNodeTypes(engine: GraphEngine): void {
  for (const def of DEFAULT_NODE_TYPES) {
    engine.registerNodeType(def);
  }
}
