import type { AgentCapability, AgentInstance, AgentNode, AgentRuntimeProvider } from "../engine/types";

/**
 * The real ỌYA flow-rhythm service (`omokoda-go/cmd/oya`, HTTP :8100 on the
 * VPS — TCP flow.Serve on :50052 is separate and not exposed here) —
 * per-agent Sabbath gating + primitive cooldowns (think=1s, act=2s) backing
 * distributed rhythm enforcement. Backs the "go-flow" node type (there was
 * no default Go entry in registerDefaults.ts — added one, since none of the
 * existing six fit a rhythm/rate-limit service). Had two real bugs before
 * this: go.mod's module path didn't match its own internal imports (wouldn't
 * build at all), and a ratelimit.Allow signature mismatch. Both fixed;
 * verified live against the actual running binary (record → cooldown state
 * genuinely flips true).
 */
const GO_ENDPOINTS: {
  tool: string;
  path: (arg: Record<string, unknown>) => string;
  method: "GET" | "POST";
  description: string;
}[] = [
  { tool: "health", path: () => "/health", method: "GET", description: "Liveness of the ỌYA flow service." },
  {
    tool: "cooldown",
    path: (arg) => `/cooldown/${encodeURIComponent(String(arg.agent_id ?? ""))}`,
    method: "GET",
    description: "Whether an agent is currently in cooldown. {agent_id}",
  },
  {
    tool: "record",
    path: () => "/record",
    method: "POST",
    description: "Record a primitive use, starting its cooldown. {agent_id, primitive: \"think\"|\"act\"}",
  },
];

export class GoFlowRuntimeHost implements AgentRuntimeProvider {
  readonly typeIds = ["go-flow"];

  constructor(private apiBase: string) {}

  async spawn(_node: AgentNode): Promise<AgentInstance> {
    const apiBase = this.apiBase;
    let alive = true;

    const capabilities: AgentCapability[] = GO_ENDPOINTS.map((e) => ({
      name: e.tool,
      description: e.description,
    }));

    const endpointFor = (tool: string) => GO_ENDPOINTS.find((e) => e.tool === tool);

    return {
      capabilities,
      async invokeTool(tool: string, arg = "{}"): Promise<string> {
        if (!alive) throw new Error("instance terminated");
        const endpoint = endpointFor(tool);
        if (!endpoint) {
          throw new Error(`ỌYA flow service has no "${tool}" endpoint — known: ${GO_ENDPOINTS.map((e) => e.tool).join(", ")}`);
        }
        let parsed: Record<string, unknown> = {};
        try {
          parsed = arg ? JSON.parse(arg) : {};
        } catch {
          // leave empty — path builders fall back to "" for missing fields
        }
        const res = await fetch(`${apiBase}${endpoint.path(parsed)}`, {
          method: endpoint.method,
          headers: endpoint.method === "POST" ? { "Content-Type": "application/json" } : undefined,
          body: endpoint.method === "POST" ? (arg && arg.length > 0 ? arg : "{}") : undefined,
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`ỌYA ${endpoint.path(parsed)} → ${res.status}: ${text}`);
        return text;
      },
      async sendMessage(_text: string): Promise<string> {
        if (!alive) throw new Error("instance terminated");
        // No chat surface — a rhythm/rate-limit enforcer, not an LLM agent.
        const res = await fetch(`${apiBase}/health`);
        return res.text();
      },
      terminate(): void {
        // A live rhythm-enforcement service other agents' think/act calls
        // depend on — detach only.
        alive = false;
      },
    };
  }
}
