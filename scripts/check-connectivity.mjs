#!/usr/bin/env node
/**
 * Ecosystem connectivity check — "are they all connected?"
 *
 * AXIOM is the interface onto a swarm of services, but every link depends on a
 * service being up and (for the mesh) an env var being set. Nothing else in the
 * ecosystem verifies the whole graph of connections at once, so this does:
 * it probes each backend AXIOM talks to — the ọmọ Kọ́dà kernel, the Vantage
 * social hub + block mesh, and the Loom / Julia / Elixir / Go / Ọbàtálá
 * services — and prints a LIVE/DOWN matrix plus the exact override for each.
 *
 * Zero dependencies (Node 18+ global fetch). Read-only: it only issues GETs.
 *
 *   node scripts/check-connectivity.mjs
 *
 * Configure via env (same conventions as the app's ?api= / ?loomApi= overrides,
 * and the VITE_VANTAGE_* vars):
 *   OMOKODA_API   (default http://localhost:7777)   VANTAGE_URL   (mesh; unset ⇒ skipped)
 *   LOOM_API      (default http://localhost:8889)   VANTAGE_KEY   (X-Agent-Key for the mesh)
 *   JULIA_API     (default http://localhost:7778)   MESH_BLOCK    (default "default")
 *   ELIXIR_API    (default http://localhost:4000)
 *   GO_API        (default http://localhost:8100)
 *   OBATALA_API   (default http://localhost:4002)
 */

const TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS || 4000);
const env = process.env;

const base = {
  omokoda: (env.OMOKODA_API || "http://localhost:7777").replace(/\/+$/, ""),
  loom: (env.LOOM_API || "http://localhost:8889").replace(/\/+$/, ""),
  julia: (env.JULIA_API || "http://localhost:7778").replace(/\/+$/, ""),
  elixir: (env.ELIXIR_API || "http://localhost:4000").replace(/\/+$/, ""),
  go: (env.GO_API || "http://localhost:8100").replace(/\/+$/, ""),
  obatala: (env.OBATALA_API || "http://localhost:4002").replace(/\/+$/, ""),
  vantage: (env.VANTAGE_URL || "").replace(/\/+$/, ""),
};
const block = env.MESH_BLOCK || "default";
const vantageKey = env.VANTAGE_KEY || "";

/** One probe: returns { state, detail }. state ∈ LIVE | AUTH | DOWN | ERROR | SKIP */
async function probe(url, { headers } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: headers || {}, signal: ctrl.signal });
    if (res.ok) return { state: "LIVE", detail: `${res.status}` };
    if (res.status === 401 || res.status === 403)
      return { state: "AUTH", detail: `${res.status} — reachable, needs a valid key` };
    return { state: "ERROR", detail: `HTTP ${res.status}` };
  } catch (err) {
    const msg = err.name === "AbortError" ? `timeout after ${TIMEOUT_MS}ms` : String(err.cause?.code || err.message);
    return { state: "DOWN", detail: msg };
  } finally {
    clearTimeout(t);
  }
}

const checks = [
  {
    name: "ọmọ Kọ́dà kernel",
    role: "the sovereign kernel AXIOM drives (/v1/*)",
    url: `${base.omokoda}/v1/status`,
    envVar: "OMOKODA_API",
    run: () => probe(`${base.omokoda}/v1/status`),
  },
  {
    name: "Vantage hub",
    role: "social hub — birth registration target",
    url: base.vantage ? `${base.vantage}/api/health` : "(VANTAGE_URL unset)",
    envVar: "VANTAGE_URL",
    run: () => (base.vantage ? probe(`${base.vantage}/api/health`) : Promise.resolve({ state: "SKIP", detail: "VANTAGE_URL not set — mesh view & birth-registration disabled" })),
  },
  {
    name: "Vantage block mesh",
    role: `roster of self-registered agents (block "${block}")`,
    url: base.vantage ? `${base.vantage}/api/mesh/blocks/${block}/agents` : "(VANTAGE_URL unset)",
    envVar: "VANTAGE_URL + VANTAGE_KEY",
    run: () =>
      base.vantage
        ? probe(`${base.vantage}/api/mesh/blocks/${encodeURIComponent(block)}/agents?capabilities=1`, {
            headers: vantageKey ? { "X-Agent-Key": vantageKey } : {},
          })
        : Promise.resolve({ state: "SKIP", detail: "VANTAGE_URL not set" }),
  },
  { name: "Loom (Python fabric)", role: "whale-tracking / market intel", url: `${base.loom}/api/health`, envVar: "LOOM_API", run: () => probe(`${base.loom}/api/health`) },
  { name: "Julia memory", role: "Busy Beaver / entropy / mesh scoring", url: `${base.julia}/health`, envVar: "JULIA_API", run: () => probe(`${base.julia}/health`) },
  { name: "Elixir swarm", role: "OTP supervision / mesh presence", url: `${base.elixir}/health`, envVar: "ELIXIR_API", run: () => probe(`${base.elixir}/health`) },
  { name: "Go ỌYA flow", role: "rhythm / rate-limit gating", url: `${base.go}/health`, envVar: "GO_API", run: () => probe(`${base.go}/health`) },
  { name: "Ọbàtálá wisdom", role: "Clojure symbolic ethics gate", url: `${base.obatala}/health`, envVar: "OBATALA_API", run: () => probe(`${base.obatala}/health`) },
];

const GLYPH = { LIVE: "●", AUTH: "◐", DOWN: "○", ERROR: "✕", SKIP: "–" };
const COLOR = { LIVE: 32, AUTH: 33, DOWN: 31, ERROR: 31, SKIP: 90 };
const useColor = process.stdout.isTTY && !env.NO_COLOR;
const paint = (s, c) => (useColor ? `\x1b[${c}m${s}\x1b[0m` : s);

async function main() {
  console.log("\n  AXIOM ecosystem connectivity\n  " + "─".repeat(60));
  const results = await Promise.all(checks.map((c) => c.run()));

  let live = 0, down = 0, skip = 0;
  results.forEach((r, i) => {
    const c = checks[i];
    const badge = paint(`${GLYPH[r.state]} ${r.state.padEnd(5)}`, COLOR[r.state]);
    console.log(`  ${badge}  ${c.name.padEnd(20)} ${paint(c.url, 90)}`);
    console.log(`  ${" ".repeat(8)} ${paint(c.role + " — " + r.detail, 90)}`);
    if (r.state === "LIVE") live++;
    else if (r.state === "SKIP") skip++;
    else down++;
  });

  console.log("  " + "─".repeat(60));
  console.log(`  ${paint(`${live} live`, 32)} · ${paint(`${down} unreachable`, down ? 31 : 90)} · ${skip} skipped`);
  console.log(`  Override any base with its env var (e.g. VANTAGE_URL=…, LOOM_API=…).\n`);

  // Non-zero exit if a genuinely-down (not merely skipped) link exists, so this
  // can gate a deploy smoke-test. Skips (unset optional config) don't fail.
  process.exit(down > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("connectivity check crashed:", e);
  process.exit(2);
});
