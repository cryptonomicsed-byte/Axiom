import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { AgentEdge, AgentNode, GraphEvent, NodeTypeDefinition } from "../engine/types";
import { assignPosition } from "./layout";
import {
  createCinematicPass,
  createRimMaterial,
  createVoidBackdrop,
  makeGlowTexture,
  makeStarFlareTexture,
} from "./postfx";

/** Reputation above which a node earns an anamorphic flare + god-ray shafts. */
const FLARE_THRESHOLD = 0.6;

const EDGE_PARTICLES = 6;
const GOLD = 0xffd27a;
const DANGER = 0xff5c7a;

/**
 * Shell archetypes. Geometries are built once per kind and shared across
 * every node of that kind — materials are per-node (they animate), geometry
 * is not.
 */
const shellGeometryCache = new Map<string, THREE.BufferGeometry>();
function shellGeometry(kind: NodeTypeDefinition["geometry"]): THREE.BufferGeometry {
  const cached = shellGeometryCache.get(kind);
  if (cached) return cached;
  let geometry: THREE.BufferGeometry;
  switch (kind) {
    case "geodesic":
      geometry = new THREE.IcosahedronGeometry(1, 2);
      break;
    case "crystal":
      geometry = new THREE.OctahedronGeometry(1, 0);
      geometry.scale(0.8, 1.55, 0.8);
      break;
    case "prism":
      geometry = new THREE.CylinderGeometry(0.85, 0.85, 1.7, 6, 1);
      break;
    case "toroid":
      geometry = new THREE.TorusGeometry(0.85, 0.3, 24, 48);
      break;
    case "orb":
    default:
      geometry = new THREE.SphereGeometry(1, 40, 28);
      break;
  }
  shellGeometryCache.set(kind, geometry);
  return geometry;
}

/** How many orbit rings an agent has earned. Reputation IS the hierarchy. */
function ringCountFor(reputation: number): number {
  if (reputation > 0.72) return 2;
  if (reputation > 0.45) return 1;
  return 0;
}

interface OrbitRing {
  mesh: THREE.Mesh;
  axis: THREE.Vector3;
  speed: number;
}

interface NodeVisual {
  group: THREE.Group;
  shell: THREE.Mesh;
  shellMaterial: THREE.MeshPhysicalMaterial;
  rim: THREE.Mesh;
  rimMaterial: THREE.ShaderMaterial;
  lattice: THREE.Mesh;
  latticeMaterial: THREE.MeshBasicMaterial;
  core: THREE.Mesh;
  coreMaterial: THREE.MeshBasicMaterial;
  innerCore: THREE.Mesh;
  innerCoreMaterial: THREE.MeshBasicMaterial;
  halo: THREE.Sprite;
  /** Anamorphic lens flare + god-ray read, only lit for high-reputation nodes. */
  flare: THREE.Sprite;
  flareMaterial: THREE.SpriteMaterial;
  orbitGroup: THREE.Group;
  rings: OrbitRing[];
  ringCount: number;
  selectionRings: THREE.Mesh[];
  node: AgentNode;
  baseScale: number;
  /** Random phase so pulses don't sync across the swarm. */
  phase: number;
  spinAxis: THREE.Vector3;
}

/** Expanding holographic disc emitted when a node is selected. */
interface ScanPulse {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  bornAt: number;
  lifeMs: number;
  maxRadius: number;
}

interface EdgeVisual {
  line: THREE.Line;
  lineMaterial: THREE.LineBasicMaterial;
  particles: THREE.Points;
  particleMaterial: THREE.PointsMaterial;
  edge: AgentEdge;
}

/** A glowing orb travelling along an edge — one discrete A2A message. */
interface DataPacket {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  sourceId: string;
  targetId: string;
  bornAt: number;
  lifeMs: number;
}

/** Transient particle effect (birth supernova / death implosion) with a TTL. */
interface TransientEffect {
  points: THREE.Points;
  material: THREE.PointsMaterial;
  velocities: Float32Array;
  bornAt: number;
  lifeMs: number;
  inward: boolean;
}

export type NodeClickHandler = (node: AgentNode | null) => void;

/**
 * Owns the Three.js scene. Nodes render as composite "celestial artifacts":
 * an iridescent physical shell, an emissive breathing core, an internal
 * wireframe lattice, and reputation-earned orbit rings. Every visual channel
 * maps to live runtime state — activity drives pulse rate and orbit speed,
 * reputation drives size/rings/glow, messages drive edge streams and data
 * packets. The scene knows nothing about frameworks; visuals derive entirely
 * from each node's NodeTypeDefinition plus its live AgentNode fields.
 */
export class GalaxyScene {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private clock = new THREE.Clock();
  private glowTexture = makeGlowTexture();
  private flareTexture = makeStarFlareTexture();
  private cinematicPass: ShaderPass;

  private nodeVisuals = new Map<string, NodeVisual>();
  private edgeVisuals = new Map<string, EdgeVisual>();
  private nodeTypes = new Map<string, NodeTypeDefinition>();
  private effects: TransientEffect[] = [];
  private packets: DataPacket[] = [];
  private scanPulses: ScanPulse[] = [];
  private nebulae: { sprite: THREE.Sprite; basePosition: THREE.Vector3; drift: number }[] = [];

  private selectedId: string | null = null;
  private hoveredId: string | null = null;
  private swarmActivity = 0;
  private followMode = false;

  private onNodeClick: NodeClickHandler = () => {};

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 12, 26);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.7;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 120;

    this.scene.add(new THREE.AmbientLight(0x8890c0, 0.35));
    const key = new THREE.PointLight(0xbfd4ff, 1.4);
    key.position.set(25, 35, 20);
    this.scene.add(key);
    const rim = new THREE.PointLight(0x8a5cff, 0.8);
    rim.position.set(-30, -15, -25);
    this.scene.add(rim);

    this.scene.add(createVoidBackdrop());
    this.buildStarfield();
    this.buildNebulae();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      0.95, // strength — glow reads as energy; kept below full white-out
      0.7, // radius
      0.16 // threshold — only the genuinely hot emitters bloom, keeps forms readable
    );
    this.composer.addPass(bloom);
    // Cinematic grade sits last: aberration, vignette, grain, scanlines.
    this.cinematicPass = createCinematicPass();
    this.composer.addPass(this.cinematicPass);

    this.renderer.domElement.addEventListener("click", (event) => this.handleClick(event));
    this.renderer.domElement.addEventListener("pointermove", (event) => this.handlePointerMove(event));
    window.addEventListener("resize", () => this.handleResize());

    this.animate();
  }

  setNodeClickHandler(handler: NodeClickHandler): void {
    this.onNodeClick = handler;
  }

  setNodeTypes(defs: NodeTypeDefinition[]): void {
    this.nodeTypes = new Map(defs.map((d) => [d.id, d]));
  }

  /** Cinematic follow: camera target eases toward the most active agent. */
  setFollowMode(enabled: boolean): void {
    this.followMode = enabled;
  }

  /** Reconciles the scene against the latest graph snapshot. */
  update(nodes: AgentNode[], edges: AgentEdge[]): void {
    this.reconcileNodes(nodes);
    this.reconcileEdges(edges);
    const active = nodes.filter((n) => n.status === "active");
    this.swarmActivity =
      active.length === 0 ? 0 : active.reduce((sum, n) => sum + n.activity, 0) / active.length;
  }

  /** Plays transient effects for discrete runtime events. */
  handleEvent(event: GraphEvent): void {
    if (event.kind === "node_spawned") {
      const def = this.nodeTypes.get(event.node.typeId);
      if ((def?.birthEffect ?? "burst") === "none") return;
      // Position may not be reconciled yet — defer one frame so the visual exists.
      requestAnimationFrame(() => {
        const visual = this.nodeVisuals.get(event.node.id);
        if (visual) {
          // Supernova: gold flash wrapped around the type's own accent.
          this.spawnBurst(visual.group.position, GOLD, false, 26);
          this.spawnBurst(visual.group.position, def?.accentColor ?? def?.color ?? 0xffffff, false, 34);
        }
      });
    } else if (event.kind === "node_died") {
      const visual = this.nodeVisuals.get(event.nodeId);
      if (visual) {
        this.spawnBurst(visual.group.position, DANGER, true, 40);
      }
    } else if (event.kind === "message_pulse") {
      this.spawnPacket(event.sourceId, event.targetId);
    }
  }

  focusOn(nodeId: string): void {
    this.selectedId = nodeId;
    const visual = this.nodeVisuals.get(nodeId);
    if (visual) {
      const def = this.nodeTypes.get(visual.node.typeId);
      this.spawnScanPulse(visual.group.position, def?.accentColor ?? def?.color ?? 0x4fd1ff);
    }
  }

  clearFocus(): void {
    this.selectedId = null;
  }

  dispose(): void {
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  // --- Node artifacts ------------------------------------------------------

  private buildNodeVisual(node: AgentNode, position: [number, number, number]): NodeVisual {
    const def = this.nodeTypes.get(node.typeId);
    const color = def?.color ?? 0x888888;
    const accent = def?.accentColor ?? color;

    // Outer energy shell: iridescent clearcoat "liquid metal / glass" look.
    const shellMaterial = new THREE.MeshPhysicalMaterial({
      color,
      metalness: 0.55,
      roughness: 0.18,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      iridescence: 0.55,
      iridescenceIOR: 1.4,
      emissive: color,
      emissiveIntensity: 0.12,
      transparent: true,
      opacity: 0.92,
    });
    const shell = new THREE.Mesh(shellGeometry(def?.geometry ?? "orb"), shellMaterial);
    shell.userData.nodeId = node.id;

    // Fresnel energy skin: transparent head-on, blazing at the silhouette —
    // turns the solid shell into a glowing hologram. Intensity is live.
    const rimMaterial = createRimMaterial(accent);
    const rim = new THREE.Mesh(shellGeometry(def?.geometry ?? "orb"), rimMaterial);
    rim.scale.setScalar(1.14);

    // Internal lattice: faint wireframe skeleton visible through the shell.
    const latticeMaterial = new THREE.MeshBasicMaterial({
      color: accent,
      wireframe: true,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
    });
    const lattice = new THREE.Mesh(shellGeometry(def?.geometry ?? "orb"), latticeMaterial);
    lattice.scale.setScalar(1.04);

    // Breathing core: the agent's "heart", brightest emitter under bloom.
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.95,
    });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), coreMaterial);

    // Inner core: a small near-white singularity, the hottest emitter — reads
    // as a plasma nucleus through the translucent outer core under bloom.
    const innerCoreMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
    });
    const innerCore = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), innerCoreMaterial);

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: accent,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    halo.scale.setScalar(4.5);

    // Anamorphic lens flare + god-ray read: dark until reputation crosses the
    // flare threshold, then a wide horizontal streak marks the "capital ship".
    const flareMaterial = new THREE.SpriteMaterial({
      map: this.flareTexture,
      color: accent,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const flare = new THREE.Sprite(flareMaterial);
    flare.scale.set(16, 16, 1);

    // Orbit system: rings + micro-particles, earned by reputation.
    const orbitGroup = new THREE.Group();

    // Holographic selection rings (hidden until selected).
    const selectionRings: THREE.Mesh[] = [];
    for (const tilt of [0, Math.PI / 3]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.1, 0.02, 8, 64),
        new THREE.MeshBasicMaterial({
          color: 0x4fd1ff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      ring.rotation.x = Math.PI / 2 + tilt;
      selectionRings.push(ring);
    }

    const group = new THREE.Group();
    group.add(shell, rim, lattice, core, innerCore, halo, flare, orbitGroup, ...selectionRings);
    group.position.set(...position);
    this.scene.add(group);

    const visual: NodeVisual = {
      group,
      shell,
      shellMaterial,
      rim,
      rimMaterial,
      lattice,
      latticeMaterial,
      core,
      coreMaterial,
      innerCore,
      innerCoreMaterial,
      halo,
      flare,
      flareMaterial,
      orbitGroup,
      rings: [],
      ringCount: -1,
      selectionRings,
      node,
      baseScale: def?.scale ?? 1,
      phase: Math.random() * Math.PI * 2,
      spinAxis: new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5).normalize(),
    };
    this.syncRings(visual);
    return visual;
  }

  /** Rebuilds the orbit-ring set when an agent's reputation tier changes. */
  private syncRings(visual: NodeVisual): void {
    const desired = ringCountFor(visual.node.reputation);
    if (desired === visual.ringCount) return;
    visual.ringCount = desired;

    for (const ring of visual.rings) {
      visual.orbitGroup.remove(ring.mesh);
      ring.mesh.geometry.dispose();
      (ring.mesh.material as THREE.Material).dispose();
    }
    visual.rings = [];

    const def = this.nodeTypes.get(visual.node.typeId);
    const accent = def?.accentColor ?? def?.color ?? 0xffffff;
    for (let i = 0; i < desired; i++) {
      const radius = 1.55 + i * 0.4;
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.018, 8, 56),
        new THREE.MeshBasicMaterial({
          color: accent,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      visual.orbitGroup.add(mesh);
      visual.rings.push({
        mesh,
        axis: new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5).normalize(),
        speed: 0.4 + Math.random() * 0.5,
      });
    }
  }

  private reconcileNodes(nodes: AgentNode[]): void {
    const seen = new Set<string>();
    nodes.forEach((node, index) => {
      seen.add(node.id);
      const existing = this.nodeVisuals.get(node.id);
      const position = assignPosition(node, index);

      if (!existing) {
        const visual = this.buildNodeVisual(node, position);
        visual.group.scale.setScalar(0.001);
        this.nodeVisuals.set(node.id, visual);
        this.animateSpawn(visual.group);
      } else {
        existing.node = node;
        existing.group.position.set(...position);
        existing.shellMaterial.opacity = node.status === "degraded" ? 0.45 : 0.92;
        this.syncRings(existing);
      }
    });

    for (const [id, visual] of this.nodeVisuals) {
      if (!seen.has(id)) {
        this.scene.remove(visual.group);
        visual.shellMaterial.dispose();
        visual.rimMaterial.dispose();
        visual.latticeMaterial.dispose();
        visual.core.geometry.dispose();
        visual.coreMaterial.dispose();
        visual.innerCore.geometry.dispose();
        visual.innerCoreMaterial.dispose();
        (visual.halo.material as THREE.Material).dispose();
        visual.flareMaterial.dispose();
        for (const ring of visual.rings) {
          ring.mesh.geometry.dispose();
          (ring.mesh.material as THREE.Material).dispose();
        }
        for (const ring of visual.selectionRings) {
          ring.geometry.dispose();
          (ring.material as THREE.Material).dispose();
        }
        this.nodeVisuals.delete(id);
        if (this.selectedId === id) this.selectedId = null;
        if (this.hoveredId === id) this.hoveredId = null;
      }
    }
  }

  // --- Edges & packets ------------------------------------------------------

  private reconcileEdges(edges: AgentEdge[]): void {
    const seen = new Set<string>();

    for (const edge of edges) {
      const source = this.nodeVisuals.get(edge.sourceId);
      const target = this.nodeVisuals.get(edge.targetId);
      if (!source || !target) continue;
      seen.add(edge.id);

      const existing = this.edgeVisuals.get(edge.id);
      if (!existing) {
        const def = this.nodeTypes.get(source.node.typeId);
        const color = def?.accentColor ?? def?.color ?? 0x4fd1ff;

        const lineGeometry = new THREE.BufferGeometry();
        lineGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
        const lineMaterial = new THREE.LineBasicMaterial({
          color: 0x4fd1ff,
          transparent: true,
          opacity: 0.16,
          blending: THREE.AdditiveBlending,
        });
        const line = new THREE.Line(lineGeometry, lineMaterial);

        const particleGeometry = new THREE.BufferGeometry();
        particleGeometry.setAttribute(
          "position",
          new THREE.BufferAttribute(new Float32Array(EDGE_PARTICLES * 3), 3)
        );
        const particleMaterial = new THREE.PointsMaterial({
          map: this.glowTexture,
          color,
          size: 0.5,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const particles = new THREE.Points(particleGeometry, particleMaterial);

        this.scene.add(line, particles);
        this.edgeVisuals.set(edge.id, { line, lineMaterial, particles, particleMaterial, edge });
      } else {
        existing.edge = edge;
      }
    }

    for (const [id, visual] of this.edgeVisuals) {
      if (!seen.has(id)) {
        this.scene.remove(visual.line, visual.particles);
        visual.line.geometry.dispose();
        visual.lineMaterial.dispose();
        visual.particles.geometry.dispose();
        visual.particleMaterial.dispose();
        this.edgeVisuals.delete(id);
      }
    }
  }

  /** One discrete A2A message rendered as a bright orb travelling the edge. */
  private spawnPacket(sourceId: string, targetId: string): void {
    if (this.packets.length > 40) return; // hard cap; the streams still show volume
    const source = this.nodeVisuals.get(sourceId);
    if (!source) return;
    const def = this.nodeTypes.get(source.node.typeId);
    const material = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: def?.accentColor ?? 0x4fd1ff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar(1.1);
    sprite.position.copy(source.group.position);
    this.scene.add(sprite);
    this.packets.push({
      sprite,
      material,
      sourceId,
      targetId,
      bornAt: performance.now(),
      lifeMs: 900,
    });
  }

  /** Holographic ring that projects outward from a node the instant it's selected. */
  private spawnScanPulse(origin: THREE.Vector3, color: number): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.0, 64),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.scanPulses.push({
      mesh,
      material: mesh.material as THREE.MeshBasicMaterial,
      bornAt: performance.now(),
      lifeMs: 900,
      maxRadius: 6,
    });
  }

  // --- Per-frame animation ---------------------------------------------------

  private tickVisuals(elapsed: number, delta: number): void {
    for (const visual of this.nodeVisuals.values()) {
      const { node, shellMaterial, latticeMaterial, core, coreMaterial, innerCore, innerCoreMaterial, halo, group } =
        visual;
      const isSelected = node.id === this.selectedId;
      const isHovered = node.id === this.hoveredId;

      // Core breath: rate and depth keyed to live activity.
      const breath = 0.5 + 0.5 * Math.sin(elapsed * (1.2 + node.activity * 3.5) + visual.phase);
      const coreScale = 0.75 + breath * (0.35 + node.activity * 0.5);
      core.scale.setScalar(coreScale);
      coreMaterial.opacity = 0.55 + breath * 0.45;
      // Inner nucleus pulses counter to the breath so the core has depth.
      innerCore.scale.setScalar(0.7 + breath * 0.6);
      innerCoreMaterial.opacity = 0.55 + node.activity * 0.3;

      // Shell emissive + halo: reputation raises the floor, selection spikes it.
      let shellGlow = 0.1 + node.reputation * 0.25 + node.activity * 0.3 * breath;
      if (isSelected) shellGlow += 0.55;
      else if (isHovered) shellGlow += 0.3;
      shellMaterial.emissiveIntensity = shellGlow;
      latticeMaterial.opacity = 0.08 + node.activity * 0.18;

      // Fresnel skin: activity animates the silhouette glow; focus intensifies.
      let rimGlow = 0.28 + node.activity * 0.5 + node.reputation * 0.2 + breath * 0.12;
      if (isSelected) rimGlow += 0.6;
      else if (isHovered) rimGlow += 0.35;
      visual.rimMaterial.uniforms.uIntensity.value = rimGlow;
      visual.rim.rotation.copy(visual.shell.rotation);

      halo.material.opacity =
        0.16 + node.reputation * 0.18 + node.activity * 0.2 + (isSelected ? 0.25 : 0);
      halo.scale.setScalar(4 + node.reputation * 2.5);

      // Anamorphic flare / god-ray: only high-reputation nodes earn it, and it
      // twinkles with activity so the brightest agent visibly throbs.
      const flareStrength = Math.max(0, node.reputation - FLARE_THRESHOLD) / (1 - FLARE_THRESHOLD);
      const twinkle = 0.75 + 0.25 * Math.sin(elapsed * 3 + visual.phase);
      visual.flareMaterial.opacity =
        flareStrength * (0.28 + node.activity * 0.4) * twinkle + (isSelected ? flareStrength * 0.3 : 0);
      const flareSize = 7 + flareStrength * 10 + node.activity * 3;
      visual.flare.scale.set(flareSize, flareSize, 1);

      // Slow artifact rotation; orbit system spins with activity.
      visual.shell.rotateOnAxis(visual.spinAxis, delta * (0.15 + node.activity * 0.35));
      visual.lattice.rotation.copy(visual.shell.rotation);
      for (const ring of visual.rings) {
        ring.mesh.rotateOnAxis(ring.axis, delta * ring.speed * (0.4 + node.activity * 2.2));
      }

      // Holographic selection rings.
      for (const [i, ring] of visual.selectionRings.entries()) {
        const material = ring.material as THREE.MeshBasicMaterial;
        material.opacity += ((isSelected ? 0.5 : 0) - material.opacity) * 0.15;
        ring.rotation.z += delta * (i === 0 ? 0.8 : -0.6);
      }

      // Size hierarchy: reputation grows the artifact; focus adds a lift.
      const targetScale =
        visual.baseScale * (0.82 + node.reputation * 0.45) * (isSelected || isHovered ? 1.18 : 1);
      group.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);
    }

    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    for (const visual of this.edgeVisuals.values()) {
      const source = this.nodeVisuals.get(visual.edge.sourceId);
      const target = this.nodeVisuals.get(visual.edge.targetId);
      if (!source || !target) continue;
      from.copy(source.group.position);
      to.copy(target.group.position);

      const linePositions = visual.line.geometry.getAttribute("position") as THREE.BufferAttribute;
      linePositions.setXYZ(0, from.x, from.y, from.z);
      linePositions.setXYZ(1, to.x, to.y, to.z);
      linePositions.needsUpdate = true;
      visual.lineMaterial.opacity = 0.08 + visual.edge.activity * 0.38;

      // Plasma stream: particles flow source→target, speed/brightness ∝ activity.
      const particlePositions = visual.particles.geometry.getAttribute(
        "position"
      ) as THREE.BufferAttribute;
      for (let i = 0; i < EDGE_PARTICLES; i++) {
        const t = (elapsed * (0.12 + visual.edge.activity * 0.55) + i / EDGE_PARTICLES) % 1;
        particlePositions.setXYZ(
          i,
          from.x + (to.x - from.x) * t,
          from.y + (to.y - from.y) * t,
          from.z + (to.z - from.z) * t
        );
      }
      particlePositions.needsUpdate = true;
      visual.particleMaterial.opacity = visual.edge.activity * 0.85;
      visual.particleMaterial.size = 0.35 + visual.edge.activity * 0.35;
    }

    // Data packets ease along their edge and fade out on arrival.
    const now = performance.now();
    this.packets = this.packets.filter((packet) => {
      const source = this.nodeVisuals.get(packet.sourceId);
      const target = this.nodeVisuals.get(packet.targetId);
      const age = (now - packet.bornAt) / packet.lifeMs;
      if (age >= 1 || !source || !target) {
        this.scene.remove(packet.sprite);
        packet.material.dispose();
        return false;
      }
      const eased = 1 - Math.pow(1 - age, 2);
      packet.sprite.position.lerpVectors(source.group.position, target.group.position, eased);
      packet.material.opacity = age < 0.8 ? 1 : (1 - age) / 0.2;
      packet.sprite.scale.setScalar(1.1 - age * 0.5);
      return true;
    });

    // Selection scan-pulses: expand outward, billboard the camera, fade.
    this.scanPulses = this.scanPulses.filter((pulse) => {
      const age = (now - pulse.bornAt) / pulse.lifeMs;
      if (age >= 1) {
        this.scene.remove(pulse.mesh);
        pulse.mesh.geometry.dispose();
        pulse.material.dispose();
        return false;
      }
      const eased = 1 - Math.pow(1 - age, 3);
      pulse.mesh.scale.setScalar(0.5 + eased * pulse.maxRadius);
      pulse.mesh.quaternion.copy(this.camera.quaternion);
      pulse.material.opacity = (1 - age) * 0.9;
      return true;
    });

    // Transient birth/death effects.
    this.effects = this.effects.filter((effect) => {
      const age = (now - effect.bornAt) / effect.lifeMs;
      if (age >= 1) {
        this.scene.remove(effect.points);
        effect.points.geometry.dispose();
        effect.material.dispose();
        return false;
      }
      const positions = effect.points.geometry.getAttribute("position") as THREE.BufferAttribute;
      const direction = effect.inward ? -1 : 1;
      // Embers decelerate as they age.
      const drag = 1 - age * 0.6;
      for (let i = 0; i < positions.count; i++) {
        positions.setXYZ(
          i,
          positions.getX(i) + effect.velocities[i * 3] * direction * delta * drag,
          positions.getY(i) + effect.velocities[i * 3 + 1] * direction * delta * drag,
          positions.getZ(i) + effect.velocities[i * 3 + 2] * direction * delta * drag
        );
      }
      positions.needsUpdate = true;
      effect.material.opacity = 1 - age * age;
      return true;
    });

    // Nebulae drift and breathe with overall swarm energy.
    this.nebulae.forEach((nebula, i) => {
      const material = nebula.sprite.material as THREE.SpriteMaterial;
      material.opacity =
        0.045 + this.swarmActivity * 0.09 + 0.02 * Math.sin(elapsed * 0.25 + i * 2.1);
      nebula.sprite.position.x = nebula.basePosition.x + Math.sin(elapsed * 0.05 + i) * nebula.drift;
      nebula.sprite.position.y = nebula.basePosition.y + Math.cos(elapsed * 0.04 + i * 1.7) * nebula.drift * 0.6;
    });

    // Cinematic follow: ease the orbit target toward the busiest agent.
    if (this.followMode && this.nodeVisuals.size > 0) {
      let busiest: NodeVisual | null = null;
      for (const visual of this.nodeVisuals.values()) {
        if (!busiest || visual.node.activity > busiest.node.activity) busiest = visual;
      }
      if (busiest) {
        // World position: the scene itself rotates slowly.
        busiest.group.getWorldPosition(from);
        this.controls.target.lerp(from, 0.02);
      }
    }
  }

  // --- Effects & environment --------------------------------------------------

  private spawnBurst(origin: THREE.Vector3, color: number, inward: boolean, count: number): void {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = origin.x;
      positions[i * 3 + 1] = origin.y;
      positions[i * 3 + 2] = origin.z;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 2.5 + Math.random() * 5;
      velocities[i * 3] = speed * Math.sin(phi) * Math.cos(theta);
      velocities[i * 3 + 1] = speed * Math.cos(phi);
      velocities[i * 3 + 2] = speed * Math.sin(phi) * Math.sin(theta);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      map: this.glowTexture,
      color,
      size: 0.7,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    this.scene.add(points);
    this.effects.push({
      points,
      material,
      velocities,
      bornAt: performance.now(),
      lifeMs: inward ? 750 : 1250,
      inward,
    });
  }

  /** Three depth layers with distinct size/tint for parallax richness. */
  private buildStarfield(): void {
    const layers: { count: number; near: number; far: number; size: number; color: number }[] = [
      { count: 2200, near: 140, far: 260, size: 0.35, color: 0x7788bb },
      { count: 900, near: 90, far: 150, size: 0.55, color: 0x99aadd },
      { count: 260, near: 55, far: 95, size: 0.9, color: 0xcfd8ff },
    ];
    for (const layer of layers) {
      const positions = new Float32Array(layer.count * 3);
      for (let i = 0; i < layer.count; i++) {
        const radius = layer.near + Math.random() * (layer.far - layer.near);
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = radius * Math.cos(phi);
        positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const material = new THREE.PointsMaterial({
        color: layer.color,
        size: layer.size,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.85,
        map: this.glowTexture,
        depthWrite: false,
      });
      this.scene.add(new THREE.Points(geometry, material));
    }
  }

  private buildNebulae(): void {
    const clouds: { color: number; scale: number; position: [number, number, number] }[] = [
      { color: 0x2a3fbf, scale: 120, position: [-50, 5, -80] },
      { color: 0x7a2fbf, scale: 150, position: [40, -20, -110] },
      { color: 0x1f7a8c, scale: 100, position: [70, 25, -70] },
      { color: 0xbf2f6e, scale: 90, position: [-20, 35, -95] },
      { color: 0x8c6a1f, scale: 70, position: [10, -40, -85] },
    ];
    for (const cloud of clouds) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.glowTexture,
          color: cloud.color,
          transparent: true,
          opacity: 0.05,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      sprite.scale.setScalar(cloud.scale);
      sprite.position.set(...cloud.position);
      this.scene.add(sprite);
      this.nebulae.push({
        sprite,
        basePosition: new THREE.Vector3(...cloud.position),
        drift: 4 + Math.random() * 5,
      });
    }
  }

  private animateSpawn(group: THREE.Group): void {
    const start = performance.now();
    const duration = 700;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // Overshoot ease: artifacts arrive with a slight pop.
      const eased = 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
      group.scale.setScalar(Math.max(0.001, eased));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // --- Input & lifecycle --------------------------------------------------------

  private pickNode(event: MouseEvent): AgentNode | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = [...this.nodeVisuals.values()].map((v) => v.shell);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;
    const nodeId = hits[0].object.userData.nodeId as string;
    return this.nodeVisuals.get(nodeId)?.node ?? null;
  }

  private handleClick(event: MouseEvent): void {
    this.onNodeClick(this.pickNode(event));
  }

  private handlePointerMove(event: MouseEvent): void {
    const node = this.pickNode(event);
    this.hoveredId = node?.id ?? null;
    this.renderer.domElement.style.cursor = node ? "pointer" : "grab";
  }

  private handleResize(): void {
    const { clientWidth, clientHeight } = this.container;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight);
    this.composer.setSize(clientWidth, clientHeight);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.getElapsedTime();
    this.controls.update();
    this.scene.rotation.y += delta * 0.012;
    this.tickVisuals(elapsed, delta);
    this.cinematicPass.uniforms.uTime.value = elapsed;
    this.composer.render();
  };
}
