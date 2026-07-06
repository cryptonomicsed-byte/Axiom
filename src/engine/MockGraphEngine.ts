import type {
  AgentCapability,
  AgentEdge,
  AgentNode,
  GraphEngine,
  GraphEvent,
  GraphEventListener,
  GraphListener,
  MemoryEvent,
  NodeTypeDefinition,
} from "./types";

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter.toString(36)}`;
}

const MEMORY_WINDOW = 8;
/** Autonomous spawning stops once the swarm reaches this size. */
const AUTOSPAWN_CAP = 42;

const TOOL_RESULTS = [
  "ok — 3 records processed",
  "signal enriched, confidence 0.87",
  "no anomalies in current window",
  "task delegated to sibling",
  "cache warm, latency 12ms",
];

const MESSAGE_REPLIES = [
  "acknowledged. adjusting priorities.",
  "current focus: enrichment pass on inbound events.",
  "state nominal. reputation trending up.",
  "I can take that task — routing through my queue.",
  "insufficient context; broadcasting a discovery request.",
];

/**
 * Local, in-memory implementation of GraphEngine. It simulates everything a
 * real backend would own — spawning (including autonomous spawn chains),
 * per-node activity drift, reputation evolution, memory event logs, message
 * traffic, and tool invocation — so the galaxy feels alive without a server.
 * Swap this for a transport-backed implementation of the same GraphEngine
 * interface to drive the scene from a real Elixir/Rust/Python runtime;
 * nothing in scene/ or ui/ needs to change.
 */
export class MockGraphEngine implements GraphEngine {
  private nodeTypes = new Map<string, NodeTypeDefinition>();
  private nodes = new Map<string, AgentNode>();
  private edges = new Map<string, AgentEdge>();
  private listeners = new Set<GraphListener>();
  private eventListeners = new Set<GraphEventListener>();
  private tickHandle: ReturnType<typeof setInterval> | null = null;

  registerNodeType(def: NodeTypeDefinition): void {
    this.nodeTypes.set(def.id, def);
  }

  getNodeTypes(): NodeTypeDefinition[] {
    return [...this.nodeTypes.values()];
  }

  spawnNode(input: {
    typeId: string;
    label: string;
    framework: string;
    capabilities?: AgentCapability[];
  }): AgentNode {
    if (!this.nodeTypes.has(input.typeId)) {
      throw new Error(`Unknown node type "${input.typeId}" — register it before spawning.`);
    }
    const node: AgentNode = {
      id: nextId("node"),
      typeId: input.typeId,
      label: input.label,
      framework: input.framework,
      status: "spawning",
      capabilities: input.capabilities ?? [],
      reputation: 0.35 + Math.random() * 0.3,
      activity: 0.6,
      memorySummary: "bootstrapping memory namespace",
      memoryEvents: [{ at: Date.now(), text: "agent born; namespace allocated" }],
      createdAt: Date.now(),
    };
    this.nodes.set(node.id, node);
    this.emitEvent({ kind: "node_spawned", node });
    this.emit();

    // Simulate the spawn->active transition a real sandboxed process would go through.
    setTimeout(() => {
      const current = this.nodes.get(node.id);
      if (current) {
        const updated = {
          ...current,
          status: "active" as const,
          memorySummary: "warm; observing fabric events",
        };
        this.nodes.set(node.id, updated);
        this.emitEvent({ kind: "node_updated", node: updated });
        this.emit();
      }
    }, 600);

    return node;
  }

  terminateNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    this.nodes.delete(nodeId);
    for (const [edgeId, edge] of this.edges) {
      if (edge.sourceId === nodeId || edge.targetId === nodeId) {
        this.edges.delete(edgeId);
      }
    }
    this.emitEvent({
      kind: "node_died",
      nodeId,
      label: node.label,
      receipt: `receipt:${nodeId}:${Date.now().toString(36)}`,
    });
    this.emit();
  }

  connect(sourceId: string, targetId: string): AgentEdge {
    const edge: AgentEdge = {
      id: nextId("edge"),
      sourceId,
      targetId,
      activity: 1,
    };
    this.edges.set(edge.id, edge);
    this.emit();
    return edge;
  }

  async invokeTool(nodeId: string, tool: string): Promise<string> {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    await delay(300 + Math.random() * 500);
    const result = TOOL_RESULTS[Math.floor(Math.random() * TOOL_RESULTS.length)];
    this.touchNode(nodeId, `tool "${tool}" invoked → ${result}`, 0.35);
    this.emitEvent({ kind: "tool_invoked", nodeId, tool, result });
    return result;
  }

  async sendMessage(nodeId: string, text: string): Promise<string> {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    await delay(400 + Math.random() * 600);
    const reply = MESSAGE_REPLIES[Math.floor(Math.random() * MESSAGE_REPLIES.length)];
    this.touchNode(nodeId, `direct message: "${truncate(text, 48)}"`, 0.25);
    return reply;
  }

  getNodes(): AgentNode[] {
    return [...this.nodes.values()];
  }

  getEdges(): AgentEdge[] {
    return [...this.edges.values()];
  }

  subscribe(listener: GraphListener): () => void {
    this.listeners.add(listener);
    listener(this.getNodes(), this.getEdges());
    return () => this.listeners.delete(listener);
  }

  onEvent(listener: GraphEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  start(): void {
    if (this.tickHandle) return;
    this.tickHandle = setInterval(() => this.tick(), 350);
  }

  stop(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  /** One simulation step: decay, chatter, drift, and occasional autonomous spawns. */
  private tick(): void {
    let changed = false;

    // Edge activity decays; random edges pulse with new messages.
    for (const [id, edge] of this.edges) {
      const decayed = Math.max(0, edge.activity - 0.06);
      if (decayed !== edge.activity) {
        this.edges.set(id, { ...edge, activity: decayed });
        changed = true;
      }
    }
    if (this.edges.size > 0 && Math.random() < 0.45) {
      const ids = [...this.edges.keys()];
      const pick = ids[Math.floor(Math.random() * ids.length)];
      const edge = this.edges.get(pick);
      if (edge) {
        this.edges.set(pick, { ...edge, activity: 1 });
        this.emitEvent({
          kind: "message_pulse",
          edgeId: edge.id,
          sourceId: edge.sourceId,
          targetId: edge.targetId,
        });
        changed = true;
      }
    }

    // Node activity/reputation drift.
    for (const [id, node] of this.nodes) {
      if (node.status !== "active") continue;
      const activity = clamp(node.activity + (Math.random() - 0.52) * 0.12);
      const reputation = clamp(node.reputation + (Math.random() - 0.5) * 0.01);
      if (Math.abs(activity - node.activity) > 0.001 || reputation !== node.reputation) {
        this.nodes.set(id, { ...node, activity, reputation });
        changed = true;
      }
    }

    // Occasionally an active agent spawns a helper leaf — visible graph growth.
    if (this.nodes.size < AUTOSPAWN_CAP && Math.random() < 0.03) {
      const parents = this.getNodes().filter((n) => n.status === "active");
      if (parents.length > 0) {
        const parent = parents[Math.floor(Math.random() * parents.length)];
        const leafType = this.nodeTypes.get("rust-wasm-leaf") ?? this.getNodeTypes()[0];
        if (leafType) {
          const child = this.spawnNode({
            typeId: leafType.id,
            label: `${parent.label.split("-")[0]}-helper-${counter.toString(36)}`,
            framework: leafType.label,
            capabilities: [{ name: "assist", description: `Delegated subtask from ${parent.label}` }],
          });
          this.connect(parent.id, child.id);
          this.touchNode(parent.id, `spawned helper ${child.label}`, 0.2);
        }
      }
    }

    if (changed) this.emit();
  }

  /** Records a memory event on a node and bumps its activity. */
  private touchNode(nodeId: string, memoryText: string, activityBoost: number): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    const memoryEvent: MemoryEvent = { at: Date.now(), text: memoryText };
    const updated: AgentNode = {
      ...node,
      activity: clamp(node.activity + activityBoost),
      memoryEvents: [memoryEvent, ...node.memoryEvents].slice(0, MEMORY_WINDOW),
      memorySummary: memoryText,
    };
    this.nodes.set(nodeId, updated);
    this.emitEvent({ kind: "node_updated", node: updated });
    this.emit();
  }

  private emit(): void {
    const nodes = this.getNodes();
    const edges = this.getEdges();
    for (const listener of this.listeners) listener(nodes, edges);
  }

  private emitEvent(event: GraphEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
