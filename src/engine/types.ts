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

/** A single entry in an agent's recent-memory window, surfaced by the inspector. */
export interface MemoryEvent {
  at: number;
  text: string;
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
  /** 0..1 — pluggable reputation systems map into this range. */
  reputation: number;
  /** 0..1 recent workload level; drives the node's core pulse. */
  activity: number;
  memorySummary: string;
  /** Most recent memory events, newest first (bounded window). */
  memoryEvents: MemoryEvent[];
  /** Optional 3D position hint; the scene assigns one if omitted. */
  position?: [number, number, number];
  createdAt: number;
}

/** An active A2A communication channel between two nodes. */
export interface AgentEdge {
  id: string;
  sourceId: string;
  targetId: string;
  /** 0..1 recent activity level, driving the pulse/particle-flow visualization. */
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
  /** Optional brighter accent for cores/particles; defaults to `color`. */
  accentColor?: number;
  /** Relative visual scale, 1.0 = baseline. */
  scale: number;
  /**
   * Shell archetype — kept as a string enum so this module has no Three.js
   * dependency. orb: metallic sphere; geodesic: faceted sphere with internal
   * lattice; crystal: elongated polyhedral shard; prism: hexagonal column;
   * toroid: ring with an internal energy core.
   */
  geometry: "orb" | "geodesic" | "crystal" | "prism" | "toroid";
  /** Visual played when an agent of this type is born. Defaults to "burst". */
  birthEffect?: "burst" | "ripple" | "none";
}

/**
 * Discrete runtime events. Snapshot subscription (GraphListener) answers
 * "what does the graph look like now"; these answer "what just happened",
 * which is what effects (birth bursts, death dissolves, message pulses) and
 * the HUD event feed key off.
 */
export type GraphEvent =
  | { kind: "node_spawned"; node: AgentNode }
  | { kind: "node_updated"; node: AgentNode }
  | { kind: "node_died"; nodeId: string; label: string; receipt: string }
  | { kind: "message_pulse"; edgeId: string; sourceId: string; targetId: string }
  | { kind: "tool_invoked"; nodeId: string; tool: string; result: string };

export type GraphListener = (nodes: AgentNode[], edges: AgentEdge[]) => void;
export type GraphEventListener = (event: GraphEvent) => void;

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
    /** Optional starting reputation (0..1); backends may ignore or clamp. */
    reputation?: number;
  }): AgentNode;

  terminateNode(nodeId: string): void;

  connect(sourceId: string, targetId: string): AgentEdge;

  /** Invoke one of the agent's exposed tools; resolves with its textual result. */
  invokeTool(nodeId: string, tool: string): Promise<string>;

  /** Send a direct message/query to an agent; resolves with its reply. */
  sendMessage(nodeId: string, text: string): Promise<string>;

  getNodes(): AgentNode[];
  getEdges(): AgentEdge[];

  /** Subscribe to full-snapshot changes; returns an unsubscribe function. */
  subscribe(listener: GraphListener): () => void;

  /** Subscribe to discrete runtime events; returns an unsubscribe function. */
  onEvent(listener: GraphEventListener): () => void;

  start(): void;
  stop(): void;
}
