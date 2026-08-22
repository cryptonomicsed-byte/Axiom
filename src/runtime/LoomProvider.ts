import type { AgentInstance, AgentNode, AgentEdge, AgentRuntimeProvider } from "../engine/types";

/**
 * LOOM Provider — connects to the local LOOM fabric event bus
 * (http://localhost:8889) and translates MarketEvents into live agent
 * nodes, edges, and graph events for the galaxy.
 */

const LOOM_BASE = "http://localhost:8889";
const LOOM_WS = "ws://localhost:8889/ws";
const POLL_INTERVAL = 5000;
const MAX_NODES = 60;

interface LoomMarketEvent {
  id?: string;
  t: string;
  e: string;
  s: string;
  m: number;
  c: number;
  ts: number;
  src: string;
}

interface LoomWhale {
  address: string;
  name: string;
  pnl: number;
  total_trades: number;
  win_rate: number;
  labels: string[];
  tokens: string[];
  tier: number;
}

type NodeStatus = "spawning" | "active" | "idle" | "degraded" | "terminated";

interface EventActivity {
  activity: number;
  reputation: number;
  status: NodeStatus;
}

function eventToActivity(event: LoomMarketEvent): EventActivity {
  const base = Math.min(1, event.m);
  switch (event.t) {
    case "whale_move":
      return { activity: base * 0.9, reputation: base * 0.3, status: "active" };
    case "price_surge":
      return { activity: base * 0.8, reputation: base * 0.1, status: "active" };
    case "volume_spike":
      return { activity: base * 0.7, reputation: base * 0.05, status: "active" };
    case "anomaly":
      return { activity: base * 0.6, reputation: 0, status: "degraded" };
    case "agent_signal":
      return { activity: base * 0.5, reputation: base * event.c, status: "active" };
    default:
      return { activity: 0.3, reputation: 0.1, status: "idle" };
  }
}

function makeNodeId(prefix: string, key: string): string {
  return `loom:${prefix}:${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export class LoomProvider implements AgentRuntimeProvider {
  readonly typeIds = ["python-fabric", "elixir-core"];

  private ws: WebSocket | null = null;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  private onNodesChanged: ((nodes: AgentNode[], edges: AgentEdge[]) => void) | null = null;
  private onEvent: ((event: any) => void) | null = null;

  private nodes = new Map<string, AgentNode>();
  private edges = new Map<string, AgentEdge>();
  private nodeCounter = 0;
  private edgeCounter = 0;

  private loomCenterId = makeNodeId("center", "loom");

  connect(onNodes: (nodes: AgentNode[], edges: AgentEdge[]) => void, onEvent: (event: any) => void): void {
    this.onNodesChanged = onNodes;
    this.onEvent = onEvent;
    this.start();
  }

  disconnect(): void {
    this.stop();
  }

  async spawn(_node: AgentNode): Promise<AgentInstance> {
    return {
      capabilities: [
        { name: "market-brief", description: "Latest market narrative brief from LOOM" },
        { name: "whale-leaderboard", description: "Top whale performers" },
        { name: "consensus", description: "Current agent consensus signal" },
      ],
      async invokeTool(tool: string, _arg: string): Promise<string> {
        try {
          const res = await fetch(`${LOOM_BASE}/api/${tool}`, { signal: AbortSignal.timeout(5000) });
          if (res.ok) return await res.text();
          return `tool ${tool} returned ${res.status}`;
        } catch (e) {
          return `tool ${tool} failed: ${e}`;
        }
      },
      async sendMessage(text: string): Promise<string> {
        return `LOOM fabric received: "${text}". Check stream at ${LOOM_BASE}`;
      },
      terminate(): void {
        // external process — no-op
      },
    };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.ensureLoomCenter();
    this.connectWs();
    this.pollTimer = setInterval(() => this.pollSnapshot(), POLL_INTERVAL);
    this.pollSnapshot();
  }

  stop(): void {
    this.started = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private ensureLoomCenter(): void {
    if (this.nodes.has(this.loomCenterId)) return;
    this.nodeCounter++;
    const ts = Date.now();
    this.nodes.set(this.loomCenterId, {
      id: this.loomCenterId,
      typeId: "elixir-core",
      label: "LOOM-fabric",
      framework: "LOOM Event Bus",
      status: "active",
      capabilities: [
        { name: "market-brief", description: "Latest market narrative brief" },
        { name: "whale-leaderboard", description: "Top whale performers" },
      ],
      reputation: 0.75,
      activity: 0.5,
      memorySummary: "LOOM fabric — causal event engine + multi-agent debate",
      memoryEvents: [{ at: ts, text: "LOOM fabric initialized" }],
      createdAt: ts,
      position: [-4, 0, 0],
    });
    this.emit();
  }

  private connectWs(): void {
    if (!this.started) return;
    try {
      this.ws = new WebSocket(LOOM_WS);
      this.ws.onopen = () => {
        this.touchNode(this.loomCenterId, "WebSocket connected — live event stream", 0.2);
      };
      this.ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data.type === "ping") return;
          const event: LoomMarketEvent = data.event || data;
          this.handleMarketEvent(event);
        } catch {
          /* skip malformed */
        }
      };
      this.ws.onclose = () => {
        this.touchNode(this.loomCenterId, "WebSocket disconnected — reconnecting...", -0.1);
        this.ws = null;
        if (this.started) {
          this.wsReconnectTimer = setTimeout(() => this.connectWs(), 3000);
        }
      };
      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch {
      if (this.started) {
        this.wsReconnectTimer = setTimeout(() => this.connectWs(), 3000);
      }
    }
  }

  private handleMarketEvent(event: LoomMarketEvent): void {
    const entity = event.e || "?";
    const symbol = event.s || entity;
    const source = event.src || "loom";

    const nodeType = event.t === "whale_move" ? "elixir-core" : "python-fabric";
    const nodeId = makeNodeId(source, entity);

    if (!this.nodes.has(nodeId) && this.nodes.size < MAX_NODES) {
      this.nodeCounter++;
      const { activity, reputation, status } = eventToActivity(event);
      this.nodes.set(nodeId, {
        id: nodeId,
        typeId: nodeType,
        label: symbol,
        framework: `LOOM:${source}`,
        status,
        capabilities: [],
        reputation: clamp(reputation + 0.1),
        activity: clamp(activity),
        memorySummary: `${event.t} — mag ${event.m.toFixed(2)}`,
        memoryEvents: [{ at: Date.now(), text: `${event.t} from ${source}` }],
        createdAt: Date.now(),
      });

      const edgeId = `loom:edge:${nodeId}`;
      if (!this.edges.has(edgeId)) {
        this.edgeCounter++;
        this.edges.set(edgeId, {
          id: edgeId,
          sourceId: this.loomCenterId,
          targetId: nodeId,
          activity: clamp(event.m),
        });
      }

      this.emitEvent({ kind: "node_spawned", node: this.nodes.get(nodeId)! });
    } else if (this.nodes.has(nodeId)) {
      const existing = this.nodes.get(nodeId)!;
      const { activity, reputation } = eventToActivity(event);
      const updated: AgentNode = {
        ...existing,
        activity: clamp((existing.activity + activity) / 2),
        reputation: clamp(existing.reputation + reputation * 0.1),
        memorySummary: `${event.t} — mag ${event.m.toFixed(2)}`,
        memoryEvents: [
          { at: Date.now(), text: `${event.t} (${source}): ${symbol} mag=${event.m.toFixed(2)}` },
          ...existing.memoryEvents,
        ].slice(0, 8),
      };
      this.nodes.set(nodeId, updated);
      this.emitEvent({ kind: "node_updated", node: updated });
    }

    const edgeKey = `loom:edge:${nodeId}`;
    if (this.edges.has(edgeKey)) {
      const edge = this.edges.get(edgeKey)!;
      this.edges.set(edge.id, { ...edge, activity: clamp(event.m) });
      this.emitEvent({
        kind: "message_pulse",
        edgeId: edge.id,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
      });
    }

    this.emit();
  }

  private async pollSnapshot(): Promise<void> {
    if (!this.started) return;
    try {
      const lbRes = await fetch(`${LOOM_BASE}/api/whales/leaderboard`, {
        signal: AbortSignal.timeout(4000),
      });
      if (lbRes.ok) {
        const whales: LoomWhale[] = await lbRes.json();
        for (const whale of (whales || []).slice(0, 15)) {
          const nodeId = makeNodeId("whale", whale.address);
          if (!this.nodes.has(nodeId) && this.nodes.size < MAX_NODES) {
            this.nodeCounter++;
            const name = whale.name || `whale-${whale.address.slice(0, 6)}`;
            this.nodes.set(nodeId, {
              id: nodeId,
              typeId: "elixir-core",
              label: name,
              framework: "LOOM:whale",
              status: "active",
              capabilities: [],
              reputation: clamp(whale.win_rate || 0.5),
              activity: clamp(Math.min(1, (whale.pnl || 0) / 100 + 0.3)),
              memorySummary: `PNL ${whale.pnl?.toFixed(2) || "?"} SOL · ${whale.total_trades || 0} trades`,
              memoryEvents: [{ at: Date.now(), text: `whale tracked: ${whale.tokens?.join(", ") || "?"}` }],
              createdAt: Date.now(),
            });

            for (const token of (whale.tokens || []).slice(0, 5)) {
              const tokenId = makeNodeId("token", token);
              if (!this.nodes.has(tokenId) && this.nodes.size < MAX_NODES) {
                this.nodeCounter++;
                this.nodes.set(tokenId, {
                  id: tokenId,
                  typeId: "python-fabric",
                  label: token,
                  framework: "LOOM:token",
                  status: "active",
                  capabilities: [],
                  reputation: 0.3,
                  activity: 0.3,
                  memorySummary: `tracked by whales`,
                  memoryEvents: [],
                  createdAt: Date.now(),
                });
              }
              const tEdgeId = `loom:w2t:${whale.address.slice(0, 8)}:${token}`;
              if (!this.edges.has(tEdgeId)) {
                this.edges.set(tEdgeId, {
                  id: tEdgeId,
                  sourceId: nodeId,
                  targetId: tokenId,
                  activity: 0.4,
                });
              }
            }

            const wEdgeId = `loom:c2w:${whale.address.slice(0, 8)}`;
            if (!this.edges.has(wEdgeId)) {
              this.edges.set(wEdgeId, {
                id: wEdgeId,
                sourceId: this.loomCenterId,
                targetId: nodeId,
                activity: 0.5,
              });
            }
          }
        }
      }
    } catch {
      // LOOM server may not be running — silently skip
    }
    this.emit();
  }

  private touchNode(nodeId: string, text: string, activityBoost: number): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    const updated: AgentNode = {
      ...node,
      activity: clamp(node.activity + activityBoost),
      memoryEvents: [{ at: Date.now(), text }, ...node.memoryEvents].slice(0, 8),
      memorySummary: text,
    };
    this.nodes.set(nodeId, updated);
    this.emitEvent({ kind: "node_updated", node: updated });
    this.emit();
  }

  private emit(): void {
    if (this.onNodesChanged) {
      this.onNodesChanged([...this.nodes.values()], [...this.edges.values()]);
    }
  }

  private emitEvent(event: any): void {
    if (this.onEvent) this.onEvent(event);
  }
}
