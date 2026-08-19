import type {
  AgentCapability,
  AgentEdge,
  AgentNode,
  AgentRuntimeProvider,
  GraphEngine,
  GraphEvent,
  GraphEventListener,
  GraphListener,
  NodeStatus,
  NodeTypeDefinition,
} from "./types";

/**
 * Live, read-only GraphEngine backed by the Vantage block mesh.
 *
 * Where MockGraphEngine *simulates* a swarm, this one *mirrors the real one*:
 * every node is an ọmọ Kọ́dà sovereign agent that registered itself on Vantage
 * at birth (POST /api/mesh/agents/join — see Ọmọ Kọ́dà's mesh_tools.rs), and
 * every edge is a birth-lineage link (parent_id → child). The galaxy becomes a
 * window onto the actual population: births appear as agents join their block,
 * trust and recency drive brightness, and governance proposals pulse along the
 * graph.
 *
 * Transport is deliberately dumb and robust: it POLLs two REST endpoints that
 * only need a valid agent key (no block membership required) —
 *   GET /api/mesh/blocks/{block}/agents   → the roster (nodes)
 *   GET /api/mesh/blocks/{block}/events   → recent mesh events (pulses)
 * and, when it can, opens the /ws/gossip WebSocket purely as a low-latency
 * "something changed, poll now" nudge so a birth shows within milliseconds
 * instead of at the next poll. If the socket can't authorize (the viewer key
 * isn't a member of the block) polling alone still keeps the view live.
 *
 * It is READ-ONLY: births happen inside the Ọmọ Kọ́dà runtime, not from a
 * browser, so spawn/connect/terminate are no-ops that surface a clear notice
 * rather than mutating the real mesh.
 */

export interface VantageEngineOptions {
  /** Base URL of the Vantage backend, e.g. "https://vantage.example". */
  baseUrl: string;
  /** Agent key (X-Agent-Key) used to read the mesh. A read-only viewer key. */
  apiKey?: string;
  /** Block to mirror. Defaults to "default" (Ọmọ Kọ́dà's home block). */
  blockId?: string;
  /** Poll cadence in ms. Defaults to 2500. */
  pollMs?: number;
}

/** The node type every mesh agent maps to unless a richer one is registered. */
export const OMO_KODA_SOVEREIGN_TYPE: NodeTypeDefinition = {
  id: "omo-koda-sovereign",
  label: "Ọmọ Kọ́dà Sovereign",
  description:
    "A sovereign agent born in the Ọmọ Kọ́dà runtime, carrying a verifiable " +
    "Ed25519 identity, a DNA fingerprint, and an Ifá Odù. Self-registered on " +
    "the Vantage mesh at birth.",
  color: 0xf5c451, // amber/gold — Ifá / Odù
  accentColor: 0xffe9a8,
  scale: 1.0,
  geometry: "geodesic",
  birthEffect: "burst",
};

/** How the raw mesh_agents row arrives from Vantage. Fields are best-effort. */
interface MeshAgentRow {
  agent_id: string;
  block_id?: string;
  vantage_name?: string;
  role?: string;
  status?: string;
  trust_score?: number;
  public_key?: string;
  dna_fingerprint?: string;
  odu_index?: number | null;
  parent_id?: string;
  identity_verified?: number | boolean;
  last_seen_at?: string;
  commitments_made?: number;
  capabilities?: Record<string, unknown>;
}

interface MeshEventRow {
  block_id?: string;
  event_type?: string;
  agent_id?: string;
  payload?: Record<string, unknown>;
  created_at?: string;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function toMillis(iso?: string): number {
  if (!iso) return Date.now();
  // Vantage stores UTC timestamps via SQLite datetime('now'); normalize to ISO.
  const t = Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  return Number.isFinite(t) ? t : Date.now();
}

/** Recency → 0..1 activity: full for the last minute, fading over ~15 minutes. */
function recencyActivity(lastSeenMs: number): number {
  const ageSec = (Date.now() - lastSeenMs) / 1000;
  if (ageSec <= 60) return 1;
  return clamp(1 - (ageSec - 60) / (15 * 60));
}

function normalizeTrust(raw: number | undefined): number {
  if (raw == null || Number.isNaN(raw)) return 0.5;
  if (raw > 1) return clamp(raw / 100); // tolerate a 0..100 scale
  return clamp(raw);
}

export class VantageGraphEngine implements GraphEngine {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly blockId: string;
  private readonly pollMs: number;

  private nodeTypes = new Map<string, NodeTypeDefinition>();
  private nodes = new Map<string, AgentNode>();
  private edges = new Map<string, AgentEdge>();
  private listeners = new Set<GraphListener>();
  private eventListeners = new Set<GraphEventListener>();

  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private ws: WebSocket | null = null;
  private wsRetry: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private stopped = true;
  /** created_at of the newest mesh event we've already turned into a pulse. */
  private lastEventAt = 0;
  /** first time we saw each agent, so createdAt is stable across polls. */
  private firstSeen = new Map<string, number>();
  private warnedAuth = false;

  constructor(opts: VantageEngineOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey ?? "";
    this.blockId = opts.blockId ?? "default";
    this.pollMs = opts.pollMs ?? 2500;
    this.nodeTypes.set(OMO_KODA_SOVEREIGN_TYPE.id, OMO_KODA_SOVEREIGN_TYPE);
  }

  registerNodeType(def: NodeTypeDefinition): void {
    this.nodeTypes.set(def.id, def);
  }

  getNodeTypes(): NodeTypeDefinition[] {
    return [...this.nodeTypes.values()];
  }

  // A live mesh has no browser-side runtime to plug in; accept the call so the
  // wiring in main.ts is identical to the mock, but there's nothing to route.
  registerRuntime(_provider: AgentRuntimeProvider): void {
    /* no-op: the Ọmọ Kọ́dà runtime owns every process on the real mesh. */
  }

  // ── Read-only lifecycle ─────────────────────────────────────────────────
  // The mesh is authoritative. We never mutate it from the viewer; these throw
  // a descriptive error so callers (e.g. the spawn UI) can show a notice.
  spawnNode(): AgentNode {
    throw new Error(
      "AXIOM is mirroring a live Vantage mesh (read-only). Agents are born in " +
        "the Ọmọ Kọ́dà runtime and self-register here — they can't be spawned " +
        "from the browser.",
    );
  }

  terminateNode(): void {
    throw new Error("Read-only live mesh: agents cannot be terminated from AXIOM.");
  }

  connect(): AgentEdge {
    throw new Error("Read-only live mesh: edges reflect real birth lineage, not manual links.");
  }

  async invokeTool(_nodeId: string, tool: string): Promise<string> {
    return `Read-only mesh view — cannot invoke "${tool}" on a live sovereign agent from AXIOM.`;
  }

  async sendMessage(_nodeId: string, _text: string): Promise<string> {
    return "Read-only mesh view — direct messaging isn't wired from the galaxy yet.";
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
    if (!this.stopped) return;
    this.stopped = false;
    void this.poll(); // immediate first paint
    this.pollHandle = setInterval(() => void this.poll(), this.pollMs);
    this.openGossip();
  }

  stop(): void {
    this.stopped = true;
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    if (this.wsRetry) {
      clearTimeout(this.wsRetry);
      this.wsRetry = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  // ── Transport ───────────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    return this.apiKey ? { "X-Agent-Key": this.apiKey } : {};
  }

  private async fetchJson<T>(path: string): Promise<T | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
      if (res.status === 401 || res.status === 403) {
        if (!this.warnedAuth) {
          this.warnedAuth = true;
          console.warn(
            `[VantageGraphEngine] ${res.status} reading ${path} — the viewer key ` +
              `lacks access to block "${this.blockId}". Set a valid VITE_VANTAGE_KEY.`,
          );
        }
        return null;
      }
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch (err) {
      // Network/CORS hiccup — stay quiet and let the next poll retry.
      return null;
    }
  }

  /** One reconciliation pass: pull the roster + new events and diff into state. */
  private async poll(): Promise<void> {
    if (this.polling || this.stopped) return;
    this.polling = true;
    try {
      const [roster, events] = await Promise.all([
        this.fetchJson<MeshAgentRow[]>(
          `/api/mesh/blocks/${encodeURIComponent(this.blockId)}/agents?capabilities=1`,
        ),
        this.fetchJson<MeshEventRow[]>(
          `/api/mesh/blocks/${encodeURIComponent(this.blockId)}/events?limit=50`,
        ),
      ]);
      if (roster) this.reconcileRoster(roster);
      if (events) this.reconcileEvents(events);
    } finally {
      this.polling = false;
    }
  }

  private reconcileRoster(rows: MeshAgentRow[]): void {
    let changed = false;
    const seen = new Set<string>();

    for (const row of rows) {
      if (!row || !row.agent_id) continue;
      seen.add(row.agent_id);
      const next = this.rowToNode(row);
      const prev = this.nodes.get(row.agent_id);
      this.nodes.set(next.id, next);

      if (!prev) {
        this.emitEvent({ kind: "node_spawned", node: next });
        changed = true;
      } else if (this.nodeChanged(prev, next)) {
        this.emitEvent({ kind: "node_updated", node: next });
        changed = true;
      }
    }

    // Agents that dropped out of the active roster are treated as departed.
    for (const id of [...this.nodes.keys()]) {
      if (!seen.has(id)) {
        const gone = this.nodes.get(id)!;
        this.nodes.delete(id);
        this.emitEvent({
          kind: "node_died",
          nodeId: id,
          label: gone.label,
          receipt: "left the block mesh (no longer active)",
        });
        changed = true;
      }
    }

    if (this.rebuildEdges()) changed = true;
    if (changed) this.emit();
  }

  private rowToNode(row: MeshAgentRow): AgentNode {
    const caps = row.capabilities ?? {};
    const humanName = (caps["human_name"] as string) || row.vantage_name || row.agent_id;
    const kind = (caps["kind"] as string) || "omo-koda";
    const odu = row.odu_index ?? (caps["odu_index"] as number | undefined);
    const verified = row.identity_verified === 1 || row.identity_verified === true;
    const lastSeen = toMillis(row.last_seen_at);

    const createdAt = this.firstSeen.get(row.agent_id) ?? Date.now();
    if (!this.firstSeen.has(row.agent_id)) this.firstSeen.set(row.agent_id, createdAt);

    // Record birth lineage (parent_id → this agent) for edge building.
    const parentId = row.parent_id || (caps["parent_id"] as string | undefined);
    if (parentId) this.parentOf.set(row.agent_id, parentId);

    const status: NodeStatus =
      (row.status && row.status !== "active" && "idle") ||
      (recencyActivity(lastSeen) < 0.05 ? "idle" : "active");

    const personality = (caps["personality"] as Record<string, unknown>) || {};
    const orisha = personality["dominant_orisha"] as string | undefined;
    const summary =
      (personality["summary"] as string | undefined) ||
      `${verified ? "verified" : "unverified"} sovereign${orisha ? ` · ${orisha}` : ""}`;

    const capabilities: AgentCapability[] = [];
    if (odu != null) {
      capabilities.push({ name: `Odù #${odu}`, description: "Primary Ifá Odù of this identity." });
    }
    if (orisha) {
      capabilities.push({ name: orisha, description: "Dominant Òrìṣà resonance." });
    }
    capabilities.push({
      name: verified ? "identity ✓ verified" : "identity unverified",
      description: verified
        ? "Ed25519 signature over agent_id verified by the mesh."
        : "Signature not yet verified by the mesh.",
    });
    if (row.dna_fingerprint) {
      capabilities.push({
        name: "DNA",
        description: `Constitutional DNA fingerprint ${String(row.dna_fingerprint).slice(0, 16)}…`,
      });
    }
    if (row.role) {
      capabilities.push({ name: `role: ${row.role}`, description: "Declared block role." });
    }

    const typeId = this.nodeTypes.has(`omo-koda-${row.role}`)
      ? `omo-koda-${row.role}`
      : OMO_KODA_SOVEREIGN_TYPE.id;

    return {
      id: row.agent_id,
      typeId,
      label: humanName,
      framework: kind,
      status,
      capabilities,
      reputation: normalizeTrust(row.trust_score),
      activity: recencyActivity(lastSeen),
      memorySummary: `${kind} · ${summary}${odu != null ? ` · Odù #${odu}` : ""}`,
      memoryEvents: [{ at: lastSeen, text: `last seen · ${row.commitments_made ?? 0} commitments` }],
      createdAt,
    };
  }

  /** Only fields that matter visually — avoids emitting on trust noise alone. */
  private nodeChanged(a: AgentNode, b: AgentNode): boolean {
    return (
      a.status !== b.status ||
      Math.abs(a.activity - b.activity) > 0.05 ||
      Math.abs(a.reputation - b.reputation) > 0.02 ||
      a.label !== b.label ||
      a.capabilities.length !== b.capabilities.length
    );
  }

  /** Edges are birth lineage: parent_id → child, when both are on the roster. */
  private rebuildEdges(): boolean {
    const wanted = new Map<string, AgentEdge>();
    for (const node of this.nodes.values()) {
      const parent = this.parentOf.get(node.id);
      if (parent && this.nodes.has(parent)) {
        const id = `lineage-${parent}->${node.id}`;
        wanted.set(id, {
          id,
          sourceId: parent,
          targetId: node.id,
          activity: node.activity,
        });
      }
    }
    // Diff against current edge set.
    let changed = false;
    for (const id of [...this.edges.keys()]) {
      if (!wanted.has(id)) {
        this.edges.delete(id);
        changed = true;
      }
    }
    for (const [id, edge] of wanted) {
      const prev = this.edges.get(id);
      if (!prev || Math.abs(prev.activity - edge.activity) > 0.05) {
        this.edges.set(id, edge);
        changed = true;
      }
    }
    return changed;
  }

  /** parent_id captured per-agent during rowToNode, keyed by child id. */
  private parentOf = new Map<string, string>();

  private reconcileEvents(rows: MeshEventRow[]): void {
    // rows arrive newest-first; process oldest-first so pulses fire in order.
    const fresh = rows
      .filter((r) => toMillis(r.created_at) > this.lastEventAt)
      .sort((a, b) => toMillis(a.created_at) - toMillis(b.created_at));

    for (const ev of fresh) {
      this.lastEventAt = Math.max(this.lastEventAt, toMillis(ev.created_at));
      const type = ev.event_type;
      if (type === "proposal_created") {
        const proposer = ev.agent_id;
        const respondent = (ev.payload?.["respondent_id"] as string) || "";
        if (proposer && respondent && this.nodes.has(proposer) && this.nodes.has(respondent)) {
          this.emitEvent({
            kind: "message_pulse",
            edgeId: `proposal-${proposer}->${respondent}`,
            sourceId: proposer,
            targetId: respondent,
          });
        }
      } else if (ev.agent_id && this.nodes.has(ev.agent_id) && type) {
        // Surface other mesh activity (signals, reservations, heartbeats…) as a
        // tool-style event so the HUD feed shows the swarm is alive.
        this.emitEvent({
          kind: "tool_invoked",
          nodeId: ev.agent_id,
          tool: type,
          result: JSON.stringify(ev.payload ?? {}).slice(0, 120),
        });
      }
    }
  }

  // ── Gossip WebSocket (best-effort real-time nudge) ──────────────────────

  private openGossip(): void {
    if (this.stopped || this.ws) return;
    let wsUrl: string;
    try {
      const u = new URL(this.baseUrl);
      u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
      u.pathname = "/ws/gossip";
      u.searchParams.set("channel", `block.${this.blockId}`);
      if (this.apiKey) u.searchParams.set("key", this.apiKey);
      wsUrl = u.toString();
    } catch {
      return; // baseUrl not absolute; polling still covers us.
    }

    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.onmessage = (msg) => {
        // We don't trust the socket to be authorized or complete; any real
        // event just means "poll now" so births/proposals show immediately.
        try {
          const data = JSON.parse(msg.data as string);
          if (data && data.type && data.type !== "ping") void this.poll();
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        this.ws = null;
        this.scheduleGossipRetry();
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
    } catch {
      this.scheduleGossipRetry();
    }
  }

  private scheduleGossipRetry(): void {
    if (this.stopped || this.wsRetry) return;
    // Gentle backoff; polling is the real safety net so this can be lazy.
    this.wsRetry = setTimeout(() => {
      this.wsRetry = null;
      this.openGossip();
    }, 15000);
  }

  private emit(): void {
    const nodes = this.getNodes();
    const edges = this.getEdges();
    for (const l of this.listeners) l(nodes, edges);
  }

  private emitEvent(event: GraphEvent): void {
    for (const l of this.eventListeners) l(event);
  }
}
