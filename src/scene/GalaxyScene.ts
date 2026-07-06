import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { AgentEdge, AgentNode, NodeTypeDefinition } from "../engine/types";
import { assignPosition } from "./layout";

function makeGeometry(kind: NodeTypeDefinition["geometry"]): THREE.BufferGeometry {
  switch (kind) {
    case "icosahedron":
      return new THREE.IcosahedronGeometry(1, 0);
    case "box":
      return new THREE.BoxGeometry(1.4, 1.4, 1.4);
    case "octahedron":
      return new THREE.OctahedronGeometry(1, 0);
    case "torus":
      return new THREE.TorusGeometry(0.8, 0.28, 12, 24);
    case "sphere":
    default:
      return new THREE.SphereGeometry(1, 24, 16);
  }
}

interface NodeMesh {
  mesh: THREE.Mesh;
  node: AgentNode;
}

interface EdgeLine {
  line: THREE.Line;
  material: THREE.LineBasicMaterial;
  edge: AgentEdge;
}

export type NodeClickHandler = (node: AgentNode | null) => void;

/**
 * Owns the Three.js scene: renders whatever nodes/edges the GraphEngine
 * currently reports, on every update, without caring which framework backs
 * any given node. Visuals are entirely driven by the NodeTypeDefinition the
 * node references, so new pluggable types "just render" once registered.
 */
export class GalaxyScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private nodeMeshes = new Map<string, NodeMesh>();
  private edgeLines = new Map<string, EdgeLine>();
  private nodeTypes = new Map<string, NodeTypeDefinition>();

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

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const point = new THREE.PointLight(0xffffff, 1.2);
    point.position.set(20, 30, 20);
    this.scene.add(point);

    const starField = this.buildStarField();
    this.scene.add(starField);

    this.renderer.domElement.addEventListener("click", (event) => this.handleClick(event));
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
    this.reconcileEdges(edges, nodes);
  }

  focusOn(nodeId: string): void {
    for (const [id, { mesh }] of this.nodeMeshes) {
      const isSelected = id === nodeId;
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.emissiveIntensity = isSelected ? 1.4 : 0.35;
    }
  }

  dispose(): void {
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  private reconcileNodes(nodes: AgentNode[]): void {
    const seen = new Set<string>();
    nodes.forEach((node, index) => {
      seen.add(node.id);
      const existing = this.nodeMeshes.get(node.id);
      const def = this.nodeTypes.get(node.typeId);
      const position = assignPosition(node, index);

      if (!existing) {
        const geometry = makeGeometry(def?.geometry ?? "sphere");
        const material = new THREE.MeshStandardMaterial({
          color: def?.color ?? 0x888888,
          emissive: def?.color ?? 0x888888,
          emissiveIntensity: 0.35,
          roughness: 0.35,
          metalness: 0.2,
        });
        const mesh = new THREE.Mesh(geometry, material);
        const scale = def?.scale ?? 1;
        mesh.scale.setScalar(scale);
        mesh.position.set(...position);
        mesh.userData.nodeId = node.id;
        mesh.scale.setScalar(0.001);
        this.scene.add(mesh);
        this.nodeMeshes.set(node.id, { mesh, node });
        this.animateSpawn(mesh, scale);
      } else {
        existing.node = node;
        existing.mesh.position.set(...position);
        const material = existing.mesh.material as THREE.MeshStandardMaterial;
        material.opacity = node.status === "degraded" ? 0.5 : 1;
        material.transparent = node.status === "degraded";
      }
    });

    for (const [id, { mesh }] of this.nodeMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.nodeMeshes.delete(id);
      }
    }
  }

  private reconcileEdges(edges: AgentEdge[], nodes: AgentNode[]): void {
    const nodeIndex = new Map(nodes.map((n) => [n.id, n]));
    const seen = new Set<string>();

    for (const edge of edges) {
      seen.add(edge.id);
      const sourceMesh = this.nodeMeshes.get(edge.sourceId)?.mesh;
      const targetMesh = this.nodeMeshes.get(edge.targetId)?.mesh;
      if (!sourceMesh || !targetMesh || !nodeIndex.has(edge.sourceId) || !nodeIndex.has(edge.targetId)) {
        continue;
      }

      const existing = this.edgeLines.get(edge.id);
      const positions = new Float32Array([
        sourceMesh.position.x,
        sourceMesh.position.y,
        sourceMesh.position.z,
        targetMesh.position.x,
        targetMesh.position.y,
        targetMesh.position.z,
      ]);

      if (!existing) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const material = new THREE.LineBasicMaterial({
          color: 0x4fd1ff,
          transparent: true,
          opacity: 0.2,
        });
        const line = new THREE.Line(geometry, material);
        this.scene.add(line);
        this.edgeLines.set(edge.id, { line, material, edge });
      } else {
        const geometry = existing.line.geometry as THREE.BufferGeometry;
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        existing.material.opacity = 0.15 + edge.activity * 0.75;
        existing.edge = edge;
      }
    }

    for (const [id, { line }] of this.edgeLines) {
      if (!seen.has(id)) {
        this.scene.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
        this.edgeLines.delete(id);
      }
    }
  }

  private animateSpawn(mesh: THREE.Mesh, targetScale: number): void {
    const start = performance.now();
    const duration = 500;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      mesh.scale.setScalar(0.001 + eased * targetScale);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private buildStarField(): THREE.Points {
    const count = 1200;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const radius = 60 + Math.random() * 140;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi);
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0x6677aa, size: 0.6, sizeAttenuation: true });
    return new THREE.Points(geometry, material);
  }

  private handleClick(event: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const meshes = [...this.nodeMeshes.values()].map((n) => n.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) {
      this.onNodeClick(null);
      return;
    }
    const hitMesh = hits[0].object as THREE.Mesh;
    const nodeId = hitMesh.userData.nodeId as string;
    const record = this.nodeMeshes.get(nodeId);
    this.onNodeClick(record?.node ?? null);
  }

  private handleResize(): void {
    const { clientWidth, clientHeight } = this.container;
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.scene.rotation.y += 0.0006;
    this.renderer.render(this.scene, this.camera);
  };
}
