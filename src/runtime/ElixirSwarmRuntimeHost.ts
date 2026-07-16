import type { AgentCapability, AgentInstance, AgentNode, AgentRuntimeProvider } from "../engine/types";

/**
 * The real Elixir supervision tree (`omokoda-swarm`, :4000 on the VPS) — a
 * pure-OTP application (no Hex deps by design) supervising the coordinator,
 * hive, mesh presence/neighbor discovery, and the hive-scale REM cycle
 * GenServer (which calls the Julia service's /dream/rem — see
 * JuliaMemoryRuntimeHost and specs/dream-rem.md). It had zero HTTP surface
 * until `lib/omokoda_swarm/http_api.ex` was added: a dependency-free
 * `:gen_tcp` server exposing a handful of real routes, matching the CORS
 * behavior of the other three language runtimes.
 */
const ELIXIR_ENDPOINTS: { tool: string; path: string; method: "GET" | "POST"; description: string }[] = [
  { tool: "health", path: "/health", method: "GET", description: "Liveness of the swarm supervision tree." },
  { tool: "status", path: "/status", method: "GET", description: "Coordinator.get_status/0 — real agent count, states, tasks." },
  { tool: "rem_last_plan", path: "/rem/last_plan", method: "GET", description: "Most recent Sabbath REM compression plan (Julia-computed, Elixir-held)." },
  { tool: "rem_run_now", path: "/rem/run_now", method: "POST", description: "Force a REM cycle now, regardless of weekday (testing/ops)." },
];

export class ElixirSwarmRuntimeHost implements AgentRuntimeProvider {
  readonly typeIds = ["elixir-core"];

  constructor(private apiBase: string) {}

  async spawn(_node: AgentNode): Promise<AgentInstance> {
    const apiBase = this.apiBase;
    let alive = true;

    const capabilities: AgentCapability[] = ELIXIR_ENDPOINTS.map((e) => ({
      name: e.tool,
      description: e.description,
    }));

    const endpointFor = (tool: string) => ELIXIR_ENDPOINTS.find((e) => e.tool === tool);

    return {
      capabilities,
      async invokeTool(tool: string, _arg: string): Promise<string> {
        if (!alive) throw new Error("instance terminated");
        const endpoint = endpointFor(tool);
        if (!endpoint) {
          throw new Error(`Elixir swarm has no "${tool}" endpoint — known: ${ELIXIR_ENDPOINTS.map((e) => e.tool).join(", ")}`);
        }
        const res = await fetch(`${apiBase}${endpoint.path}`, { method: endpoint.method });
        const text = await res.text();
        if (!res.ok) throw new Error(`Elixir ${endpoint.path} → ${res.status}: ${text}`);
        return text;
      },
      async sendMessage(_text: string): Promise<string> {
        if (!alive) throw new Error("instance terminated");
        // No chat surface — a supervision tree, not an LLM agent. The honest
        // reply is the coordinator's real live status.
        const res = await fetch(`${apiBase}/status`);
        return res.text();
      },
      terminate(): void {
        // A live supervision tree with its own agents underneath it —
        // detach only, never kill from the dashboard.
        alive = false;
      },
    };
  }
}
