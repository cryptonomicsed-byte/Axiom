/**
 * Core data model for the AXIOM galaxy.
 *
 * The graph IS the runtime: an AgentNode represents a live agent instance
 * (regardless of which language/framework backs it), and an AgentEdge
 * represents an active communication channel between two agents. Nothing
 * here assumes a specific runtime — Rust/Wasm, Elixir, Python, or any
 * future framework can be represented the same way as long as it can
 * describe itself with these shapes.
 */

export type NodeStatus = "spawning" | "active" | "idle" | "degraded" | "terminated";

export interface AgentCapability {
  name: string;
  description: string;
}

/** Live, framework-agnostic snapshot of a single agent instance. */
export interface AgentNode {
  id: string;
  /** Registry key of the NodeTypeDefinition that governs this node's look/behavior. */
  typeId: string;
  label: string;
  framework: string;
  status: NodeStatus;
  capabilities: AgentCapability[];
  reputation: number;
  memorySummary: string;
  /** Optional 3D position hint; the scene assigns one if omitted. */
  position?: [number, number, number];
  createdAt: number;
}

/** An active A2A communication channel between two nodes. */
export interface AgentEdge {
  id: string;
  sourceId: string;
  targetId: string;
  /** 0..1 recent activity level, driving the pulse visualization. */
  activity: number;
}

/**
 * Pluggable node type: any framework registers one of these to describe how
 * its agents should be visualized, without the engine or scene needing to
 * know anything about that framework ahead of time.
 */
export interface NodeTypeDefinition {
  id: string;
  label: string;
  description: string;
  /** Hex color used for the node mesh and its edges/UI accents. */
  color: number;
  /** Relative visual scale, 1.0 = baseline. */
  scale: number;
  /** Three.js geometry kind — kept as a string enum so this module has no Three.js dependency. */
  geometry: "icosahedron" | "sphere" | "box" | "octahedron" | "torus";
}

export type GraphListener = (nodes: AgentNode[], edges: AgentEdge[]) => void;

/**
 * The interface any backend must implement to drive the galaxy. The demo
 * ships a MockGraphEngine that simulates activity locally; a production
 * deployment swaps that for an implementation backed by a real transport
 * (e.g. a WebSocket bridge into an Elixir GraphEngine) without the scene or
 * UI layers changing at all.
 */
export interface GraphEngine {
  registerNodeType(def: NodeTypeDefinition): void;
  getNodeTypes(): NodeTypeDefinition[];

  spawnNode(input: {
    typeId: string;
    label: string;
    framework: string;
    capabilities?: AgentCapability[];
  }): AgentNode;

  terminateNode(nodeId: string): void;

  connect(sourceId: string, targetId: string): AgentEdge;

  getNodes(): AgentNode[];
  getEdges(): AgentEdge[];

  /** Subscribe to any change in graph state; returns an unsubscribe function. */
  subscribe(listener: GraphListener): () => void;

  start(): void;
  stop(): void;
}
