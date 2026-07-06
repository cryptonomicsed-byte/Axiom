import type { AgentNode, GraphEngine } from "../engine/types";

/**
 * Side panel showing the selected node's live metadata, exposed tools, and
 * memory summary, plus a terminate action. Framework-agnostic: it only
 * reads the AgentNode shape, never anything framework-specific.
 */
export class NodeInspector {
  private root: HTMLDivElement;

  constructor(container: HTMLElement, private engine: GraphEngine) {
    this.root = document.createElement("div");
    this.root.className = "axiom-inspector axiom-inspector--empty";
    container.appendChild(this.root);
    this.renderEmpty();
  }

  show(node: AgentNode): void {
    this.root.classList.remove("axiom-inspector--empty");
    const def = this.engine.getNodeTypes().find((d) => d.id === node.typeId);
    const colorHex = def ? `#${def.color.toString(16).padStart(6, "0")}` : "#888";

    this.root.innerHTML = `
      <div class="axiom-inspector__header" style="border-color:${colorHex}">
        <span class="axiom-inspector__swatch" style="background:${colorHex}"></span>
        <div>
          <h2>${escapeHtml(node.label)}</h2>
          <p class="axiom-inspector__sub">${escapeHtml(node.framework)} &middot; ${escapeHtml(def?.label ?? node.typeId)}</p>
        </div>
      </div>
      <dl class="axiom-inspector__meta">
        <dt>Status</dt><dd>${escapeHtml(node.status)}</dd>
        <dt>Reputation</dt><dd>${node.reputation.toFixed(2)}</dd>
        <dt>Node ID</dt><dd class="axiom-inspector__mono">${escapeHtml(node.id)}</dd>
      </dl>
      <h3>Tools / Capabilities</h3>
      <ul class="axiom-inspector__caps">
        ${node.capabilities
          .map((c) => `<li><strong>${escapeHtml(c.name)}</strong><span>${escapeHtml(c.description)}</span></li>`)
          .join("") || "<li><em>none exposed</em></li>"}
      </ul>
      <h3>Memory</h3>
      <p class="axiom-inspector__memory">${escapeHtml(node.memorySummary)}</p>
      <button class="axiom-btn axiom-btn--danger" id="axiom-terminate">Terminate node</button>
    `;

    this.root.querySelector("#axiom-terminate")?.addEventListener("click", () => {
      this.engine.terminateNode(node.id);
      this.renderEmpty();
    });
  }

  private renderEmpty(): void {
    this.root.classList.add("axiom-inspector--empty");
    this.root.innerHTML = `<p class="axiom-inspector__placeholder">Click a node to inspect it.</p>`;
  }
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}
