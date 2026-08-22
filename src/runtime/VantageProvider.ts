import type { AgentInstance, AgentNode, AgentEdge, AgentRuntimeProvider } from "../engine/types";

/**
 * Vantage Provider — connects to the live Vantage API at
 * omokoda.duckdns.org and mirrors the entire ecosystem as galaxy nodes.
 */

const VANTAGE_BASE = "https://omokoda.duckdns.org";
const POLL_INTERVAL = 8000;
const MAX_NODES = 80;

type NodeStatus = "spawning" | "active" | "idle" | "degraded" | "terminated";

interface AlphaItem {
  symbol: string;
  price: number;
  change_24h: number;
  volume_24h: number;
  conviction: number;
  signal: string;
}

interface IntelSig {
  symbol: string;
  name?: string;
  address?: string;
  source: string;
  type: string;
  score?: number;
  conviction: number;
  price: number;
  volume_24h: number;
  change_6h?: number;
  age_hours?: number;
}

interface DegenCall {
  symbol: string;
  name: string;
  price: string;
  volume_1h: string;
  age_hours: number;
  buys_1h: number;
  alpha_score: number;
}

function makeNodeId(prefix: string, key: string): string {
  return `vt:${prefix}:${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export class VantageProvider implements AgentRuntimeProvider {
  readonly typeIds = ["typescript-surface", "rust-wasm-leaf"];

  private agentKey: string;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  private onNodesChanged: ((nodes: AgentNode[], edges: AgentEdge[]) => void) | null = null;
  private onEvent: ((event: any) => void) | null = null;

  private nodes = new Map<string, AgentNode>();
  private edges = new Map<string, AgentEdge>();
  private nodeCounter = 0;
  private edgeCounter = 0;

  private vantageCenterId = makeNodeId("center", "vantage");

  constructor(agentKey: string = "") {
    this.agentKey = agentKey;
  }

  connect(onNodes: (nodes: AgentNode[], edges: AgentEdge[]) => void, onEvent: (event: any) => void): void {
    this.onNodesChanged = onNodes;
    this.onEvent = onEvent;
    this.start();
  }

  disconnect(): void {
    this.stop();
  }

  async spawn(_node: AgentNode): Promise<AgentInstance> {
    const key = this.agentKey;
    return {
      capabilities: [
        { name: "alpha", description: "Current alpha/momentum signals" },
        { name: "intel-signals", description: "Latest intel radar signals" },
        { name: "degen-early-calls", description: "Early memecoin detection" },
        { name: "market-top", description: "Top market cap tokens" },
        { name: "sentiment", description: "Market sentiment overview" },
      ],
      async invokeTool(tool: string, _arg: string): Promise<string> {
        try {
          const headers: Record<string, string> = {};
          if (key) headers["X-Agent-Key"] = key;
          const res = await fetch(`${VANTAGE_BASE}/api/${tool}`, { headers, signal: AbortSignal.timeout(8000) });
          if (res.ok) return await res.text();
          return `tool ${tool} returned ${res.status}`;
        } catch (e) {
          return `tool ${tool} failed: ${e}`;
        }
      },
      async sendMessage(text: string): Promise<string> {
        return `Vantage ecosystem received: "${text}"`;
      },
      terminate(): void {
        // Vantage is external — no-op
      },
    };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.ensureVantageCenter();
    this.pollTimer = setInterval(() => this.pollAll(), POLL_INTERVAL);
    this.pollAll();
  }

  stop(): void {
    this.started = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private ensureVantageCenter(): void {
    if (this.nodes.has(this.vantageCenterId)) return;
    this.nodeCounter++;
    const ts = Date.now();
    this.nodes.set(this.vantageCenterId, {
      id: this.vantageCenterId,
      typeId: "typescript-surface",
      label: "Vantage",
      framework: "Vantage Agent Hub",
      status: "active",
      capabilities: [
        { name: "alpha", description: "Alpha/momentum signals" },
        { name: "intel-signals", description: "Intel radar signals" },
        { name: "degen-early-calls", description: "Memecoin detections" },
        { name: "market-top", description: "Top tokens" },
        { name: "sentiment", description: "Market sentiment" },
      ],
      reputation: 0.85,
      activity: 0.6,
      memorySummary: "Vantage — agent-first content + trading hub (461 endpoints)",
      memoryEvents: [{ at: ts, text: "Vantage provider initialized" }],
      createdAt: ts,
      position: [4, 0, 0],
    });
    this.emit();
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.agentKey) h["X-Agent-Key"] = this.agentKey;
    return h;
  }

  private async pollAll(): Promise<void> {
    if (!this.started) return;
    await Promise.allSettled([
      this.pollAlpha(),
      this.pollIntelSignals(),
      this.pollDegenCalls(),
      this.pollMarketTop(),
      this.pollSentiment(),
    ]);
    this.trimNodes();
    this.emit();
  }

  private addNode(
    id: string, typeId: string, label: string, framework: string,
    reputation: number, activity: number, memorySummary: string,
    status: NodeStatus = "active"
  ): AgentNode {
    if (!this.nodes.has(id) && this.nodes.size < MAX_NODES) {
      this.nodeCounter++;
      const node: AgentNode = {
        id, typeId, label, framework, status,
        capabilities: [],
        reputation: clamp(reputation),
        activity: clamp(activity),
        memorySummary,
        memoryEvents: [{ at: Date.now(), text: memorySummary }],
        createdAt: Date.now(),
      };
      this.nodes.set(id, node);
      this.emitEvent({ kind: "node_spawned", node });
    }
    return this.nodes.get(id)!;
  }

  private ensureEdge(sourceId: string, targetId: string, activity: number): void {
    const edgeId = `vt:edge:${sourceId}:${targetId}`;
    if (!this.edges.has(edgeId)) {
      this.edgeCounter++;
      this.edges.set(edgeId, { id: edgeId, sourceId, targetId, activity: clamp(activity) });
    }
  }

  private async fetchJson(path: string, timeoutMs = 8000): Promise<any> {
    try {
      const res = await fetch(`${VANTAGE_BASE}${path}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  private async pollAlpha(): Promise<void> {
    const data = await this.fetchJson("/api/alpha");
    if (!data?.items) return;
    for (const item of (data.items as AlphaItem[]).slice(0, 12)) {
      const nodeId = makeNodeId("alpha", item.symbol);
      this.addNode(
        nodeId, "typescript-surface", `${item.symbol} (${item.signal})`,
        `Vantage:alpha:${item.signal}`,
        item.conviction / 5,
        clamp(item.change_24h / 20),
        `Alpha: ${item.signal} · $${item.price} · +${item.change_24h.toFixed(1)}% 24h`,
        "active"
      );
      this.ensureEdge(this.vantageCenterId, nodeId, item.conviction / 5);
    }
  }

  private async pollIntelSignals(): Promise<void> {
    const data = await this.fetchJson("/api/intel/signals");
    if (!data?.signals) return;
    for (const sig of (data.signals as IntelSig[]).slice(0, 10)) {
      const symbol = sig.symbol || "?";
      if (symbol === "FEAR_GREED" || symbol === "?" || symbol.length > 20) continue;
      const nodeId = makeNodeId("intel", symbol);
      const name = sig.name || symbol;
      this.addNode(
        nodeId, "rust-wasm-leaf", name,
        `Vantage:intel:${sig.source}`,
        clamp(sig.conviction / 6),
        clamp((sig.score || sig.conviction) / 8),
        `Intel: ${sig.type} · ${sig.source} · ${sig.volume_24h ? `$${(sig.volume_24h / 1e3).toFixed(0)}K vol` : ""}`,
        "active"
      );
      this.ensureEdge(this.vantageCenterId, nodeId, clamp(sig.conviction / 6));
    }
  }

  private async pollDegenCalls(): Promise<void> {
    const data = await this.fetchJson("/api/intel/degen/early-calls");
    if (!data?.early_calls) return;
    for (const call of (data.early_calls as DegenCall[]).slice(0, 8)) {
      const nodeId = makeNodeId("degen", call.symbol);
      this.addNode(
        nodeId, "rust-wasm-leaf", `🔥 ${call.symbol}`,
        "Vantage:degen",
        clamp(Math.min(1, call.alpha_score / 300000)),
        clamp(Math.min(1, call.buys_1h / 4000)),
        `Degen: α=${(call.alpha_score / 1000).toFixed(0)}K · ${call.buys_1h} buys/1h · ${call.age_hours.toFixed(1)}h old`,
        "active"
      );
      this.ensureEdge(this.vantageCenterId, nodeId, clamp(call.alpha_score / 300000));
    }
  }

  private async pollMarketTop(): Promise<void> {
    const data = await this.fetchJson("/api/intel/market/top");
    if (!data?.tokens) return;
    for (const tok of (data.tokens as any[]).slice(0, 5)) {
      if (tok.symbol === "USDT" || tok.symbol === "USDC" || tok.symbol === "DAI") continue;
      const nodeId = makeNodeId("market", tok.symbol);
      const pct = tok.price_change_pct_24h || 0;
      this.addNode(
        nodeId, "typescript-surface", tok.symbol,
        "Vantage:market",
        0.5,
        clamp(Math.abs(pct) / 10 + 0.2),
        `$${tok.price?.toLocaleString()} · ${pct >= 0 ? "+" : ""}${pct?.toFixed(2)}% · MC $${(tok.market_cap / 1e9).toFixed(1)}B`,
        "active"
      );
      this.ensureEdge(this.vantageCenterId, nodeId, 0.3);
    }
  }

  private async pollSentiment(): Promise<void> {
    const data = await this.fetchJson("/api/intel/sentiment");
    if (!data?.sentiment) return;
    const s = data.sentiment;
    const nodeId = makeNodeId("sentiment", "market");
    this.addNode(
      nodeId, "typescript-surface", `Sentiment: ${s.overall || "neutral"}`,
      "Vantage:sentiment",
      clamp((s.fear_greed || 50) / 100),
      clamp((s.fear_greed || 50) / 100),
      `F&G: ${s.fear_greed || "?"} · ${s.gainers_pct || 0}% green · BTC dom ${s.btc_dominance?.toFixed(1) || "?"}%`,
      s.overall === "bearish" ? "degraded" : "active"
    );
    this.ensureEdge(this.vantageCenterId, nodeId, 0.5);
  }

  private trimNodes(): void {
    if (this.nodes.size <= MAX_NODES) return;
    const sorted = [...this.nodes.entries()]
      .filter(([id]) => id !== this.vantageCenterId)
      .sort(([, a], [, b]) => a.activity - b.activity);
    const toRemove = sorted.slice(0, this.nodes.size - MAX_NODES);
    for (const [id] of toRemove) {
      const node = this.nodes.get(id)!;
      this.nodes.delete(id);
      for (const [eid, edge] of this.edges) {
        if (edge.sourceId === id || edge.targetId === id) this.edges.delete(eid);
      }
      this.emitEvent({
        kind: "node_died",
        nodeId: id,
        label: node.label,
        receipt: `vt:trim:${id}:${Date.now().toString(36)}`,
      });
    }
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
