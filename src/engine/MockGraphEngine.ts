import type {
  AgentCapability,
  AgentEdge,
  AgentNode,
  GraphEngine,
  GraphListener,
  NodeTypeDefinition,
} from "./types";

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter.toString(36)}`;
}

/**
 * Local, in-memory implementation of GraphEngine. It simulates the parts a
 * real backend would own — spawning, message activity decay, occasional
 * random chatter between connected nodes — so the galaxy is alive without a
 * server. Swap this for a WebSocket-backed implementation of the same
 * GraphEngine interface to drive the scene from a real Elixir/Rust/Python
 * runtime; nothing in scene/ or ui/ needs to change.
 */
export class MockGraphEngine implements GraphEngine {
  private nodeTypes = new Map<string, NodeTypeDefinition>();
  private nodes = new Map<string, AgentNode>();
  private edges = new Map<string, AgentEdge>();
  private listeners = new Set<GraphListener>();
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
      reputation: 0.5,
      memorySummary: "no memory yet",
      createdAt: Date.now(),
    };
    this.nodes.set(node.id, node);
    this.emit();

    // Simulate the spawn->active transition a real sandboxed process would go through.
    setTimeout(() => {
      const current = this.nodes.get(node.id);
      if (current) {
        this.nodes.set(node.id, { ...current, status: "active" });
        this.emit();
      }
    }, 600);

    return node;
  }

  terminateNode(nodeId: string): void {
    if (!this.nodes.has(nodeId)) return;
    this.nodes.delete(nodeId);
    for (const [edgeId, edge] of this.edges) {
      if (edge.sourceId === nodeId || edge.targetId === nodeId) {
        this.edges.delete(edgeId);
      }
    }
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

  /** Decays edge activity and occasionally pulses a random edge, simulating message flow. */
  private tick(): void {
    if (this.edges.size === 0) {
      return;
    }
    let changed = false;
    for (const [id, edge] of this.edges) {
      const decayed = Math.max(0, edge.activity - 0.08);
      if (decayed !== edge.activity) {
        this.edges.set(id, { ...edge, activity: decayed });
        changed = true;
      }
    }
    if (Math.random() < 0.3) {
      const ids = [...this.edges.keys()];
      const pick = ids[Math.floor(Math.random() * ids.length)];
      const edge = this.edges.get(pick);
      if (edge) {
        this.edges.set(pick, { ...edge, activity: 1 });
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  private emit(): void {
    const nodes = this.getNodes();
    const edges = this.getEdges();
    for (const listener of this.listeners) listener(nodes, edges);
  }
}
