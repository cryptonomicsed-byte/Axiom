import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { AgentEdge, AgentNode, GraphEvent, NodeTypeDefinition } from "../engine/types";
import { assignPosition } from "./layout";

const EDGE_PARTICLES = 5;

function makeGeometry(kind: NodeTypeDefinition["geometry"]): THREE.BufferGeometry {
  switch (kind) {
    case "icosahedron":
      return new THREE.IcosahedronGeometry(1, 1);
    case "box":
      return new THREE.BoxGeometry(1.4, 1.4, 1.4);
    case "octahedron":
      return new THREE.OctahedronGeometry(1, 0);
    case "torus":
      return new THREE.TorusGeometry(0.8, 0.28, 16, 32);
    case "sphere":
    default:
      return new THREE.SphereGeometry(1, 32, 24);
  }
}

/** Radial-gradient sprite texture shared by glows, nebulae, and particles. */
function makeGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.3, "rgba(255,255,255,0.45)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

interface NodeVisual {
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  halo: THREE.Sprite;
  node: AgentNode;
  baseScale: number;
  /** Random phase so pulses don't sync across the swarm. */
  phase: number;
}

interface EdgeVisual {
  line: THREE.Line;
  lineMaterial: THREE.LineBasicMaterial;
  particles: THREE.Points;
  particleMaterial: THREE.PointsMaterial;
  edge: AgentEdge;
}

/** Transient particle effect (birth burst / death implosion) with a TTL. */
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
 * Owns the Three.js scene: renders whatever nodes/edges the GraphEngine
 * currently reports, plus transient effects driven by discrete GraphEvents
 * (birth bursts, death dissolves, message pulses). Visuals are entirely
 * driven by each node's NodeTypeDefinition, so new pluggable types "just
 * render" once registered — the scene knows nothing about frameworks.
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

  private nodeVisuals = new Map<string, NodeVisual>();
  private edgeVisuals = new Map<string, EdgeVisual>();
  private nodeTypes = new Map<string, NodeTypeDefinition>();
  private effects: TransientEffect[] = [];
  private nebulae: THREE.Sprite[] = [];

  private selectedId: string | null = null;
  private hoveredId: string | null = null;
  private swarmActivity = 0;

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
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 120;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const point = new THREE.PointLight(0xffffff, 1.0);
    point.position.set(20, 30, 20);
    this.scene.add(point);

    this.scene.add(this.buildStarField());
    this.buildNebulae();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      0.9, // strength
      0.6, // radius
      0.12 // threshold — low so emissive cores and edge particles glow
    );
    this.composer.addPass(bloom);

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
          this.spawnBurst(visual.group.position, def?.accentColor ?? def?.color ?? 0xffffff, false);
        }
      });
    } else if (event.kind === "node_died") {
      const visual = this.nodeVisuals.get(event.nodeId);
      if (visual) {
        this.spawnBurst(visual.group.position, 0xff5c7a, true);
      }
    }
  }

  focusOn(nodeId: string): void {
    this.selectedId = nodeId;
  }

  clearFocus(): void {
    this.selectedId = null;
  }

  dispose(): void {
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  private reconcileNodes(nodes: AgentNode[]): void {
    const seen = new Set<string>();
    nodes.forEach((node, index) => {
      seen.add(node.id);
      const existing = this.nodeVisuals.get(node.id);
      const def = this.nodeTypes.get(node.typeId);
      const position = assignPosition(node, index);

      if (!existing) {
        const color = def?.color ?? 0x888888;
        const geometry = makeGeometry(def?.geometry ?? "sphere");
        const material = new THREE.MeshStandardMaterial({
          color,
          emissive: def?.accentColor ?? color,
          emissiveIntensity: 0.4,
          roughness: 0.3,
          metalness: 0.35,
          transparent: true,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.nodeId = node.id;

        const halo = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.glowTexture,
            color: def?.accentColor ?? color,
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          })
        );
        halo.scale.setScalar(4);

        const group = new THREE.Group();
        group.add(mesh, halo);
        group.position.set(...position);
        this.scene.add(group);

        const baseScale = def?.scale ?? 1;
        group.scale.setScalar(0.001);
        this.nodeVisuals.set(node.id, {
          group,
          mesh,
          material,
          halo,
          node,
          baseScale,
          phase: Math.random() * Math.PI * 2,
        });
        this.animateSpawn(group);
      } else {
        existing.node = node;
        existing.group.position.set(...position);
        existing.material.opacity = node.status === "degraded" ? 0.5 : 1;
      }
    });

    for (const [id, visual] of this.nodeVisuals) {
      if (!seen.has(id)) {
        this.scene.remove(visual.group);
        visual.mesh.geometry.dispose();
        visual.material.dispose();
        (visual.halo.material as THREE.Material).dispose();
        this.nodeVisuals.delete(id);
        if (this.selectedId === id) this.selectedId = null;
        if (this.hoveredId === id) this.hoveredId = null;
      }
    }
  }

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
          opacity: 0.18,
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
          size: 0.55,
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

  /** Per-frame updates: pulses, particle flow, transient effects, nebulae. */
  private tickVisuals(elapsed: number): void {
    for (const visual of this.nodeVisuals.values()) {
      const { node, material, halo, group, baseScale, phase } = visual;
      // Core pulse: breathing emissive keyed to the agent's live activity.
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * (1.5 + node.activity * 3) + phase);
      let intensity = 0.35 + node.activity * 0.9 * pulse;
      if (node.id === this.selectedId) intensity += 0.9;
      else if (node.id === this.hoveredId) intensity += 0.45;
      material.emissiveIntensity = intensity;
      halo.material.opacity = 0.18 + node.activity * 0.3 + (node.id === this.selectedId ? 0.25 : 0);

      const targetScale =
        baseScale * (node.id === this.hoveredId || node.id === this.selectedId ? 1.25 : 1);
      group.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.12);
      visual.mesh.rotation.y += 0.003 + node.activity * 0.01;
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
      visual.lineMaterial.opacity = 0.1 + visual.edge.activity * 0.4;

      // Particles stream from source to target; speed and brightness follow activity.
      const particlePositions = visual.particles.geometry.getAttribute(
        "position"
      ) as THREE.BufferAttribute;
      for (let i = 0; i < EDGE_PARTICLES; i++) {
        const t = (elapsed * (0.15 + visual.edge.activity * 0.5) + i / EDGE_PARTICLES) % 1;
        particlePositions.setXYZ(
          i,
          from.x + (to.x - from.x) * t,
          from.y + (to.y - from.y) * t,
          from.z + (to.z - from.z) * t
        );
      }
      particlePositions.needsUpdate = true;
      visual.particleMaterial.opacity = visual.edge.activity * 0.9;
    }

    // Transient birth/death effects.
    const now = performance.now();
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
      for (let i = 0; i < positions.count; i++) {
        positions.setXYZ(
          i,
          positions.getX(i) + effect.velocities[i * 3] * direction * 0.016,
          positions.getY(i) + effect.velocities[i * 3 + 1] * direction * 0.016,
          positions.getZ(i) + effect.velocities[i * 3 + 2] * direction * 0.016
        );
      }
      positions.needsUpdate = true;
      effect.material.opacity = 1 - age;
      return true;
    });

    // Nebulae breathe with overall swarm activity.
    this.nebulae.forEach((nebula, i) => {
      const material = nebula.material as THREE.SpriteMaterial;
      material.opacity = 0.05 + this.swarmActivity * 0.08 + 0.02 * Math.sin(elapsed * 0.3 + i * 2);
    });
  }

  private spawnBurst(origin: THREE.Vector3, color: number, inward: boolean): void {
    const count = 42;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = origin.x;
      positions[i * 3 + 1] = origin.y;
      positions[i * 3 + 2] = origin.z;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 2.5 + Math.random() * 4;
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
      lifeMs: inward ? 700 : 1100,
      inward,
    });
  }

  private buildStarField(): THREE.Points {
    const count = 1600;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const radius = 60 + Math.random() * 160;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi);
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0x8899cc,
      size: 0.5,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.8,
    });
    return new THREE.Points(geometry, material);
  }

  private buildNebulae(): void {
    const hues = [0x2a3fbf, 0x7a2fbf, 0x1f7a8c];
    for (let i = 0; i < 3; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.glowTexture,
          color: hues[i],
          transparent: true,
          opacity: 0.06,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      sprite.scale.setScalar(90 + i * 30);
      sprite.position.set((i - 1) * 45, (i % 2) * 20 - 10, -60 - i * 20);
      this.scene.add(sprite);
      this.nebulae.push(sprite);
    }
  }

  private animateSpawn(group: THREE.Group): void {
    const start = performance.now();
    const duration = 600;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      group.scale.setScalar(Math.max(0.001, eased));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private pickNode(event: MouseEvent): AgentNode | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = [...this.nodeVisuals.values()].map((v) => v.mesh);
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
    const elapsed = this.clock.getElapsedTime();
    this.controls.update();
    this.scene.rotation.y += 0.0004;
    this.tickVisuals(elapsed);
    this.composer.render();
  };
}
