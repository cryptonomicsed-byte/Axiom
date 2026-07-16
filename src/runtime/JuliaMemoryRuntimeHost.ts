import type { AgentCapability, AgentInstance, AgentNode, AgentRuntimeProvider } from "../engine/types";

/**
 * The real Julia memory/compute service (`omokoda-memory/server.jl`, :7778 on
 * the VPS) — Busy Beaver step verification, NIST SP 800-22 entropy testing,
 * Augury time-series prediction, DePIN resource optimization, receipt-log
 * analytics, mesh trust/resonance scoring, and REM fractal compression
 * planning (see `specs/dream-rem.md`). Real endpoints, not a demo — the same
 * ones `omokoda-core`'s Rust side and Elixir's `omokoda-swarm` call for
 * hive-scale planning.
 *
 * Each tool takes a JSON arg matching the endpoint's real request body (see
 * server.jl's docstring); `invokeTool` passes it straight through as the
 * POST body (or ignores it for the two GET endpoints).
 */
const JULIA_ENDPOINTS: { tool: string; path: string; method: "GET" | "POST"; description: string }[] = [
  { tool: "health", path: "/health", method: "GET", description: "Liveness + in-memory DAG size." },
  { tool: "capabilities", path: "/capabilities", method: "GET", description: "List of available operation groups." },
  { tool: "bb_verify", path: "/bb_verify", method: "POST", description: "Busy Beaver step-count verification. {states, steps}" },
  { tool: "bb_simulate", path: "/bb_simulate", method: "POST", description: "Run a Turing machine and return its trace. {states, max_steps}" },
  { tool: "nist_test", path: "/nist/test", method: "POST", description: "Single NIST SP 800-22 test. {test, data}" },
  { tool: "nist_validate", path: "/nist/validate", method: "POST", description: "Full entropy battery (7 implemented, 8 stubbed). {data}" },
  { tool: "predict", path: "/predict", method: "POST", description: "Augury time-series forecast. {series, horizon, method}" },
  { tool: "dag_summary", path: "/augury/dag/summary", method: "GET", description: "Structure summary of the in-memory Augury DAG." },
  { tool: "optimize", path: "/optimize", method: "POST", description: "DePIN resource allocation. {nodes, tasks, strategy}" },
  { tool: "garden_analyse", path: "/garden/analyse", method: "POST", description: "Receipt log analytics. {receipts}" },
  { tool: "mesh_score", path: "/mesh/score", method: "POST", description: "Julia trust score computation. {agent_id, neighbor_id, signals}" },
  { tool: "mesh_resonance", path: "/mesh/resonance", method: "POST", description: "IfáScript ResonancePacket → resonance score. {odu_id, tier, intent}" },
  { tool: "dream_rem", path: "/dream/rem", method: "POST", description: "REM fractal compression plan — the weekly dream state, hive scale. {nodes}" },
];

export class JuliaMemoryRuntimeHost implements AgentRuntimeProvider {
  readonly typeIds = ["julia-compute"];

  constructor(private apiBase: string) {}

  async spawn(_node: AgentNode): Promise<AgentInstance> {
    const apiBase = this.apiBase;
    let alive = true;

    const capabilities: AgentCapability[] = JULIA_ENDPOINTS.map((e) => ({
      name: e.tool,
      description: e.description,
    }));

    const endpointFor = (tool: string) => JULIA_ENDPOINTS.find((e) => e.tool === tool);

    return {
      capabilities,
      async invokeTool(tool: string, arg = "{}"): Promise<string> {
        if (!alive) throw new Error("instance terminated");
        const endpoint = endpointFor(tool);
        if (!endpoint) {
          throw new Error(`Julia memory service has no "${tool}" endpoint — known: ${JULIA_ENDPOINTS.map((e) => e.tool).join(", ")}`);
        }
        const res = await fetch(`${apiBase}${endpoint.path}`, {
          method: endpoint.method,
          headers: endpoint.method === "POST" ? { "Content-Type": "application/json" } : undefined,
          body: endpoint.method === "POST" ? (arg && arg.length > 0 ? arg : "{}") : undefined,
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`Julia ${endpoint.path} → ${res.status}: ${text}`);
        return text;
      },
      async sendMessage(_text: string): Promise<string> {
        if (!alive) throw new Error("instance terminated");
        // No chat surface — she's a compute/statistics service, not an LLM
        // agent. The honest reply is her own capability list.
        const res = await fetch(`${apiBase}/capabilities`);
        return res.text();
      },
      terminate(): void {
        // A live shared compute service other things depend on (Rust kernel
        // dream cycles, Elixir swarm REM planning) — detach only.
        alive = false;
      },
    };
  }
}
