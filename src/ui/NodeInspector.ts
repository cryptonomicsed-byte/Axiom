import type { AgentNode, GraphEngine } from "../engine/types";

/**
 * Glassmorphic side panel showing the selected node's live metadata, exposed
 * tools (invocable directly), memory window, and direct-message console.
 * Framework-agnostic: it only reads the AgentNode shape, never anything
 * framework-specific. Dynamic fields are patched in place on refresh() so
 * typing in the message box survives live updates.
 */
export class NodeInspector {
  private root: HTMLDivElement;
  private currentId: string | null = null;

  constructor(
    container: HTMLElement,
    private engine: GraphEngine,
    /** Undefined ⇒ read-only mode (live mesh): mutating actions are hidden. */
    private onSpawnChild?: (parent: AgentNode) => void
  ) {
    this.root = document.createElement("div");
    this.root.className = "axiom-inspector axiom-inspector--empty";
    container.appendChild(this.root);
    this.renderEmpty();
  }

  /** Full render for a newly selected node. */
  show(node: AgentNode): void {
    this.currentId = node.id;
    this.root.classList.remove("axiom-inspector--empty");
    const def = this.engine.getNodeTypes().find((d) => d.id === node.typeId);
    const colorHex = def ? `#${def.color.toString(16).padStart(6, "0")}` : "#888";

    this.root.innerHTML = `
      <div class="axiom-inspector__header" style="border-color:${colorHex}">
        <span class="axiom-inspector__swatch" style="background:${colorHex};box-shadow:0 0 12px ${colorHex}"></span>
        <div>
          <h2>${escapeHtml(node.label)}</h2>
          <p class="axiom-inspector__sub">${escapeHtml(node.framework)} &middot; ${escapeHtml(def?.label ?? node.typeId)}</p>
        </div>
      </div>
      <dl class="axiom-inspector__meta">
        <dt>Status</dt><dd data-field="status">${escapeHtml(node.status)}</dd>
        <dt>Reputation</dt><dd data-field="reputation">${node.reputation.toFixed(2)}</dd>
        <dt>Activity</dt>
        <dd><div class="axiom-meter"><div class="axiom-meter__fill" data-field="activity" style="width:${Math.round(node.activity * 100)}%;background:${colorHex}"></div></div></dd>
        <dt>Node ID</dt><dd class="axiom-inspector__mono">${escapeHtml(node.id)}</dd>
      </dl>
      <h3>Tools</h3>
      <div class="axiom-inspector__tools">
        ${
          node.capabilities
            .map(
              (c) => `<button class="axiom-tool" data-tool="${escapeHtml(c.name)}" title="${escapeHtml(c.description)}">
                ${escapeHtml(c.name)}</button>`
            )
            .join("") || "<em>none exposed</em>"
        }
      </div>
      <div class="axiom-inspector__toolresult" data-field="toolresult"></div>
      ${
        node.capabilities.some((c) => c.name === "mandelbrot_scan")
          ? `<h3>Mandelbrot Explorer</h3>
      <div class="axiom-fractal">
        <canvas class="axiom-fractal__canvas" data-field="fractalcanvas" title="click to zoom in"></canvas>
        <div class="axiom-fractal__bar">
          <span class="axiom-fractal__verdict" data-field="fractalverdict">scanning…</span>
          <button class="axiom-btn axiom-btn--small" data-field="fractalreset">Reset view</button>
        </div>
      </div>`
          : ""
      }
      <h3>Memory</h3>
      <ul class="axiom-inspector__memory" data-field="memory"></ul>
      <h3>Direct message</h3>
      <div class="axiom-inspector__console">
        <input class="axiom-spawn__input" data-field="msginput" placeholder="ask this agent…" />
        <button class="axiom-btn axiom-btn--small" data-field="msgsend">Send</button>
      </div>
      <div class="axiom-inspector__reply" data-field="reply"></div>
      ${
        this.onSpawnChild
          ? `<div class="axiom-inspector__actions">
        <button class="axiom-btn axiom-btn--small" data-field="spawnchild">Spawn child</button>
        <button class="axiom-btn axiom-btn--danger axiom-btn--small" data-field="terminate">Terminate</button>
      </div>`
          : `<div class="axiom-inspector__readonly">live mesh · read-only</div>`
      }
    `;

    this.renderMemory(node);
    this.bindActions(node);
    this.mountFractal(node);
  }

  /**
   * Interactive Mandelbrot explorer. Paints the escape-time set straight from
   * the Fractal Oracle's own `mandelbrot_scan` tool (real Wasm), colouring
   * bounded points gold ("robust islands"). Click to zoom in on the strategy
   * space; the centre's fragility verdict comes from `escape_time_risk`.
   */
  private mountFractal(node: AgentNode): void {
    const canvas = this.root.querySelector<HTMLCanvasElement>('[data-field="fractalcanvas"]');
    if (!canvas) return;
    const verdictEl = this.root.querySelector<HTMLElement>('[data-field="fractalverdict"]');
    const W = 176;
    const H = 120;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const home = { re0: -2.5, re1: 1.0, im0: -1.25, im1: 1.25 };
    let view = { ...home };
    const maxiter = 160;

    const colorFor = (e: number, max: number): [number, number, number] => {
      if (e >= max) return [255, 210, 122]; // bounded → robust island (gold)
      const t = e / max;
      return [
        Math.round(40 + 210 * Math.pow(t, 0.75)),
        Math.round(20 + 150 * t),
        Math.round(90 + 150 * (1 - Math.abs(0.5 - t) * 2)),
      ];
    };

    const render = async () => {
      try {
        const raw = await this.engine.invokeTool(
          node.id,
          "mandelbrot_scan",
          `${view.re0},${view.re1},${view.im0},${view.im1},${W},${H},${maxiter}`
        );
        const data = JSON.parse(raw) as { w: number; h: number; maxiter: number; esc: number[] };
        const img = ctx.createImageData(data.w, data.h);
        for (let i = 0; i < data.esc.length; i++) {
          const [r, g, b] = colorFor(data.esc[i], data.maxiter);
          const o = i * 4;
          img.data[o] = r;
          img.data[o + 1] = g;
          img.data[o + 2] = b;
          img.data[o + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      } catch (error) {
        if (verdictEl) verdictEl.textContent = `scan failed: ${String(error)}`;
      }
    };

    const updateVerdict = async () => {
      const cRe = (view.re0 + view.re1) / 2;
      const cIm = (view.im0 + view.im1) / 2;
      try {
        const raw = await this.engine.invokeTool(node.id, "escape_time_risk", `${cRe},${cIm},400`);
        const v = JSON.parse(raw) as { verdict: string; stability: number };
        if (verdictEl)
          verdictEl.textContent = `center (${cRe.toFixed(3)}, ${cIm.toFixed(3)}) → ${v.verdict} · stability ${v.stability.toFixed(2)}`;
      } catch {
        /* ignore */
      }
    };

    canvas.addEventListener("click", (event) => {
      const rect = canvas.getBoundingClientRect();
      const fx = (event.clientX - rect.left) / rect.width;
      const fy = (event.clientY - rect.top) / rect.height;
      const cRe = view.re0 + (view.re1 - view.re0) * fx;
      const cIm = view.im0 + (view.im1 - view.im0) * fy;
      const spanRe = (view.re1 - view.re0) * 0.25; // zoom 2× (half-span each side)
      const spanIm = (view.im1 - view.im0) * 0.25;
      view = { re0: cRe - spanRe, re1: cRe + spanRe, im0: cIm - spanIm, im1: cIm + spanIm };
      render();
      updateVerdict();
    });

    this.root.querySelector('[data-field="fractalreset"]')?.addEventListener("click", () => {
      view = { ...home };
      render();
      updateVerdict();
    });

    render();
    updateVerdict();
  }

  /** Patches live fields if the shown node is still present; closes if it died. */
  refresh(nodes: AgentNode[]): void {
    if (!this.currentId) return;
    const node = nodes.find((n) => n.id === this.currentId);
    if (!node) {
      this.renderEmpty();
      return;
    }
    this.setField("status", node.status);
    this.setField("reputation", node.reputation.toFixed(2));
    const meter = this.root.querySelector<HTMLElement>('[data-field="activity"]');
    if (meter) meter.style.width = `${Math.round(node.activity * 100)}%`;
    this.renderMemory(node);
  }

  private bindActions(node: AgentNode): void {
    const toolResult = this.root.querySelector<HTMLElement>('[data-field="toolresult"]')!;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>(".axiom-tool")) {
      button.addEventListener("click", async () => {
        const tool = button.dataset.tool!;
        button.disabled = true;
        toolResult.textContent = `invoking ${tool}…`;
        try {
          const result = await this.engine.invokeTool(node.id, tool);
          toolResult.textContent = `${tool} → ${result}`;
        } catch (error) {
          toolResult.textContent = `${tool} failed: ${String(error)}`;
        } finally {
          button.disabled = false;
        }
      });
    }

    const input = this.root.querySelector<HTMLInputElement>('[data-field="msginput"]')!;
    const send = this.root.querySelector<HTMLButtonElement>('[data-field="msgsend"]')!;
    const reply = this.root.querySelector<HTMLElement>('[data-field="reply"]')!;
    const submit = async () => {
      const text = input.value.trim();
      if (!text) return;
      send.disabled = true;
      reply.textContent = "…";
      try {
        reply.textContent = await this.engine.sendMessage(node.id, text);
        input.value = "";
      } catch (error) {
        reply.textContent = `failed: ${String(error)}`;
      } finally {
        send.disabled = false;
      }
    };
    send.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
    });

    this.root
      .querySelector('[data-field="spawnchild"]')
      ?.addEventListener("click", () => this.onSpawnChild?.(node));

    this.root.querySelector('[data-field="terminate"]')?.addEventListener("click", () => {
      this.engine.terminateNode(node.id);
      this.renderEmpty();
    });
  }

  private renderMemory(node: AgentNode): void {
    const list = this.root.querySelector<HTMLElement>('[data-field="memory"]');
    if (!list) return;
    list.innerHTML = node.memoryEvents
      .map(
        (event) =>
          `<li><time>${new Date(event.at).toLocaleTimeString()}</time>${escapeHtml(event.text)}</li>`
      )
      .join("");
  }

  private setField(field: string, value: string): void {
    const el = this.root.querySelector(`[data-field="${field}"]`);
    if (el && el.textContent !== value) el.textContent = value;
  }

  private renderEmpty(): void {
    this.currentId = null;
    this.root.classList.add("axiom-inspector--empty");
    this.root.innerHTML = `<p class="axiom-inspector__placeholder">Click a node to inspect it.</p>`;
  }
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}
