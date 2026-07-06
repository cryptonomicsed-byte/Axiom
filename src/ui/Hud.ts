import type { AgentEdge, AgentNode, GraphEvent } from "../engine/types";

const FEED_LIMIT = 7;

/**
 * Heads-up overlay: swarm-level stats plus a scrolling feed of discrete
 * runtime events (births, deaths, tool calls). This is the "the galaxy is
 * alive" ambient layer — purely reactive, no controls.
 */
export class Hud {
  private stats: HTMLElement;
  private feed: HTMLElement;
  private entries: string[] = [];

  constructor(container: HTMLElement, onFollowToggle: (enabled: boolean) => void) {
    const root = document.createElement("div");
    root.className = "axiom-hud";
    this.stats = document.createElement("div");
    this.stats.className = "axiom-hud__stats";

    const follow = document.createElement("button");
    follow.className = "axiom-hud__follow";
    follow.textContent = "◉ follow busiest";
    let enabled = false;
    follow.addEventListener("click", () => {
      enabled = !enabled;
      follow.classList.toggle("axiom-hud__follow--on", enabled);
      onFollowToggle(enabled);
    });

    this.feed = document.createElement("ul");
    this.feed.className = "axiom-hud__feed";
    root.append(this.stats, follow, this.feed);
    container.appendChild(root);
  }

  updateStats(nodes: AgentNode[], edges: AgentEdge[]): void {
    const active = nodes.filter((n) => n.status === "active").length;
    const avgActivity =
      nodes.length === 0
        ? 0
        : Math.round((nodes.reduce((sum, n) => sum + n.activity, 0) / nodes.length) * 100);
    this.stats.innerHTML = `
      <span><strong>${nodes.length}</strong> agents</span>
      <span><strong>${active}</strong> active</span>
      <span><strong>${edges.length}</strong> channels</span>
      <span><strong>${avgActivity}%</strong> swarm activity</span>
    `;
  }

  pushEvent(event: GraphEvent): void {
    let text: string | null = null;
    switch (event.kind) {
      case "node_spawned":
        text = `✶ ${event.node.label} born (${event.node.framework})`;
        break;
      case "node_died":
        text = `✝ ${event.label} terminated · ${event.receipt}`;
        break;
      case "tool_invoked":
        text = `⚙ tool "${event.tool}" → ${event.result}`;
        break;
      case "message_pulse":
      case "node_updated":
        return; // too chatty for the feed; visualized in the scene instead
    }
    if (!text) return;
    this.entries.unshift(text);
    this.entries = this.entries.slice(0, FEED_LIMIT);
    this.feed.innerHTML = this.entries.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("");
  }
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}
