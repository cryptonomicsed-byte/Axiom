import type { GraphEngine } from "../engine/types";

/**
 * Minimal control surface demonstrating "graph growth = dynamic agent
 * spawning": pick a registered type, spawn it, and it appears in the galaxy
 * immediately via the engine's own subscription — this panel never touches
 * the scene directly.
 */
export class SpawnPanel {
  constructor(container: HTMLElement, engine: GraphEngine) {
    const root = document.createElement("div");
    root.className = "axiom-spawn";

    const select = document.createElement("select");
    select.className = "axiom-spawn__select";
    for (const def of engine.getNodeTypes()) {
      const option = document.createElement("option");
      option.value = def.id;
      option.textContent = def.label;
      select.appendChild(option);
    }

    const label = document.createElement("input");
    label.className = "axiom-spawn__input";
    label.placeholder = "agent label";
    label.value = "new-agent";

    const button = document.createElement("button");
    button.className = "axiom-btn";
    button.textContent = "Spawn node";
    button.addEventListener("click", () => {
      const typeId = select.value;
      const def = engine.getNodeTypes().find((d) => d.id === typeId);
      const node = engine.spawnNode({
        typeId,
        label: label.value.trim() || "new-agent",
        framework: def?.label ?? "unknown",
      });
      const existing = engine.getNodes().filter((n) => n.id !== node.id);
      if (existing.length > 0) {
        const anchor = existing[Math.floor(Math.random() * existing.length)];
        engine.connect(anchor.id, node.id);
      }
    });

    root.append(select, label, button);
    container.appendChild(root);
  }
}
