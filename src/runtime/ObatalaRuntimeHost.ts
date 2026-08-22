import type { AgentCapability, AgentInstance, AgentNode, AgentRuntimeProvider } from "../engine/types";

/**
 * Ọbàtálá — Wisdom: Symbolic Reasoning & Ethics Engine (FOUNDATION.md #4,
 * "Hermetic evaluation, ethical decisions on user data sharing/privacy,
 * consent logic"). The one power whose job is explicitly symbolic/ethical
 * reasoning, hence Lisp -- here Clojure via Babashka (native-image
 * interpreter, no JVM install needed), `omokoda-clojure/obatala.clj`, :4002
 * on the VPS.
 *
 * A genuine small rule engine, not a stub: consent-mode gating (private/
 * incognito/public), sensitive-category sealing, and two rules that weigh
 * the SAME 7 Hermetic principles (mentalism/correspondence/vibration/
 * polarity/rhythm/cause_effect/gender) omokoda-hermetic already computes
 * per-agent in Rust -- polarity governs borderline private-mode sharing,
 * cause_effect gates financial disclosure. Shares the UTC-Saturday Sabbath
 * convention with RhythmGate (Rust) and the REM cycle (Elixir/Julia).
 */
const OBATALA_TOOLS: { tool: string; path: string; method: "GET" | "POST"; description: string }[] = [
  { tool: "health", path: "/health", method: "GET", description: "Liveness + whether today is Sabbath." },
  { tool: "principles", path: "/principles", method: "GET", description: "The 7 Hermetic principles this engine reasons over, and what each means here." },
  { tool: "rules", path: "/rules", method: "GET", description: "How many ethics rules are loaded and how the engine composes them." },
  {
    tool: "evaluate",
    path: "/evaluate",
    method: "POST",
    description: "Full ethical evaluation. {consent_mode, data_category, requester, hermetic_state?} -> {allowed, violations[]}",
  },
  {
    tool: "consent_check",
    path: "/consent/check",
    method: "POST",
    description: "Quick sharability check without full hermetic weighting. {consent_mode, data_category, requester} -> {sharable, reasons[]}",
  },
];

export class ObatalaRuntimeHost implements AgentRuntimeProvider {
  readonly typeIds = ["obatala-wisdom"];

  constructor(private apiBase: string) {}

  async spawn(_node: AgentNode): Promise<AgentInstance> {
    const apiBase = this.apiBase;
    let alive = true;

    const capabilities: AgentCapability[] = OBATALA_TOOLS.map((t) => ({
      name: t.tool,
      description: t.description,
    }));

    const endpointFor = (tool: string) => OBATALA_TOOLS.find((t) => t.tool === tool);

    return {
      capabilities,
      async invokeTool(tool: string, arg = "{}"): Promise<string> {
        if (!alive) throw new Error("instance terminated");
        const endpoint = endpointFor(tool);
        if (!endpoint) {
          throw new Error(`Policy has no "${tool}" tool — known: ${OBATALA_TOOLS.map((t) => t.tool).join(", ")}`);
        }
        const res = await fetch(`${apiBase}${endpoint.path}`, {
          method: endpoint.method,
          headers: endpoint.method === "POST" ? { "Content-Type": "application/json" } : undefined,
          body: endpoint.method === "POST" ? (arg && arg.length > 0 ? arg : "{}") : undefined,
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`Policy ${endpoint.path} → ${res.status}: ${text}`);
        return text;
      },
      async sendMessage(text: string): Promise<string> {
        if (!alive) throw new Error("instance terminated");
        // No chat surface -- a symbolic reasoner, not an LLM agent. Treat
        // any free-text message as a bare consent question defaulting to
        // the most permissive real interpretation, and be honest that this
        // is a fallback, not a real parse of the message.
        const res = await fetch(`${apiBase}/consent/check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ consent_mode: "public", data_category: "preferences", requester: "other_agent" }),
        });
        const result = await res.json().catch(() => ({}));
        return JSON.stringify({ note: `not a chat surface; ran a default consent check instead of parsing "${text}"`, result });
      },
      terminate(): void {
        // A live ethics/consent gate other requests may depend on --
        // detach only.
        alive = false;
      },
    };
  }
}
