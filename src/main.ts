import "./style.css";
import type { GraphEngine } from "./engine/types";
import { OmokodaGraphEngine } from "./engine/OmokodaGraphEngine";
import { VantageGraphEngine } from "./engine/VantageGraphEngine";
import { WasmAgentHost } from "./runtime/WasmAgentHost";
import { LoomRuntimeHost } from "./runtime/LoomRuntimeHost";
import { JuliaMemoryRuntimeHost } from "./runtime/JuliaMemoryRuntimeHost";
import { ElixirSwarmRuntimeHost } from "./runtime/ElixirSwarmRuntimeHost";
import { GoFlowRuntimeHost } from "./runtime/GoFlowRuntimeHost";
import { MoveOnChainRuntimeHost } from "./runtime/MoveOnChainRuntimeHost";
import { ObatalaRuntimeHost } from "./runtime/ObatalaRuntimeHost";
import { registerOmokodaNodeType } from "./nodeTypes/registerOmokoda";
import { registerGlyphMemoryNodeType } from "./nodeTypes/glyphMemoryNode";
import { DEFAULT_NODE_TYPES } from "./nodeTypes/registerDefaults";
import { GalaxyScene } from "./scene/GalaxyScene";
import { NodeInspector } from "./ui/NodeInspector";
import { SpawnPanel } from "./ui/SpawnPanel";
import { Legend } from "./ui/Legend";
import { Hud } from "./ui/Hud";

// --- Resolve the omokoda-core API base -------------------------------------
// Default: same hostname the dashboard is served from, on the kernel's HTTP
// port (7777). Override with ?api=http://host:port (persisted for next load)
// for local dev against a different box.
function resolveApiBase(): string {
  const url = new URL(window.location.href);
  const override = url.searchParams.get("api");
  if (override) {
    localStorage.setItem("omokoda_api_base", override);
    return override;
  }
  const stored = localStorage.getItem("omokoda_api_base");
  if (stored) return stored;
  return `http://${window.location.hostname}:7777`;
}

// --- Resolve LOOM's API base (same-host convention, override via ?loomApi=)
function resolveLoomApiBase(): string {
  const url = new URL(window.location.href);
  const override = url.searchParams.get("loomApi");
  if (override) {
    localStorage.setItem("loom_api_base", override);
    return override;
  }
  const stored = localStorage.getItem("loom_api_base");
  if (stored) return stored;
  return `http://${window.location.hostname}:8889`;
}

// --- Resolve the Julia memory service's API base (override via ?juliaApi=)
function resolveJuliaApiBase(): string {
  const url = new URL(window.location.href);
  const override = url.searchParams.get("juliaApi");
  if (override) {
    localStorage.setItem("julia_api_base", override);
    return override;
  }
  const stored = localStorage.getItem("julia_api_base");
  if (stored) return stored;
  return `http://${window.location.hostname}:7778`;
}

// --- Resolve the Elixir swarm's API base (override via ?elixirApi=)
function resolveElixirApiBase(): string {
  const url = new URL(window.location.href);
  const override = url.searchParams.get("elixirApi");
  if (override) {
    localStorage.setItem("elixir_api_base", override);
    return override;
  }
  const stored = localStorage.getItem("elixir_api_base");
  if (stored) return stored;
  return `http://${window.location.hostname}:4000`;
}

// --- Resolve ỌYA's (Go flow service) API base (override via ?goApi=)
function resolveGoApiBase(): string {
  const url = new URL(window.location.href);
  const override = url.searchParams.get("goApi");
  if (override) {
    localStorage.setItem("go_api_base", override);
    return override;
  }
  const stored = localStorage.getItem("go_api_base");
  if (stored) return stored;
  return `http://${window.location.hostname}:8100`;
}

// --- Sui testnet RPC base (override via ?suiApi=). fullnode.testnet.sui.io
// soft-blocks non-SDK POSTs; this public mirror serves the same chain with
// open CORS, confirmed live.
function resolveSuiApiBase(): string {
  const url = new URL(window.location.href);
  const override = url.searchParams.get("suiApi");
  if (override) {
    localStorage.setItem("sui_api_base", override);
    return override;
  }
  const stored = localStorage.getItem("sui_api_base");
  if (stored) return stored;
  return "https://sui-testnet-rpc.publicnode.com";
}

// --- Resolve Ọbàtálá's API base (override via ?obatalaApi=)
function resolveObatalaApiBase(): string {
  const url = new URL(window.location.href);
  const override = url.searchParams.get("obatalaApi");
  if (override) {
    localStorage.setItem("obatala_api_base", override);
    return override;
  }
  const stored = localStorage.getItem("obatala_api_base");
  if (stored) return stored;
  return `http://${window.location.hostname}:4002`;
}

// --- Engine: the real omokoda-core kernel, not a simulation. See README
// "How to Connect a Real Backend" for the interface this implements.
//
// Opt-in LIVE-MESH view: set VITE_VANTAGE_URL to mirror the whole Ọmọ Kọ́dà
// population as the Vantage social hub sees it — every agent that self-
// registered at birth becomes its own node, birth lineage (parent_id) becomes
// edges, and it's read-only (births happen in the runtime, not the browser).
// Unset ⇒ the default kernel-direct OmokodaGraphEngine below is used unchanged.
const VANTAGE_URL = import.meta.env.VITE_VANTAGE_URL as string | undefined;
const meshView = Boolean(VANTAGE_URL && VANTAGE_URL.trim());
const engine: GraphEngine = meshView
  ? new VantageGraphEngine({
      baseUrl: VANTAGE_URL!,
      apiKey: (import.meta.env.VITE_VANTAGE_KEY as string | undefined) ?? "",
      blockId: (import.meta.env.VITE_MESH_BLOCK as string | undefined) ?? "default",
    })
  : new OmokodaGraphEngine({ apiBase: resolveApiBase() });
if (meshView) {
  console.info(
    `[AXIOM] LIVE mesh view — mirroring Vantage block "${
      (import.meta.env.VITE_MESH_BLOCK as string | undefined) ?? "default"
    }" at ${VANTAGE_URL}`,
  );
}

// The sovereign kernel — the real, always-on agent this dashboard controls.
registerOmokodaNodeType(engine);

// GlyphIndex sovereign-memory stars — the queryable projection of the
// ecosystem memory vault (spec: OSOVM/GLYPHINDEX_SPEC.md), rendered with
// base-Odù semantic zoom via projectGlyphGalaxy / semanticZoomClusters.
registerGlyphMemoryNodeType(engine);

// The two real Wasm species remain genuinely spawnable utility agents (not
// simulated — see README "Real execution: the Wasm leaf runtime" and "The
// Fractal Oracle"). The fractal oracle in particular computes real Mandelbrot
// escape-time dynamics inside the sandbox.
const REAL_WASM_TYPE_IDS = new Set(["rust-wasm-leaf", "fractal-oracle"]);
for (const def of DEFAULT_NODE_TYPES) {
  if (REAL_WASM_TYPE_IDS.has(def.id)) engine.registerNodeType(def);
}
engine.registerRuntime(new WasmAgentHost("/agents/axiom_leaf.wasm", ["rust-wasm-leaf"]));
engine.registerRuntime(new WasmAgentHost("/agents/axiom_oracle.wasm", ["fractal-oracle"]));

// Python Fabric: LOOM (real production whale-tracking/market-intel engine,
// /opt/ares/Loom on the VPS) — a live singleton service, not something this
// dashboard boots. Spawning attaches an observer node to it.
const pythonFabricDef = DEFAULT_NODE_TYPES.find((d) => d.id === "python-fabric");
if (pythonFabricDef) engine.registerNodeType(pythonFabricDef);
engine.registerRuntime(new LoomRuntimeHost(resolveLoomApiBase()));

// Julia Compute: the real omokoda-memory service (:7778 on the VPS) — Busy
// Beaver verification, NIST entropy tests, Augury prediction, DePIN
// optimization, mesh scoring, and REM fractal planning. Also a live
// singleton other services (the Rust kernel, Elixir swarm) already depend
// on, so spawning attaches rather than boots.
const juliaComputeDef = DEFAULT_NODE_TYPES.find((d) => d.id === "julia-compute");
if (juliaComputeDef) engine.registerNodeType(juliaComputeDef);
engine.registerRuntime(new JuliaMemoryRuntimeHost(resolveJuliaApiBase()));

// Elixir Core: the real omokoda-swarm OTP supervision tree (:4000 on the
// VPS) — coordinator, hive, mesh presence/neighbor discovery, and the
// hive-scale REM cycle GenServer. A live supervisor other agents run
// under, so spawning attaches rather than boots.
const elixirCoreDef = DEFAULT_NODE_TYPES.find((d) => d.id === "elixir-core");
if (elixirCoreDef) engine.registerNodeType(elixirCoreDef);
engine.registerRuntime(new ElixirSwarmRuntimeHost(resolveElixirApiBase()));

// Go Flow: the real ỌYA rhythm/rate-limit service (:8100 on the VPS) —
// Sabbath gating and per-agent primitive cooldowns. A live shared service
// (other agents' think/act calls depend on it), so spawning attaches.
const goFlowDef = DEFAULT_NODE_TYPES.find((d) => d.id === "go-flow");
if (goFlowDef) engine.registerNodeType(goFlowDef);
engine.registerRuntime(new GoFlowRuntimeHost(resolveGoApiBase()));

// Move (Sui): the real published omokoda-on-chain package — no backend of
// its own, queries Sui's public RPC directly. Nothing to boot or kill.
const moveOnChainDef = DEFAULT_NODE_TYPES.find((d) => d.id === "move-onchain");
if (moveOnChainDef) engine.registerNodeType(moveOnChainDef);
engine.registerRuntime(new MoveOnChainRuntimeHost(resolveSuiApiBase()));

// Ọbàtálá (Wisdom): the real Clojure/Babashka symbolic ethics engine
// (:4002 on the VPS) -- consent/privacy rule evaluation, live. A shared
// gate other requests may depend on, so spawning attaches.
const obatalaDef = DEFAULT_NODE_TYPES.find((d) => d.id === "obatala-wisdom");
if (obatalaDef) engine.registerNodeType(obatalaDef);
engine.registerRuntime(new ObatalaRuntimeHost(resolveObatalaApiBase()));

// No seedConstellation() here — every node on this galaxy is real: the
// kernel (from /v1/status once she's born) or a genuinely sandboxed Wasm
// process a user spawns via the panel below.

const canvas = document.getElementById("axiom-canvas");
const legendSlot = document.getElementById("axiom-legend-slot");
const spawnSlot = document.getElementById("axiom-spawn-slot");
const inspectorSlot = document.getElementById("axiom-inspector-slot");

if (!canvas || !legendSlot || !spawnSlot || !inspectorSlot) {
  throw new Error("AXIOM Galaxy: expected DOM scaffold is missing from galaxy.html");
}

const scene = new GalaxyScene(canvas);
scene.setNodeTypes(engine.getNodeTypes());

const hud = new Hud(canvas, (enabled) => scene.setFollowMode(enabled));

// In LIVE mesh view the population is authoritative and read-only — agents are
// born in the Ọmọ Kọ́dà runtime, so the "spawn child" affordance is disabled.
const spawnChild = meshView
  ? undefined
  : (parent: import("./engine/types").AgentNode) => {
      const def = engine.getNodeTypes().find((d) => d.id === parent.typeId);
      const child = engine.spawnNode({
        typeId: parent.typeId,
        label: `${parent.label}-child`,
        framework: def?.label ?? parent.framework,
        capabilities: [{ name: "assist", description: `Delegated subtask from ${parent.label}` }],
      });
      if (child.id !== parent.id) engine.connect(parent.id, child.id);
    };
const inspector = new NodeInspector(inspectorSlot, engine, spawnChild);
if (!meshView) new SpawnPanel(spawnSlot, engine);
new Legend(legendSlot, engine.getNodeTypes());

scene.setNodeClickHandler((node) => {
  if (node) {
    scene.focusOn(node.id);
    inspector.show(node);
  } else {
    scene.clearFocus();
  }
});

engine.subscribe((nodes, edges) => {
  scene.update(nodes, edges);
  hud.updateStats(nodes, edges);
  inspector.refresh(nodes);
});
engine.onEvent((event) => {
  scene.handleEvent(event);
  hud.pushEvent(event);
});
engine.start();
