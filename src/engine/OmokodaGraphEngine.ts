import type {
  AgentCapability,
  AgentEdge,
  AgentInstance,
  AgentNode,
  AgentRuntimeProvider,
  GraphEngine,
  GraphEvent,
  GraphEventListener,
  GraphListener,
  MemoryEvent,
  NodeStatus,
  NodeTypeDefinition,
} from "./types";

/**
 * Real GraphEngine backed by the omokoda-core sovereign kernel's HTTP/SSE API
 * (`/v1/*`). The kernel node is not simulated: status polling and the SSE
 * event stream drive its real activity/reputation/tier, `invokeTool` calls
 * POST /v1/act against the real tool registry (every registered skill,
 * including SkillForge), and `sendMessage` calls POST /v1/think against her
 * real BYOK-backed reasoning.
 *
 * Other node types (e.g. the real Wasm leaf/oracle species) remain genuinely
 * spawnable and instance-backed exactly as in the reference MockGraphEngine —
 * this engine only replaces the simulated *kernel* node with the real one.
 *
 * This is the AgentOS surface: a user can sit at this dashboard and actually
 * operate their agent (run tools, message her, watch her think) without
 * touching Vantage or a terminal.
 */

export const OMOKODA_NODE_TYPE_ID = "omokoda-sovereign";
export const OMOKODA_NODE_ID = "omokoda-sovereign-singleton";

const MEMORY_WINDOW = 10;
const STATUS_POLL_MS = 4000;
const MEMORY_POLL_MS = 15000;

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter.toString(36)}`;
}

export interface OmokodaGraphEngineOptions {
  /** Base URL of the omokoda-core HTTP server, e.g. "http://host:7777". */
  apiBase: string;
}

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function truncate(v: string, max: number): string {
  return v.length > max ? `${v.slice(0, max)}…` : v;
}

/** Reputation/synapse are unbounded-ish real numbers; map into 0..1 for the
 * visual encoding the scene expects, without pretending they ARE bounded. */
function reputationToUnit(reputation: number | null): number {
  if (reputation === null) return 0.3;
  return clamp(0.5 + reputation / (Math.abs(reputation) + 2));
}

function synapseToActivity(synapse: number | null, priorActivity: number): number {
  if (synapse === null) return priorActivity;
  return clamp(Math.max(priorActivity * 0.97, synapse > 0 ? 0.35 : 0.2));
}

export class OmokodaGraphEngine implements GraphEngine {
  private apiBase: string;
  private nodeTypes = new Map<string, NodeTypeDefinition>();
  private nodes = new Map<string, AgentNode>();
  private edges = new Map<string, AgentEdge>();
  private listeners = new Set<GraphListener>();
  private eventListeners = new Set<GraphEventListener>();
  private runtimes = new Map<string, AgentRuntimeProvider>();
  private instances = new Map<string, AgentInstance>();
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private memoryTimer: ReturnType<typeof setInterval> | null = null;
  private eventSource: EventSource | null = null;
  private running = false;
  private capabilitiesDiscovered = false;

  constructor(opts: OmokodaGraphEngineOptions) {
    this.apiBase = opts.apiBase.replace(/\/$/, "");
  }

  // --- node type registry -------------------------------------------------

  registerNodeType(def: NodeTypeDefinition): void {
    this.nodeTypes.set(def.id, def);
  }

  getNodeTypes(): NodeTypeDefinition[] {
    return [...this.nodeTypes.values()];
  }

  registerRuntime(provider: AgentRuntimeProvider): void {
    for (const typeId of provider.typeIds) {
      this.runtimes.set(typeId, provider);
    }
  }

  // --- lifecycle ------------------------------------------------------------

  spawnNode(input: {
    typeId: string;
    label: string;
    framework: string;
    capabilities?: AgentCapability[];
    reputation?: number;
  }): AgentNode {
    if (input.typeId === OMOKODA_NODE_TYPE_ID) {
      return this.spawnOrGetKernel(input.label);
    }
    return this.spawnRuntimeNode(input);
  }

  /** Birth the sovereign agent if she doesn't exist yet; otherwise return the
   * existing singleton (this kernel holds exactly one agent). */
  private spawnOrGetKernel(label: string): AgentNode {
    const existing = this.nodes.get(OMOKODA_NODE_ID);
    if (existing) return existing;

    const provisional: AgentNode = {
      id: OMOKODA_NODE_ID,
      typeId: OMOKODA_NODE_TYPE_ID,
      label: label || "Ọmọ Kọ́dà",
      framework: "omokoda-core (Rust sovereign kernel)",
      status: "spawning",
      capabilities: [],
      reputation: 0.3,
      activity: 0.5,
      memorySummary: "birthing…",
      memoryEvents: [{ at: Date.now(), text: "birth requested" }],
      createdAt: Date.now(),
    };
    this.nodes.set(provisional.id, provisional);
    this.emitEvent({ kind: "node_spawned", node: provisional });
    this.emit();

    fetch(`${this.apiBase}/v1/birth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: label || "Ọmọ Kọ́dà", meta: [] }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`birth failed: ${r.status}`))))
      .then(() => this.refreshStatus())
      .catch((err) => {
        this.patchNode(provisional.id, {
          status: "degraded",
          memorySummary: `birth failed: ${String(err)}`,
        });
      });

    return provisional;
  }

  /** Real Wasm-backed species (leaf/oracle): same lifecycle contract as the
   * reference MockGraphEngine — a runtime claims the type id and turns the
   * spawn request into a genuinely sandboxed process. */
  private spawnRuntimeNode(input: {
    typeId: string;
    label: string;
    framework: string;
    capabilities?: AgentCapability[];
    reputation?: number;
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
      reputation: clamp(input.reputation ?? 0.4),
      activity: 0.6,
      memorySummary: "booting sandboxed process…",
      memoryEvents: [{ at: Date.now(), text: "agent born; namespace allocated" }],
      createdAt: Date.now(),
    };
    this.nodes.set(node.id, node);
    this.emitEvent({ kind: "node_spawned", node });
    this.emit();

    const runtime = this.runtimes.get(input.typeId);
    if (!runtime) {
      this.patchNode(node.id, { status: "degraded", memorySummary: "no runtime registered for this type" });
      return node;
    }
    runtime
      .spawn(node)
      .then((instance) => {
        if (!this.nodes.has(node.id)) {
          instance.terminate();
          return;
        }
        this.instances.set(node.id, instance);
        this.patchNode(node.id, {
          status: "active",
          capabilities: instance.capabilities,
          memorySummary: "live process; manifest discovered",
        });
      })
      .catch((error) => {
        this.patchNode(node.id, { status: "degraded" });
        this.touchNode(node.id, `boot failed: ${String(error)}`, 0);
      });

    return node;
  }

  /** The sovereign kernel isn't disposable from the dashboard; real Wasm
   * instances can be terminated normally. */
  terminateNode(nodeId: string): void {
    if (nodeId === OMOKODA_NODE_ID) {
      // eslint-disable-next-line no-console
      console.warn("OmokodaGraphEngine: the sovereign kernel node cannot be terminated from here.");
      return;
    }
    const node = this.nodes.get(nodeId);
    if (!node) return;
    const instance = this.instances.get(nodeId);
    if (instance) {
      instance.terminate();
      this.instances.delete(nodeId);
    }
    this.nodes.delete(nodeId);
    for (const [edgeId, edge] of this.edges) {
      if (edge.sourceId === nodeId || edge.targetId === nodeId) this.edges.delete(edgeId);
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
    const id = `edge-${sourceId}-${targetId}-${Date.now().toString(36)}`;
    const edge: AgentEdge = { id, sourceId, targetId, activity: 1 };
    this.edges.set(id, edge);
    this.emit();
    return edge;
  }

  // --- tool/message calls: real HTTP for the kernel, real Wasm for runtimes -

  async invokeTool(nodeId: string, tool: string, arg = "{}"): Promise<string> {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    if (nodeId === OMOKODA_NODE_ID) {
      const res = await fetch(`${this.apiBase}/v1/act`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, params: arg && arg.length > 0 ? arg : "{}", sandbox: false }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = body?.error ? String(body.error) : `act failed: ${res.status}`;
        this.touchNode(nodeId, `tool "${tool}" failed → ${truncate(errMsg, 80)}`, 0.1);
        throw new Error(errMsg);
      }
      const result: string = body?.tool_output ?? "(no output)";
      this.touchNode(nodeId, `tool "${tool}" invoked → ${truncate(result, 80)}`, 0.4);
      this.emitEvent({ kind: "tool_invoked", nodeId, tool, result });
      return result;
    }

    const instance = this.instances.get(nodeId);
    const result = instance ? await instance.invokeTool(tool, arg) : "(no runtime attached)";
    this.touchNode(nodeId, `tool "${tool}" invoked → ${truncate(result, 64)}`, 0.35);
    this.emitEvent({ kind: "tool_invoked", nodeId, tool, result });
    return result;
  }

  async sendMessage(nodeId: string, text: string): Promise<string> {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);

    if (nodeId === OMOKODA_NODE_ID) {
      const res = await fetch(`${this.apiBase}/v1/think`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, private: false, agentic: false }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = body?.error ? String(body.error) : `think failed: ${res.status}`;
        this.touchNode(nodeId, `message failed → ${truncate(errMsg, 80)}`, 0.1);
        throw new Error(errMsg);
      }
      const reply: string = body?.tool_output ?? "(no reply)";
      this.touchNode(nodeId, `direct message: "${truncate(text, 48)}"`, 0.3);
      return reply;
    }

    const instance = this.instances.get(nodeId);
    const reply = instance ? await instance.sendMessage(text) : "(no runtime attached)";
    this.touchNode(nodeId, `direct message: "${truncate(text, 48)}"`, 0.25);
    return reply;
  }

  // --- snapshot access ------------------------------------------------------

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

  // --- transport --------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;

    this.refreshStatus();
    this.refreshMemory();
    this.statusTimer = setInterval(() => this.refreshStatus(), STATUS_POLL_MS);
    this.memoryTimer = setInterval(() => this.refreshMemory(), MEMORY_POLL_MS);

    try {
      this.eventSource = new EventSource(`${this.apiBase}/v1/events`);
      this.eventSource.onmessage = (ev) => this.handleServerEvent(ev.data);
      this.eventSource.onerror = () => {
        const kernel = this.nodes.get(OMOKODA_NODE_ID);
        if (kernel && kernel.status === "active") this.patchNode(OMOKODA_NODE_ID, { status: "idle" });
      };
    } catch {
      // SSE unsupported/blocked — status polling still keeps the node live.
    }
  }

  stop(): void {
    this.running = false;
    if (this.statusTimer) clearInterval(this.statusTimer);
    if (this.memoryTimer) clearInterval(this.memoryTimer);
    this.eventSource?.close();
    this.statusTimer = null;
    this.memoryTimer = null;
    this.eventSource = null;
  }

  // --- internals ----------------------------------------------------------

  private async refreshStatus(): Promise<void> {
    try {
      const res = await fetch(`${this.apiBase}/v1/status`);
      const body = await res.json();
      if (!body?.has_agent) return; // not born yet — SpawnPanel is the next step

      const kernel = this.nodes.get(OMOKODA_NODE_ID);
      const priorActivity = kernel?.activity ?? 0.4;
      const status: NodeStatus = "active";
      const reputationUnit = reputationToUnit(body.reputation ?? null);
      const activity = synapseToActivity(body.synapse ?? null, priorActivity);
      const memorySummary = `tier ${body.tier ?? "?"} · synapse ${Math.round(body.synapse ?? 0)}`;

      if (!kernel) {
        const node: AgentNode = {
          id: OMOKODA_NODE_ID,
          typeId: OMOKODA_NODE_TYPE_ID,
          label: body.name ?? "Ọmọ Kọ́dà",
          framework: "omokoda-core (Rust sovereign kernel)",
          status,
          capabilities: [],
          reputation: reputationUnit,
          activity,
          memorySummary,
          memoryEvents: [],
          createdAt: Date.now(),
        };
        this.nodes.set(node.id, node);
        this.emitEvent({ kind: "node_spawned", node });
      } else {
        const updated = { ...kernel, label: body.name ?? kernel.label, status, reputation: reputationUnit, activity, memorySummary };
        this.nodes.set(OMOKODA_NODE_ID, updated);
        this.emitEvent({ kind: "node_updated", node: updated });
      }
      this.emit();

      if (!this.capabilitiesDiscovered) {
        this.capabilitiesDiscovered = true;
        this.discoverCapabilities();
      }
    } catch {
      const kernel = this.nodes.get(OMOKODA_NODE_ID);
      if (kernel) this.patchNode(OMOKODA_NODE_ID, { status: "degraded" });
    }
  }

  /** Ask the live registry what she can actually do (the `skills` tool is the
   * same self-description mechanism the Wasm agents use for their own
   * manifests) and populate real, clickable capability chips from it — never
   * a hardcoded/stale list. Deliberately surfaces the external-skill layer
   * (vantage/gitea/skillforge/…) rather than raw filesystem/exec tools, so
   * one-click browser buttons stay safe by construction. */
  private async discoverCapabilities(): Promise<void> {
    try {
      const res = await fetch(`${this.apiBase}/v1/act`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "skills", params: "{}", sandbox: false }),
      });
      const body = await res.json();
      const raw: string = body?.tool_output ?? "[]";
      const list: Array<{ name: string; description?: string }> = JSON.parse(raw);
      const capabilities: AgentCapability[] = list.map((s) => ({
        name: s.name,
        description: s.description ?? "",
      }));
      if (capabilities.length > 0) this.patchNode(OMOKODA_NODE_ID, { capabilities });
    } catch {
      this.capabilitiesDiscovered = false; // allow a retry on the next status tick
    }
  }

  private async refreshMemory(): Promise<void> {
    if (!this.nodes.has(OMOKODA_NODE_ID)) return;
    try {
      const res = await fetch(`${this.apiBase}/v1/vault/search?q=`);
      const body = await res.json();
      const results: Array<{ title?: string; snippet?: string; path?: string }> = body?.results ?? [];
      const events: MemoryEvent[] = results.slice(0, MEMORY_WINDOW).map((r, i) => ({
        at: Date.now() - i * 1000,
        text: r.title ? `${r.title} — ${truncate(r.snippet ?? "", 60)}` : (r.path ?? "note"),
      }));
      if (events.length > 0) this.patchNode(OMOKODA_NODE_ID, { memoryEvents: events });
    } catch {
      // Vault may be disabled/private; not fatal to the live view.
    }
  }

  private handleServerEvent(raw: string): void {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (!this.nodes.has(OMOKODA_NODE_ID)) return;
    const type = String(payload.type ?? "");

    switch (type) {
      case "act_executed": {
        const tool = String(payload.tool ?? "unknown");
        this.touchNode(OMOKODA_NODE_ID, `act_executed: ${tool}`, 0.35);
        this.emitEvent({ kind: "tool_invoked", nodeId: OMOKODA_NODE_ID, tool, result: `f1=${payload.f1_score ?? "?"}` });
        break;
      }
      case "thought_sealed":
        this.touchNode(OMOKODA_NODE_ID, "thought sealed", 0.25);
        break;
      case "tier_advanced":
        this.touchNode(OMOKODA_NODE_ID, `tier advanced → ${payload.new_tier}`, 0.5);
        this.patchNode(OMOKODA_NODE_ID, { memorySummary: `tier advanced to ${payload.new_tier}` });
        break;
      case "toc_minted":
        this.touchNode(OMOKODA_NODE_ID, `synapse earned: ${payload.synapse_earned ?? "?"}`, 0.3);
        break;
      case "sabbath_entered":
        this.patchNode(OMOKODA_NODE_ID, { status: "idle", memorySummary: "Sabbath — resting/consolidating" });
        break;
      case "denial":
        this.touchNode(OMOKODA_NODE_ID, `denied: ${payload.tool ?? "?"} — ${payload.reason ?? ""}`, 0.15);
        break;
      case "neighbor_discovered":
      case "trust_updated":
      case "proposal_received":
        // Mesh activity — surfaced as a memory touch; a future iteration can
        // promote these into real neighbor nodes/edges on the graph.
        this.touchNode(OMOKODA_NODE_ID, `mesh: ${type}`, 0.2);
        break;
      default:
        break;
    }
  }

  private patchNode(nodeId: string, patch: Partial<AgentNode>): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    const updated = { ...node, ...patch };
    this.nodes.set(nodeId, updated);
    this.emitEvent({ kind: "node_updated", node: updated });
    this.emit();
  }

  private touchNode(nodeId: string, memoryText: string, activityBoost: number): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    const memoryEvent: MemoryEvent = { at: Date.now(), text: memoryText };
    const updated: AgentNode = {
      ...node,
      activity: clamp(node.activity + activityBoost),
      memoryEvents: [memoryEvent, ...node.memoryEvents].slice(0, MEMORY_WINDOW),
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
