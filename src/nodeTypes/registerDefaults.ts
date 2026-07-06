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
    scale: 0.7,
    geometry: "octahedron",
  },
  {
    id: "elixir-core",
    label: "Elixir Core",
    description: "Fault-tolerant supervisor / orchestration process on the BEAM. Owns topology authority.",
    color: 0x6a5cff,
    scale: 1.2,
    geometry: "icosahedron",
  },
  {
    id: "python-fabric",
    label: "Python Fabric",
    description: "Existing market-intelligence / rapid-iteration agents (e.g. LOOM analytical engines).",
    color: 0x2fd4c7,
    scale: 1.0,
    geometry: "sphere",
  },
  {
    id: "typescript-surface",
    label: "TypeScript Surface",
    description: "Browser-facing agents and UI-adjacent services exposing tools over the surface layer.",
    color: 0xf5c542,
    scale: 0.9,
    geometry: "box",
  },
  {
    id: "julia-compute",
    label: "Julia Compute",
    description: "Heavy numerical / graph-compute workers, invoked for expensive analytical passes.",
    color: 0xe64ac9,
    scale: 1.1,
    geometry: "torus",
  },
];

export function registerDefaultNodeTypes(engine: GraphEngine): void {
  for (const def of DEFAULT_NODE_TYPES) {
    engine.registerNodeType(def);
  }
}
