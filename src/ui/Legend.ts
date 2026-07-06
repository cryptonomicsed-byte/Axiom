import type { NodeTypeDefinition } from "../engine/types";

/** Static legend mapping node color/shape back to its pluggable type. */
export class Legend {
  constructor(container: HTMLElement, defs: NodeTypeDefinition[]) {
    const root = document.createElement("div");
    root.className = "axiom-legend";
    root.innerHTML = defs
      .map((def) => {
        const hex = `#${def.color.toString(16).padStart(6, "0")}`;
        return `<div class="axiom-legend__row" title="${escapeAttr(def.description)}">
          <span class="axiom-legend__swatch" style="background:${hex}"></span>
          <span>${escapeAttr(def.label)}</span>
        </div>`;
      })
      .join("");
    container.appendChild(root);
  }
}

function escapeAttr(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}
