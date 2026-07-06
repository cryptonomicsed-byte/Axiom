# AXIOM Galaxy — Visual Style Guide

The base visual language is **dark cyber-minimal**: a near-black indigo
void, cool muted UI chrome, and all saturated color reserved for *agents
and their activity*. The rule of thumb: **chrome recedes, runtime glows**.
Anything luminous on screen should correspond to something real happening
in the runtime.

## Palette

| Token | Value | Role |
|---|---|---|
| `--axiom-bg` | `#05060f` | void background |
| `--axiom-glass` | `rgba(16,19,33,0.55)` | glass panel fill (with `backdrop-filter: blur`) |
| `--axiom-glass-border` | `rgba(122,138,200,0.25)` | glass panel edge |
| `--axiom-text` | `#e6e8f5` | primary text |
| `--axiom-muted` | `#9aa0c3` | secondary text |
| `--axiom-accent` | `#4fd1ff` | neutral runtime accent (edges, buttons, tool chips) |
| danger | `#ff5c7a` | termination, policy violations |

Node colors belong to **node types**, not to the theme. The five shipped
defaults (orange leaf, violet core, teal fabric, gold surface, magenta
compute) were chosen to stay distinguishable against the indigo void and
under additive bloom; when adding types, prefer saturated hues in the
0.55–0.75 lightness band and always provide a brighter `accentColor` for
the core glow and particles.

## Motion language

Every animation maps to a runtime fact — nothing moves "just because":

| Visual | Runtime meaning |
|---|---|
| Core pulse (emissive breathing) | agent's live `activity` level; frequency and brightness both scale with it |
| Edge particle stream | direction + volume of A2A messages; speed and opacity follow edge `activity` |
| Birth burst (outward particles) | `node_spawned` — a real process came into existence |
| Implosion (inward red particles) | `node_died` — real termination, paired with a receipt in the HUD feed |
| Node scale-up on hover/select | inspection focus; +25% scale, boosted emissive |
| Nebula breathing | aggregate swarm activity (ambient, deliberately subtle) |
| Slow global scene rotation | none — ambience only, and the single allowed exception |

Timing conventions: births ~1.1s, deaths ~0.7s (deaths should feel abrupt),
hover transitions ~0.12 lerp factor, UI transitions 150–350ms ease.

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
  geometry: "icosahedron",
  birthEffect: "burst",
});
```

That's the whole integration — any agent spawned with
`typeId: "prolog-reasoner"` renders with these visuals, appears in the
legend and spawn panel, and its edges/particles pick up the accent color.

### 2. An ecosystem theme (e.g. Koodu resonance)

Themes must not break neutrality: agents that don't opt in keep the base
look. The supported pattern is *metadata-driven*, layered on top of node
types:

- Register ecosystem-specific node types whose `color`/`accentColor`/
  `geometry` encode the theme (e.g. archetype-keyed hues, 7-day cycle
  pulse phase via distinct types per phase).
- Keep UI chrome untouched — the theme lives in the agents, not the panels.
- If a future need exceeds what `NodeTypeDefinition` expresses (custom
  shaders, per-node textures), extend `NodeTypeDefinition` with optional
  fields and give `GalaxyScene` a default for absent values, so every
  existing type keeps rendering unchanged.

### 3. New event visuals

New `GraphEvent` kinds (e.g. `policy_violation`) should follow the same
pattern as births/deaths: add the variant in `engine/types.ts`, emit it
from the engine, and handle it in `GalaxyScene.handleEvent` with a
transient effect plus an entry in `Hud.pushEvent`. Danger/enforcement
visuals use the danger hue (`#ff5c7a`) so the meaning stays consistent.

## Do / Don't

- **Do** keep the void dark — contrast is what makes the bloom read.
- **Do** map brightness to activity; an idle swarm should look calm.
- **Don't** animate UI chrome decoratively; motion is runtime semantics.
- **Don't** give two node types near-identical hues; the legend can't save
  you at galaxy zoom.
- **Don't** exceed ~1.3s for any transient effect; the galaxy should feel
  responsive, not theatrical.
