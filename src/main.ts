import "./style.css";
import { MockGraphEngine } from "./engine/MockGraphEngine";
import { WasmAgentHost } from "./runtime/WasmAgentHost";
import { LoomProvider } from "./runtime/LoomProvider";
import { VantageProvider } from "./runtime/VantageProvider";
import { registerDefaultNodeTypes } from "./nodeTypes/registerDefaults";
import { seedConstellation } from "./nodeTypes/seedConstellation";
import { GalaxyScene } from "./scene/GalaxyScene";
import { NodeInspector } from "./ui/NodeInspector";
import { SpawnPanel } from "./ui/SpawnPanel";
import { Legend } from "./ui/Legend";
import { Hud } from "./ui/Hud";

// --- Engine: three providers power the galaxy simultaneously.
// Each claims different node type IDs; the engine routes lifecycle and
// tool invocations to the owning provider. Simulated types (from the
// demo constellation) keep the galaxy alive as real backends come online.
const engine = new MockGraphEngine();
registerDefaultNodeTypes(engine);

// Provider 1: Local Wasm — sandboxed browser agents (rust-wasm-leaf)
engine.registerRuntime(new WasmAgentHost("/agents/axiom_leaf.wasm", ["rust-wasm-leaf"]));

// Fractal Oracle: a real Wasm Mandelbrot engine. Its tools (mandelbrot_scan,
// escape_time_risk, robust_island_query, …) execute inside the sandbox; the
// inspector's explorer and the node's shader read straight from it.
engine.registerRuntime(new WasmAgentHost("/agents/axiom_oracle.wasm", ["fractal-oracle"]));

// Provider 2: LOOM fabric — local event bus, whale tracking, agent debates
// (ws://localhost:8889/ws). Claims python-fabric + elixir-core types.
const loom = new LoomProvider();

// Provider 3: Vantage — live ecosystem API at omokoda.duckdns.org
// (requires X-Agent-Key for authenticated endpoints). Claims
// typescript-surface + rust-wasm-leaf for ecosystem mirroring.
const vantage = new VantageProvider();

// Register both alongside the Wasm runtime
engine.registerRuntime(loom);
engine.registerRuntime(vantage);

// Seed demo constellation — simulated nodes fill in gaps where no
// provider has claimed a type yet, keeping the galaxy alive on first load.
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
