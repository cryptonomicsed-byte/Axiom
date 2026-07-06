import "./style.css";
import { MockGraphEngine } from "./engine/MockGraphEngine";
import { registerDefaultNodeTypes } from "./nodeTypes/registerDefaults";
import { seedConstellation } from "./nodeTypes/seedConstellation";
import { GalaxyScene } from "./scene/GalaxyScene";
import { NodeInspector } from "./ui/NodeInspector";
import { SpawnPanel } from "./ui/SpawnPanel";
import { Legend } from "./ui/Legend";

// --- Engine: swap MockGraphEngine for a real backend-backed GraphEngine
// implementation (e.g. one that speaks to an Elixir GraphEngine over
// WebSocket) to go from demo to production. Nothing below this line needs
// to change when that swap happens.
const engine = new MockGraphEngine();
registerDefaultNodeTypes(engine);
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

const inspector = new NodeInspector(inspectorSlot, engine);
new SpawnPanel(spawnSlot, engine);
new Legend(legendSlot, engine.getNodeTypes());

scene.setNodeClickHandler((node) => {
  if (node) {
    scene.focusOn(node.id);
    inspector.show(node);
  }
});

engine.subscribe((nodes, edges) => scene.update(nodes, edges));
engine.start();
