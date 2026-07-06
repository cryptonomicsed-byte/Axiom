# AXIOM Galaxy

A pluggable 3D graph surface where **the graph is the runtime**: every node
is a live agent handle, every edge is an active communication channel.
This is the first concrete artifact of the wider AXIOM vision — the
browser-facing "galaxy" control plane — built framework-agnostic from the
start so any backend (Elixir, Rust/Wasm, Python, Julia, or something not
invented yet) can plug in without the surface layer changing.

## Running it

```sh
npm install
npm run dev      # local dev server, opens galaxy.html
npm run build    # type-checks and produces a production build in dist/
npm run typecheck
```

## Architecture

```
galaxy.html            entry point (not index.html, by convention)
src/
  engine/
    types.ts            AgentNode, AgentEdge, NodeTypeDefinition, and the
                         GraphEngine interface every backend must satisfy
    MockGraphEngine.ts   local, in-memory GraphEngine used for the demo
  nodeTypes/
    registerDefaults.ts  starter set of pluggable node types (one per
                         illustrative framework tier)
    seedConstellation.ts demo data so the galaxy isn't empty on first load
  scene/
    GalaxyScene.ts       Three.js rendering: reconciles nodes/edges against
                         the current GraphEngine snapshot on every update
    layout.ts            spherical layout for nodes without an explicit
                         position
  ui/
    NodeInspector.ts     side panel: metadata, tools/capabilities, memory
                         summary, terminate action for the selected node
    SpawnPanel.ts         dropdown + button demonstrating dynamic spawning
    Legend.ts             static color/shape legend for registered types
  main.ts                 wires engine -> scene -> UI together
```

### The graph IS the runtime

`GalaxyScene.update(nodes, edges)` is a pure reconciliation against whatever
the `GraphEngine` currently reports — it does not know or care whether a
node's process lives in a Wasm sandbox, a BEAM supervisor, or a Python
worker. Spawning a node in the engine makes it appear in the scene;
terminating it removes the mesh and its edges. There is no separate
"visualization state" to keep in sync.

### Pluggability

A framework announces itself by registering a `NodeTypeDefinition`:

```ts
engine.registerNodeType({
  id: "my-framework-agent",
  label: "My Framework Agent",
  description: "...",
  color: 0x00ff88,
  scale: 1.0,
  geometry: "sphere",
});
```

Any node whose `typeId` matches gets that visual treatment automatically —
no changes to `GalaxyScene` or the UI are required. `src/nodeTypes/` ships
five illustrative types (Rust/Wasm leaf, Elixir core, Python fabric,
TypeScript surface, Julia compute) as a neutral starting point, not a fixed
taxonomy.

### Swapping in a real backend

`MockGraphEngine` simulates spawning, connecting, and message-activity decay
locally so the demo is alive without a server. To go from demo to
production, implement the same `GraphEngine` interface (`src/engine/types.ts`)
against a real transport — e.g. a WebSocket bridge into an Elixir
`GraphEngine` process that owns actual supervision and topology authority —
and swap the one line in `main.ts` that constructs `MockGraphEngine`.
Nothing in `scene/` or `ui/` needs to know the difference.

## What's out of scope here

This artifact is the visualization/control-plane surface only. It does not
implement the Elixir orchestration backbone, Rust/Wasm agent runtime, MCP
tool registry wire protocol, or any of the domain-specific integrations
(LOOM market fabric, Vantage federation, Omo-Koda sovereign kernel,
IfáScript, Koodu, Zangbeto, BIPON39/Cloakseed identity). Those are
separate, later artifacts that would each implement `GraphEngine` (or a
node type / tool provider within it) rather than being folded into this
repo directly.
