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
    types.ts            AgentNode, AgentEdge, NodeTypeDefinition, GraphEvent,
                         and the GraphEngine interface every backend must satisfy
    MockGraphEngine.ts   local, in-memory GraphEngine used for the demo:
                         activity drift, reputation evolution, autonomous
                         spawn chains, memory logs, mock tools & messaging
  nodeTypes/
    registerDefaults.ts  starter set of pluggable node types (one per
                         illustrative framework tier)
    seedConstellation.ts demo data so the galaxy isn't empty on first load
  scene/
    GalaxyScene.ts       Three.js rendering: snapshot reconciliation plus
                         event-driven effects (birth bursts, death implosions,
                         particle-flow edges, pulsing cores, nebulae, bloom)
    layout.ts            spherical layout for nodes without an explicit
                         position
  ui/
    NodeInspector.ts     glassmorphic panel: live metrics, invocable tools,
                         memory window, direct-message console, spawn child
    SpawnPanel.ts         dropdown + button demonstrating dynamic spawning
    Legend.ts             static color/shape legend for registered types
    Hud.ts                swarm stats + live runtime event feed overlay
  main.ts                 wires engine -> scene -> UI together
docs/
  STYLE_GUIDE.md          visual language + extension examples
```

### The graph IS the runtime

`GalaxyScene.update(nodes, edges)` is a pure reconciliation against whatever
the `GraphEngine` currently reports — it does not know or care whether a
node's process lives in a Wasm sandbox, a BEAM supervisor, or a Python
worker. Spawning a node in the engine makes it appear in the scene (with a
birth burst); terminating it removes the mesh with an implosion and emits a
termination receipt. There is no separate "visualization state" to keep in
sync.

Two complementary subscription channels drive the surface:

| Channel | Question it answers | Consumers |
|---|---|---|
| `engine.subscribe(listener)` | "what does the graph look like now" | scene reconciliation, HUD stats, inspector live fields |
| `engine.onEvent(listener)` | "what just happened" | birth/death effects, HUD event feed |

`GraphEvent` currently covers `node_spawned`, `node_updated`, `node_died`
(with receipt), `message_pulse`, and `tool_invoked`.

### Pluggability

A framework announces itself by registering a `NodeTypeDefinition`:

```ts
engine.registerNodeType({
  id: "my-framework-agent",
  label: "My Framework Agent",
  description: "...",
  color: 0x00ff88,        // mesh + UI accent
  accentColor: 0x7dffc0,  // core glow, edge particles (optional)
  scale: 1.0,
  geometry: "sphere",     // icosahedron | sphere | box | octahedron | torus
  birthEffect: "burst",   // burst | ripple | none
});
```

Any node whose `typeId` matches gets that visual treatment automatically —
no changes to `GalaxyScene` or the UI are required. See
`docs/STYLE_GUIDE.md` for the full visual language and extension examples.

## How to Connect a Real Backend

The entire surface talks to one interface: `GraphEngine`
(`src/engine/types.ts`). To drive the galaxy from a real runtime, implement
that interface over your transport and swap the single constructor line in
`main.ts`. The scene, inspector, HUD, and spawn controls do not change.

The general shape, regardless of language:

1. **Transport**: open a WebSocket (or SSE/long-poll) connection from the
   browser to your runtime.
2. **Snapshots**: on connect and on change, the runtime sends the full (or
   delta-encoded) `{nodes, edges}` state → your implementation forwards it
   to `subscribe` listeners.
3. **Events**: the runtime pushes discrete events (`node_spawned`, ...) →
   forward to `onEvent` listeners. Effects and the feed light up for free.
4. **Commands**: `spawnNode`, `terminateNode`, `connect`, `invokeTool`,
   `sendMessage` serialize to request messages; resolve their promises when
   the runtime acks.

### Elixir (OTP supervision backbone)

The natural production backend. A Phoenix Channel (or raw `:cowboy`
WebSocket) exposes a `GraphEngine` GenServer:

- `DynamicSupervisor.start_child/2` on `spawn_node` — the supervision tree
  literally is the graph.
- `Process.monitor/1` down-messages become `node_died` events with receipts.
- A `Registry` keyed by node id holds per-agent metadata (the `AgentNode`
  fields) and each agent process pushes `node_updated` on state change.
- `invoke_tool` / `send_message` are `GenServer.call/3` into the agent
  process; the reply resolves the browser-side promise.

### Python (existing LOOM-style fabric)

A thin `websockets`/FastAPI layer over your agent registry:

- Map each agent object to an `AgentNode` dict; broadcast the snapshot on a
  debounce whenever the registry mutates.
- Route `invoke_tool` to the agent's exposed callables (MCP-style manifest),
  return the result as the response payload.
- LOOM `MarketEvent`s that flow between agents become `message_pulse`
  events keyed to the corresponding edge.

### Rust/Wasm (in-browser leaf agents)

No network needed — leaf agents can run *inside* the page:

- Compile agent modules to Wasm; a `WasmAgentHost` implementing
  `GraphEngine` instantiates one sandboxed instance per `spawnNode` call.
- The Wasm module exports its tool manifest (names + descriptions) at
  instantiation; the host surfaces them as `capabilities`.
- `invokeTool` becomes a direct call into the instance's exported function.
- A hybrid engine can multiplex: Wasm leaves locally, an Elixir core over
  WebSocket, presented to the surface as one unified graph.

## What's out of scope here

This artifact is the visualization/control-plane surface only. It does not
implement the Elixir orchestration backbone, Rust/Wasm agent runtime, MCP
tool registry wire protocol, or any of the domain-specific integrations
(LOOM market fabric, Vantage federation, Omo-Koda sovereign kernel,
IfáScript, Koodu, Zangbeto, BIPON39/Cloakseed identity). Those are
separate, later artifacts that would each implement `GraphEngine` (or a
node type / tool provider within it) rather than being folded into this
repo directly.
