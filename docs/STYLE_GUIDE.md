# AXIOM Galaxy — Visual Style Guide

The visual language is **cinematic sci-fi over a live runtime**: a deep
cosmic void with a faint nebular wash, volumetric nebulae, and agents
rendered as **celestial artifacts** — iridescent shells wrapped in a
holographic energy skin around a twin-layer breathing core, with orbit
rings and anamorphic lens flares earned through reputation. The whole
frame is finished with a cinematic grade (chromatic aberration, vignette,
film grain, rolling scanlines). The governing rule is unchanged and
non-negotiable: **every luminous or moving thing on screen maps to a real
runtime fact**. Chrome recedes, runtime glows. The grade and the void
backdrop are the only pure-presentation exceptions — they carry no data,
they are the lens the runtime is shot through.

## Palette

| Token | Value | Role |
|---|---|---|
| `--axiom-bg` | `#05060f` | void background |
| `--axiom-glass` | `rgba(16,19,33,0.55)` | glass panel fill (with `backdrop-filter: blur`) |
| `--axiom-glass-border` | `rgba(122,138,200,0.25)` | glass panel edge |
| `--axiom-text` | `#e6e8f5` | primary text |
| `--axiom-muted` | `#9aa0c3` | secondary text |
| `--axiom-accent` | `#4fd1ff` | neutral runtime accent (edges, holo rings, buttons) |
| gold | `#ffd27a` | birth supernovae — reserved for creation |
| danger | `#ff5c7a` | termination implosions, policy violations |

Node colors belong to **node types**, not the theme. Prefer saturated hues
in the 0.55–0.75 lightness band, and always give `accentColor` a brighter
sibling of `color` — it feeds the core, halo, lattice, edge particles, and
data packets.

## The node artifact

Every agent renders as a composite artifact; each layer is a runtime channel:

| Layer | Construction | Runtime meaning |
|---|---|---|
| **Shell** | archetype geometry, physical material (metalness 0.55, clearcoat, iridescence) | the agent's type; slow self-rotation speeds up slightly with activity |
| **Rim (energy skin)** | additive fresnel `ShaderMaterial` just outside the shell — transparent head-on, blazing at the silhouette | live `activity` (plus reputation floor); focus/hover spike it — the holographic-artifact read |
| **Core** | translucent emissive sphere inside the shell | live `activity`: breath rate *and* depth scale with it — the heartbeat |
| **Inner core** | tiny near-white sphere inside the core, counter-pulsing | the hot nucleus; opacity tracks `activity`, gives the core depth under bloom |
| **Lattice** | faint wireframe of the shell geometry | internal structure; brightens with activity |
| **Halo** | additive radial-gradient sprite | standing glow; grows with reputation |
| **Flare (anamorphic)** | additive star-flare sprite (long horizontal + short vertical streak) | **earned**: dark below 0.6 reputation, then brightens with reputation and twinkles with activity — the "capital ship" / god-ray read |
| **Orbit rings** | thin additive tori + spin | **earned**: 0 rings below 0.45 reputation, 1 to 0.72, 2 above; spin rate follows activity |
| **Selection rings** | two counter-rotating cyan holo-tori | inspection focus only |
| **Scan-pulse** | camera-billboarded ring that expands outward once on select | fires the instant a node is selected; ~0.9s, presentation-only feedback |

### Shell archetypes

`NodeTypeDefinition.geometry` picks the silhouette. Shipped archetypes:

| Archetype | Form | Shipped assignment |
|---|---|---|
| `orb` | dense metallic sphere | Rust/Wasm leaves — compact, mass-produced |
| `geodesic` | faceted sphere, lattice clearly visible | Elixir cores — structural, load-bearing |
| `crystal` | elongated polyhedral shard | Python fabric — grown, organic-analytical |
| `prism` | hexagonal column | TypeScript surface — architectural, interface-like |
| `toroid` | ring around an exposed core | Julia compute — cyclical heavy machinery |

### Special shell: the Fractal Oracle

The `fractal-oracle` type keeps a readable `geodesic` silhouette but swaps a
layer for a **live Mandelbrot shader** (`createFractalMaterial`): the escape-time
set is computed per-fragment, panning slowly, bounded (in-set) points blazing
gold — the "robust islands". Its brightness is driven by the node's real
`activity`, and the inspector's Mandelbrot Explorer paints from the same Wasm
oracle. This is the pattern for any future compute-node that wants its *own
computation* rendered on its skin: a bespoke `ShaderMaterial` keyed on the type
id, everything else (core, rim, halo, rings) inherited from the artifact system.

### Visual hierarchy = runtime hierarchy

Size, glow floor, halo radius, and ring count all derive from
`reputation`; pulse rate, orbit speed, and lattice brightness derive from
`activity`. A high-reputation, high-activity agent is unmistakably the
biggest, brightest, busiest object in frame — without any label.

## Motion language

| Visual | Runtime meaning |
|---|---|
| Core breath (rate + depth) | agent's live `activity` |
| Rim / energy-skin glow | `activity` (floor from reputation); spikes on hover/focus |
| Anamorphic flare brightness + twinkle | reputation (tier gate at 0.6) × `activity` |
| Scan-pulse ring expanding outward | a node was just selected (one-shot) |
| Orbit ring spin rate | `activity` |
| Edge plasma stream (speed, brightness, particle size) | channel `activity` (message volume) |
| Data packet orb travelling an edge | one discrete `message_pulse` — a real A2A message |
| Birth supernova (gold + type accent, double burst) | `node_spawned` |
| Death implosion (red, inward, embers decelerate) | `node_died` + receipt in the HUD feed |
| Artifact scale-up + holo rings | inspection focus |
| Nebula breathing/drift | aggregate swarm activity (ambient) |
| "Follow busiest" camera ease | opt-in cinematic mode targeting the highest-activity agent |
| Slow global scene rotation | none — ambience only, the single allowed exception |

Timing: births ~1.25s, deaths ~0.75s (abrupt is intentional), packets
~0.9s, scan-pulse ~0.9s, focus lerp 0.1–0.15/frame, UI transitions
150–450ms ease.

## Cinematic grade & environment

The scene composites in three passes (`GalaxyScene` + `scene/postfx.ts`):

1. **Render pass** — the lit scene.
2. **UnrealBloom** — cores/flares/edges are the brightest things in frame,
   so bloom reads as energy, not haze (strength 1.15, threshold 0.1).
3. **Cinematic grade** (`createCinematicPass`) — a full-frame shader:
   edge-weighted chromatic aberration (anamorphic fringing), a quadratic
   vignette that keeps the eye centre-frame, faint rolling scanlines, and
   animated luminance-only film grain. Values are deliberately restrained
   (aberration 0.55, grain 0.05, scanline 0.035) — "shot on a lens", never
   an Instagram filter. If it fights legibility, it is turned down.

Behind everything sits the **void backdrop** (`createVoidBackdrop`): an
inside-out gradient sphere, near-black with a warm-cool vertical wash and a
faint nebular brightening toward the horizon, so deep space reads as
atmosphere rather than a flat black card. It has `depthWrite` off and never
occludes the swarm.

Keep the grade and backdrop **subtle and neutral**. They are the one place
the surface is allowed to editorialize; they must not tint node-type
colors or drown the bloom that carries real runtime state.

## UI chrome

Panels are glass (blur 10–14px, 1px `--axiom-glass-border`, inner cyan
glow). The inspector carries a slow holographic scanline sweep (~5.5s
loop) — the one decorative motion allowed in chrome, signalling "live
feed". Meters are liquid-fill: eased width transitions plus a travelling
shine. Buttons and tool chips respond to hover with a soft outer glow
(cyan for neutral actions, red for destructive).

## Extending the visual language

### 1. A new node type with its own look

```ts
engine.registerNodeType({
  id: "prolog-reasoner",
  label: "Prolog Reasoner",
  description: "Symbolic inference agent; resolves goals over the shared blackboard.",
  color: 0x3fbf5c,
  accentColor: 0x8affab,
  scale: 1.05,
  geometry: "geodesic",   // orb | geodesic | crystal | prism | toroid
  birthEffect: "burst",
});
```

That's the whole integration — the artifact system (shell, core, lattice,
halo, rings) assembles itself from these fields.

### 2. A new shell archetype

Add the variant to the `geometry` union in `engine/types.ts`, then add a
case to `shellGeometry()` in `GalaxyScene.ts` (geometries are cached and
shared across all nodes of a kind — build once). Keep silhouettes readable
at distance; detail that only reads close-up is wasted.

### 3. An ecosystem theme (e.g. Koodu resonance)

Themes must not break neutrality: agents that don't opt in keep the base
look. The supported pattern is metadata-driven — register ecosystem node
types whose `color`/`accentColor`/`geometry` encode the theme, and keep UI
chrome untouched. If a need exceeds `NodeTypeDefinition`, extend it with
optional fields and give `GalaxyScene` defaults for absent values so every
existing type keeps rendering unchanged.

### 4. New event visuals

New `GraphEvent` kinds (e.g. `policy_violation`) follow the birth/death
pattern: add the variant in `engine/types.ts`, emit it from the engine,
handle it in `GalaxyScene.handleEvent` with a transient effect, and give
it a line in `Hud.pushEvent`. Enforcement visuals use the danger hue;
creation visuals may use gold. Don't mint new meaning-colors casually.

## Do / Don't

- **Do** keep the void dark — contrast is what makes the bloom read.
- **Do** let hierarchy emerge from reputation/activity, never from labels.
- **Don't** animate UI chrome decoratively (the scanline is the one grant).
- **Don't** give two node types near-identical hues; the legend can't save
  you at galaxy zoom.
- **Don't** exceed ~1.3s for any transient effect; responsive, not theatrical.
- **Don't** add a visual channel without a runtime fact behind it.
