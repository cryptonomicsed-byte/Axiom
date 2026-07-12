import type { AgentNode, GraphEngine, NodeTypeDefinition } from "./types";

/**
 * WaggleFieldLink — the galaxy's live window onto the Waggle stigmergic
 * field (Connection Map v2 §2).
 *
 * - Registers the `waggle-hotspot`, `waggle-taboo` and `waggle-bounded`
 *   node types through the existing pluggability — the scene and UI need no
 *   changes to render them.
 * - Subscribes to the substrate's SSE event stream AND polls the weighted
 *   gradient, so hotspots appear where the swarm's attention actually is.
 * - Taboo territory gets its own type: slow-pulsing red-black, visually
 *   distinct from fast-decaying dead-end red — "ethically excluded" reads
 *   differently from "didn't work out" at a glance.
 * - Clicking a hotspot shows the sniff_explain breakdown in the existing
 *   NodeInspector memory panel: every signal's evidence tier, tier weight,
 *   and the cross-inhibitions suppressing it — the WHY behind the glow.
 * - Cross-inhibition is drawn, not implied: when a taboo/bounded source
 *   suppresses a gold reading, the link connects the two hotspots so the
 *   dampening is visually legible.
 * - `fieldStability()` feeds the Fractal Oracle's shell shader
 *   (uFieldStability): the escape-time visualization blends in real
 *   ecosystem-wide robustness, not only the sandboxed oracle's own scan.
 * - `onHottest` drives gradient-following camera auto-zoom.
 *
 * Fails soft everywhere: without a reachable substrate the galaxy simply
 * renders no field layer.
 */

const WAGGLE_NODE_TYPES: NodeTypeDefinition[] = [
  {
    id: "waggle-hotspot",
    label: "Waggle Hotspot",
    description:
      "A subtree of the stigmergic field ranked by trust-weighted scent. Glow follows the swarm's live attention; click for the sniff_explain evidence breakdown.",
    color: 0xffc94a,
    accentColor: 0xfff0b8,
    scale: 0.85,
    geometry: "orb",
    birthEffect: "ripple",
  },
  {
    id: "waggle-taboo",
    label: "Taboo Territory",
    description:
      "Ọbàtálá's ethical exclusion: slow-decay suppression with the justification in its memory panel. Not a dead-end — a judgment. Its dampening of nearby gold is drawn as a link.",
    color: 0x8a1020,
    accentColor: 0x2a0508,
    scale: 1.1,
    geometry: "crystal",
    birthEffect: "none",
  },
  {
    id: "waggle-bounded",
    label: "Bounded Verdict",
    description:
      "Mandelbrot robustness verdict from the shared fractal-oracle: bright = deep bounded island, dim = fragile escape zone. Replace-mode: re-measurement moves it.",
    color: 0x8a5cff,
    accentColor: 0xd0b8ff,
    scale: 0.9,
    geometry: "toroid",
    birthEffect: "ripple",
  },
];

interface HotspotEntry {
  nodeId: string;
  kind: "hotspot" | "taboo" | "bounded";
  lastTotal: number;
}

interface ExplainContribution {
  signal: {
    id: string;
    agent: string;
    kind: string;
    intensity: number;
    evidence_tier?: string;
  };
  tier_weight: number;
  inhibitions?: { source_kind: string; source_id: string; multiplier: number }[];
  effective: number;
}

export class WaggleFieldLink {
  private readonly base: string;
  private readonly engine: GraphEngine;
  private readonly pollMs: number;
  private byResource = new Map<string, HotspotEntry>();
  private inhibitionEdges = new Set<string>();
  private stability = 0.5; // neutral until the field says otherwise
  private hottestCb: ((nodeId: string) => void) | null = null;
  private timer: number | null = null;
  private sse: EventSource | null = null;
  private running = false;

  constructor(engine: GraphEngine, opts: { base?: string; pollMs?: number } = {}) {
    this.engine = engine;
    this.base = (opts.base ?? "http://127.0.0.1:7777").replace(/\/$/, "");
    this.pollMs = opts.pollMs ?? 4000;
  }

  /** Mean live bounded stability across the field, 0..1 — the shader feed. */
  fieldStability(): number {
    return this.stability;
  }

  onHottest(cb: (nodeId: string) => void): void {
    this.hottestCb = cb;
  }

  async start(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/.well-known/waggle.json`);
      const manifest = await res.json();
      if (manifest?.protocol !== "waggle/v1") return false;
    } catch {
      return false; // no substrate: the galaxy renders without a field layer
    }
    for (const def of WAGGLE_NODE_TYPES) this.engine.registerNodeType(def);
    this.running = true;
    this.openStream();
    const tick = () => {
      if (!this.running) return;
      void this.poll();
      this.timer = window.setTimeout(tick, this.pollMs);
    };
    tick();
    return true;
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.sse?.close();
  }

  // ── live stream: deposits pulse their hotspot immediately ────────────────

  private openStream(): void {
    try {
      this.sse = new EventSource(`${this.base}/v1/events`);
      this.sse.addEventListener("signal", (ev) => {
        try {
          const sig = JSON.parse((ev as MessageEvent).data)?.payload;
          if (!sig?.resource) return;
          const entry = this.byResource.get(this.groupOf(sig.resource));
          if (entry) this.touchNode(entry.nodeId, (n) => (n.activity = 1));
        } catch {
          /* malformed event: ignore */
        }
      });
    } catch {
      /* EventSource unavailable: polling still covers us */
    }
  }

  /** Hotspots are depth-2 rollups; group a leaf resource to its hotspot key. */
  private groupOf(resource: string): string {
    const i = resource.indexOf("://");
    const scheme = i >= 0 ? resource.slice(0, i + 3) : "";
    const rest = i >= 0 ? resource.slice(i + 3) : resource;
    const segs = rest.split("/").filter(Boolean);
    return scheme + segs.slice(0, 2).join("/");
  }

  // ── gradient poll: the hotspot constellation ────────────────────────────

  private async poll(): Promise<void> {
    let hotspots: {
      resource: string;
      total: number;
      by_kind: Record<string, number>;
      agents: string[];
      top_signal?: { evidence_tier?: string };
    }[];
    try {
      const res = await fetch(`${this.base}/v1/gradient?depth=2&k=14&weighted=1`);
      hotspots = (await res.json())?.hotspots ?? [];
    } catch {
      return;
    }

    const maxTotal = Math.max(1e-6, ...hotspots.map((h) => h.total));
    const seen = new Set<string>();
    let hottestNode: string | null = null;

    for (const h of hotspots) {
      seen.add(h.resource);
      const kind = this.classify(h.by_kind);
      let entry = this.byResource.get(h.resource);
      if (!entry) {
        const node = this.engine.spawnNode({
          typeId:
            kind === "taboo" ? "waggle-taboo" : kind === "bounded" ? "waggle-bounded" : "waggle-hotspot",
          label: h.resource,
          framework: "Waggle Field",
          capabilities: [
            { name: "sniff_explain", description: "Evidence-tier breakdown of this glow" },
          ],
        });
        entry = { nodeId: node.id, kind, lastTotal: 0 };
        this.byResource.set(h.resource, entry);
      }
      entry.lastTotal = h.total;
      if (!hottestNode) hottestNode = entry.nodeId; // gradient is sorted, first = hottest
      // taboo pulses slow and low no matter how strong the exclusion — the
      // slow red-black throb IS the visual signature
      const activity = kind === "taboo" ? 0.12 : Math.min(1, h.total / maxTotal);
      const reputation = this.tierWeight(h.top_signal?.evidence_tier);
      this.touchNode(entry.nodeId, (n) => {
        n.activity = activity;
        n.reputation = reputation;
        n.memorySummary = `field total ${h.total.toFixed(2)} — ${Object.entries(h.by_kind)
          .map(([k, v]) => `${k} ${v.toFixed(1)}`)
          .join(", ")} — ${h.agents.length} agent(s)`;
      });
      void this.attachExplain(h.resource, entry.nodeId);
    }

    // evaporated hotspots leave the galaxy like scent leaves the field
    for (const [resource, entry] of this.byResource) {
      if (!seen.has(resource)) {
        this.engine.terminateNode(entry.nodeId);
        this.byResource.delete(resource);
      }
    }

    void this.updateStability();
    if (hottestNode && this.hottestCb) this.hottestCb(hottestNode);
  }

  private classify(byKind: Record<string, number>): "hotspot" | "taboo" | "bounded" {
    const taboo = byKind["taboo"] ?? 0;
    const bounded = byKind["bounded"] ?? 0;
    const rest = Object.entries(byKind)
      .filter(([k]) => k !== "taboo" && k !== "bounded")
      .reduce((s, [, v]) => s + v, 0);
    if (taboo > 0 && taboo >= rest) return "taboo";
    if (bounded > rest) return "bounded";
    return "hotspot";
  }

  private tierWeight(tier?: string): number {
    const ladder: Record<string, number> = {
      "self-report": 0.2,
      corroborated: 0.4,
      "watch-derived": 0.6,
      "zangbeto-verified": 0.8,
      "on-chain-anchored": 1.0,
    };
    return ladder[tier ?? ""] ?? 0.2;
  }

  // ── sniff_explain into the inspector's memory panel (§2.7) ───────────────

  private async attachExplain(resource: string, nodeId: string): Promise<void> {
    let contributions: ExplainContribution[];
    let diffusion = 0;
    try {
      const res = await fetch(`${this.base}/v1/explain?resource=${encodeURIComponent(resource)}`);
      const ex = await res.json();
      contributions = ex?.contributions ?? [];
      diffusion = ex?.diffusion ?? 0;
    } catch {
      return;
    }
    const lines = contributions.slice(0, 6).map((c) => {
      const s = c.signal;
      const inhibit =
        c.inhibitions?.map((i) => ` ⊘${i.source_kind}×${i.multiplier.toFixed(2)}`).join("") ?? "";
      return `${s.kind} ${s.intensity.toFixed(2)} × ${s.evidence_tier ?? "self-report"}(${c.tier_weight}) → ${c.effective.toFixed(2)}${inhibit} [${s.agent}]`;
    });
    if (diffusion > 0) lines.push(`ambient diffusion from siblings +${diffusion.toFixed(2)}`);
    const now = Date.now();
    this.touchNode(nodeId, (n) => {
      n.memoryEvents = lines.map((text) => ({ at: now, text }));
    });

    // §2.8: draw the dampening — an inhibited gold links to its suppressor
    for (const c of contributions) {
      for (const inh of c.inhibitions ?? []) {
        const sourceEntry = [...this.byResource.values()].find(
          (e) => e.kind === (inh.source_kind === "taboo" ? "taboo" : "bounded"),
        );
        if (!sourceEntry || sourceEntry.nodeId === nodeId) continue;
        const key = `${sourceEntry.nodeId}->${nodeId}`;
        if (this.inhibitionEdges.has(key)) continue;
        this.inhibitionEdges.add(key);
        try {
          this.engine.connect(sourceEntry.nodeId, nodeId);
        } catch {
          /* nodes may have evaporated between poll and explain */
        }
      }
    }
  }

  // ── field-wide bounded stability for the oracle shader (§2.6) ────────────

  private async updateStability(): Promise<void> {
    try {
      const res = await fetch(`${this.base}/v1/sniff?kind=bounded&limit=100`);
      const sigs: { intensity: number }[] = (await res.json())?.signals ?? [];
      if (sigs.length === 0) return;
      const mean = sigs.reduce((s, x) => s + x.intensity, 0) / sigs.length / 10;
      this.stability = Math.max(0, Math.min(1, mean));
    } catch {
      /* keep the last known reading */
    }
  }

  /** Mutate a live node in place; the engine's next snapshot broadcasts it. */
  private touchNode(nodeId: string, fn: (n: AgentNode) => void): void {
    const node = this.engine.getNodes().find((n) => n.id === nodeId);
    if (node) fn(node);
  }
}
