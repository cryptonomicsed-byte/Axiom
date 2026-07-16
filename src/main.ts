import "./style.css";
import { OmokodaGraphEngine } from "./engine/OmokodaGraphEngine";
import { WasmAgentHost } from "./runtime/WasmAgentHost";
import { registerOmokodaNodeType } from "./nodeTypes/registerOmokoda";
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

// --- Engine: the real omokoda-core kernel, not a simulation. See README
// "How to Connect a Real Backend" for the interface this implements.
const engine = new OmokodaGraphEngine({ apiBase: resolveApiBase() });

// The sovereign kernel — the real, always-on agent this dashboard controls.
registerOmokodaNodeType(engine);

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
const inspector = new NodeInspector(inspectorSlot, engine, (parent) => {
  const def = engine.getNodeTypes().find((d) => d.id === parent.typeId);
  const child = engine.spawnNode({
    typeId: parent.typeId,
    label: `${parent.label}-child`,
    framework: def?.label ?? parent.framework,
    capabilities: [{ name: "assist", description: `Delegated subtask from ${parent.label}` }],
  });
  if (child.id !== parent.id) engine.connect(parent.id, child.id);
});
new SpawnPanel(spawnSlot, engine);
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
