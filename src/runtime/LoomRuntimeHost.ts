import type { AgentCapability, AgentInstance, AgentNode, AgentRuntimeProvider } from "../engine/types";

/**
 * LOOM's actual HTTP surface (`fast_server.py`, `/opt/ares/Loom` on the VPS —
 * real production whale-tracking / market-intel, not a demo). No OpenAPI, so
 * the manifest below is hand-transcribed from the handler's `do_GET` branch.
 */
const LOOM_ENDPOINTS: { tool: string; path: string; description: string }[] = [
  { tool: "health", path: "/api/health", description: "Uptime + liveness of the LOOM engine." },
  { tool: "state", path: "/api/state", description: "Cached event stream state: recent events, anomalies, event_count." },
  { tool: "whales_leaderboard", path: "/api/whales/leaderboard", description: "Ranked whale wallets by tracked activity." },
  { tool: "decide", path: "/api/decide", description: "Current consensus decision (direction/conviction) from the debate engine." },
  { tool: "brief", path: "/api/brief", description: "Latest narrative brief synthesized from tracked signals." },
  { tool: "whales_galaxy", path: "/api/whales/galaxy", description: "Whale relationship graph (nodes/edges) for visualization." },
];

/**
 * Runtime for the "Python Fabric" node type — the one already named in
 * `registerDefaults.ts`'s description ("e.g. LOOM analytical engines"). LOOM
 * is a real, already-running singleton service, not something this dashboard
 * can boot or kill, so this mirrors OmokodaGraphEngine's kernel handling
 * (dedup to one instance, `terminate` is a no-op) rather than
 * WasmAgentHost's per-click-spawns-a-new-sandboxed-process model.
 */
export class LoomRuntimeHost implements AgentRuntimeProvider {
  readonly typeIds = ["python-fabric"];

  constructor(private apiBase: string) {}

  async spawn(_node: AgentNode): Promise<AgentInstance> {
    const apiBase = this.apiBase;
    let alive = true;

    const capabilities: AgentCapability[] = LOOM_ENDPOINTS.map((e) => ({
      name: e.tool,
      description: e.description,
    }));

    const endpointFor = (tool: string) => LOOM_ENDPOINTS.find((e) => e.tool === tool);

    return {
      capabilities,
      async invokeTool(tool: string, _arg: string): Promise<string> {
        if (!alive) throw new Error("instance terminated");
        const endpoint = endpointFor(tool);
        if (!endpoint) {
          throw new Error(`LOOM has no "${tool}" endpoint — known: ${LOOM_ENDPOINTS.map((e) => e.tool).join(", ")}`);
        }
        const res = await fetch(`${apiBase}${endpoint.path}`);
        const text = await res.text();
        if (!res.ok) throw new Error(`LOOM ${endpoint.path} → ${res.status}: ${text}`);
        return text;
      },
      async sendMessage(_text: string): Promise<string> {
        if (!alive) throw new Error("instance terminated");
        // LOOM has no chat/reasoning surface (it's a market-data fabric, not
        // an LLM agent) — the honest reply is her live narrative brief, the
        // closest thing she has to "reflecting" on anything.
        const res = await fetch(`${apiBase}/api/brief`);
        const brief = await res.json().catch(() => ({}));
        return JSON.stringify(brief ?? {});
      },
      terminate(): void {
        // A production market-intel service — the dashboard observes it,
        // it does not own its lifecycle. Detach only.
        alive = false;
      },
    };
  }
}
