import "./style.css";
import { MockGraphEngine } from "./engine/MockGraphEngine";
import { WasmAgentHost } from "./runtime/WasmAgentHost";
import { registerDefaultNodeTypes } from "./nodeTypes/registerDefaults";
import { seedConstellation } from "./nodeTypes/seedConstellation";
import { GalaxyScene } from "./scene/GalaxyScene";
import { NodeInspector } from "./ui/NodeInspector";
import { SpawnPanel } from "./ui/SpawnPanel";
import { Legend } from "./ui/Legend";
import { Hud } from "./ui/Hud";

// --- Engine: swap MockGraphEngine for a real backend-backed GraphEngine
// implementation (e.g. one that speaks to an Elixir GraphEngine over
// WebSocket) to go from demo to production. Nothing below this line needs
// to change when that swap happens. See README "How to Connect a Real
// Backend".
const engine = new MockGraphEngine();
registerDefaultNodeTypes(engine);

// Real runtime: every rust-wasm-leaf node is a live sandboxed WebAssembly
// process (compiled from agents/leaf). Its tools and message replies execute
// inside the instance — only the remaining node types are simulated.
engine.registerRuntime(new WasmAgentHost("/agents/axiom_leaf.wasm", ["rust-wasm-leaf"]));

// Fractal Oracle: a real Wasm Mandelbrot engine. Its tools (mandelbrot_scan,
// escape_time_risk, robust_island_query, …) execute inside the sandbox; the
// inspector's explorer and the node's shader read straight from it.
engine.registerRuntime(new WasmAgentHost("/agents/axiom_oracle.wasm", ["fractal-oracle"]));

seedConstellation(engine);

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
  engine.connect(parent.id, child.id);
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
