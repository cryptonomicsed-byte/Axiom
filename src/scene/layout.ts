import type { AgentNode } from "../engine/types";

/**
 * Deterministic-ish spherical layout so nodes without an explicit position
 * spread out into a "galaxy" shape rather than stacking at the origin.
 * Uses a golden-angle spiral for even distribution.
 */
export function assignPosition(node: AgentNode, index: number): [number, number, number] {
  if (node.position) return node.position;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const radius = 4 + Math.sqrt(index) * 3.2;
  const theta = index * goldenAngle;
  const y = ((index % 7) - 3) * 1.4;
  return [radius * Math.cos(theta), y, radius * Math.sin(theta)];
}
