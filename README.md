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
                         particle-flow edges, breathing cores, fresnel energy
                         skins, anamorphic flares, nebulae, bloom)
    postfx.ts            cinematic grade (chromatic aberration, vignette,
                         film grain, scanlines), fresnel rim material, star-
                         flare + glow textures, and the void backdrop
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

## Real execution: the Wasm leaf runtime

The `rust-wasm-leaf` node type is **not simulated**. Spawning one
instantiates a real sandboxed WebAssembly process compiled from
`agents/leaf` (no_std Rust, zero dependencies, ~3.6 KB). Each instance:

- gets its **own linear memory and private state** — the `tick` counter
  lives inside the Wasm heap; two leaves report independent counts;
- receives **zero ambient authority** — the module is instantiated with an
  empty import object: no DOM, no network, no other agents;
- **announces its own tools** — the host reads the module's exported
  MCP-style JSON manifest at boot and adopts it as the node's capabilities;
  the inspector's tool chips call straight into compiled Rust
  (`fnv1a` hashing, `stats` number crunching, `echo`, `tick`);
- answers **direct messages from inside the process** — replies carry the
  instance-private tick count as proof of origin.

The plumbing is the `AgentRuntimeProvider` interface (`engine/types.ts`):
a provider claims node type ids and turns spawn requests into live
`AgentInstance` handles. `MockGraphEngine` routes lifecycle, tool calls,
and messages to the owning provider and only simulates types nobody has
claimed — so runtimes come online one at a time without a flag day.

Rebuild the agent after editing `agents/leaf` (requires the
`wasm32-unknown-unknown` target):

```sh
npm run build:agents   # cargo build + copy into public/agents/
```

The compiled `public/agents/axiom_leaf.wasm` is committed so the app runs
without a Rust toolchain.

## The Fractal Oracle: Mandelbrot dynamics as a live agent

The `fractal-oracle` node type is a **second, distinct Wasm species**
(`agents/oracle`) — the same four-function ABI as the leaf, but its tools
compute Mandelbrot escape-time dynamics (`z → z² + c`, escape at |z| > 2).
The iteration is the primitive: a point `c` whose orbit stays **bounded is a
robust island** (a stable, low-fragility attractor); a point that **escapes
quickly is an escape zone** (brittle — blows up under a regime shift); late
escapes are the **fragile boundary**. That maps onto strategy-parameter
robustness, market-structure persistence, and swarm stability.

Its MCP-style manifest self-announces five tools, all executing inside the
sandbox:

- `mandelbrot_scan` — escape-time grid over a region (`re0,re1,im0,im1,w,h[,maxiter]`);
- `escape_time_risk` — fragility of a single point `c` (bounded / stability / risk / verdict);
- `robust_island_query` — is `c` a robust island? (bounded + depth + stability);
- `fractal_signal_filter` — classify a numeric series as bounded (accumulation) vs divergent (breakout);
- `swarm_stability_map` — stability of a swarm mapped into parameter space.

Two surfaces read straight from that Wasm:

1. **The node's shell** renders a live escape-time Mandelbrot (custom shader in
   `scene/postfx.ts`), panning/zooming slowly, brightness driven by the agent's
   real activity — bounded points blaze gold.
2. **The inspector's Mandelbrot Explorer** paints the set from the oracle's own
   `mandelbrot_scan` (bounded = gold "islands"), click-to-zoom into strategy
   space; the centre's fragility verdict comes from `escape_time_risk`.

This is Phase 1 of the wider Mandelbrot layer — the same oracle interface a
Julia/Python backtester bridge will later implement to publish *real* strategy
robustness maps (bounded = high-Sharpe islands) into the same node.

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

### Rust/Wasm (in-browser leaf agents) — ALREADY SHIPPED

This one is implemented: `src/runtime/WasmAgentHost.ts` +
`agents/leaf/`. See "Real execution: the Wasm leaf runtime" above. New
in-page agent species follow the same recipe: compile any language to a
Wasm module exporting the four-function ABI (`manifest_ptr`,
`manifest_len`, `alloc`, `invoke`), then register another `WasmAgentHost`
pointing at its `.wasm` URL for its node type ids. The hybrid engine
multiplexes: Wasm leaves locally, an Elixir core over WebSocket, one
unified graph on the surface.

### Vantage block mesh (whole Ọmọ Kọ́dà population) — ALREADY SHIPPED (opt-in)

The default engine (`OmokodaGraphEngine`) drives the galaxy from a single live
kernel over `/v1/*`. `src/engine/VantageGraphEngine.ts` is a second, opt-in live
engine that instead mirrors the **whole population** as the
[Vantage](https://github.com/cryptonomicsed-byte/Vantage) social hub sees it:
every ọmọ Kọ́dà agent self-registers on the block mesh at birth
(`POST /api/mesh/agents/join`, carrying a verifiable Ed25519 identity, DNA
fingerprint, and Ifá Odù — see Ọmọ Kọ́dà's `mesh_tools.rs`), and this engine
reads that roster back as the graph:

- **Nodes** ← `GET /api/mesh/blocks/{block}/agents`. Trust → reputation,
  `last_seen_at` recency → activity, Odù / Òrìṣà / verification / DNA → capabilities.
- **Edges** ← birth lineage: `parent_id → child` when both are on the roster.
- **Events** ← `GET /api/mesh/blocks/{block}/events`: new agents → `node_spawned`,
  `proposal_created` → `message_pulse`, departures → `node_died`.
- **Real-time** ← it opens `/ws/gossip?channel=block.{block}` purely as a
  "poll now" nudge so a birth shows within milliseconds; polling is the safety net.

It is **read-only** (births happen in the runtime, not the browser), so
spawn/terminate/connect are disabled and the inspector shows *live mesh ·
read-only*. Enable it with Vite env (see `.env.example`); unset ⇒ the default
kernel engine is used, unchanged:

```bash
VITE_VANTAGE_URL=https://your-vantage-host   # unset ⇒ default kernel engine
VITE_VANTAGE_KEY=vantage_xxx                 # a read-only viewer agent key
VITE_MESH_BLOCK=default                       # block to mirror (optional)
```

> The browser calls Vantage directly, so the host must allow the AXIOM origin in
> `ALLOWED_ORIGINS` (CORS) and permit the `X-Agent-Key` header — or point
> `VITE_VANTAGE_URL` at a Vite dev proxy.

## What's out of scope here

This artifact is the visualization/control-plane surface only. It does not
implement the Elixir orchestration backbone, Rust/Wasm agent runtime, MCP
tool registry wire protocol, or any of the domain-specific integrations
(LOOM market fabric, Vantage federation, Omo-Koda sovereign kernel,
IfáScript, Koodu, Zangbeto, BIPON39/Cloakseed identity). Those are
separate, later artifacts that would each implement `GraphEngine` (or a
node type / tool provider within it) rather than being folded into this
repo directly.
