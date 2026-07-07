import type { AgentCapability, AgentInstance, AgentNode, AgentRuntimeProvider } from "../engine/types";

/**
 * ABI expected from a leaf agent module (see agents/leaf/src/lib.rs):
 *   manifest_ptr()/manifest_len()  — static JSON tool manifest
 *   alloc(len) -> ptr              — scratch space for host->agent strings
 *   invoke(tPtr,tLen,aPtr,aLen) -> u64 (ptr<<32|len of UTF-8 result)
 */
interface LeafExports {
  memory: WebAssembly.Memory;
  manifest_ptr(): number;
  manifest_len(): number;
  alloc(len: number): number;
  invoke(toolPtr: number, toolLen: number, argPtr: number, argLen: number): bigint;
}

interface LeafManifest {
  agent: string;
  version: string;
  tools: { name: string; description: string }[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * In-browser agent runtime: every spawn instantiates a REAL sandboxed
 * WebAssembly process from the compiled Rust leaf module. Each instance has
 * its own linear memory and its own private state (the tick counter lives
 * inside the Wasm heap, invisible to the host except through the agent's
 * exported tools). No imports are granted to the module — it cannot touch
 * the DOM, network, or other agents. Tool discovery is the agent's own
 * manifest, not host-side configuration: the process tells us what it can
 * do, MCP-style.
 */
export class WasmAgentHost implements AgentRuntimeProvider {
  readonly typeIds: string[];
  private modulePromise: Promise<WebAssembly.Module> | null = null;

  constructor(
    private wasmUrl: string,
    typeIds: string[]
  ) {
    this.typeIds = typeIds;
  }

  /** Compile once, instantiate per agent — instances stay fully isolated. */
  private module(): Promise<WebAssembly.Module> {
    if (!this.modulePromise) {
      this.modulePromise = fetch(this.wasmUrl)
        .then((response) => {
          if (!response.ok) throw new Error(`fetch ${this.wasmUrl}: ${response.status}`);
          return response.arrayBuffer();
        })
        .then((bytes) => WebAssembly.compile(bytes));
    }
    return this.modulePromise;
  }

  async spawn(_node: AgentNode): Promise<AgentInstance> {
    const module = await this.module();
    // No import object: the sandbox has zero ambient authority.
    const instance = await WebAssembly.instantiate(module, {});
    const exports = instance.exports as unknown as LeafExports;

    const manifestBytes = new Uint8Array(
      exports.memory.buffer,
      exports.manifest_ptr(),
      exports.manifest_len()
    );
    const manifest = JSON.parse(decoder.decode(manifestBytes)) as LeafManifest;
    const capabilities: AgentCapability[] = manifest.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));

    const call = (tool: string, arg: string): string => {
      const toolBytes = encoder.encode(tool);
      const argBytes = encoder.encode(arg);
      // Allocate inside the agent and copy inputs into its memory.
      const toolPtr = exports.alloc(toolBytes.length);
      new Uint8Array(exports.memory.buffer, toolPtr, toolBytes.length).set(toolBytes);
      const argPtr = exports.alloc(argBytes.length || 1);
      if (argBytes.length > 0) {
        new Uint8Array(exports.memory.buffer, argPtr, argBytes.length).set(argBytes);
      }
      const packed = exports.invoke(toolPtr, toolBytes.length, argPtr, argBytes.length);
      const resultPtr = Number(packed >> 32n);
      const resultLen = Number(packed & 0xffffffffn);
      return decoder.decode(new Uint8Array(exports.memory.buffer, resultPtr, resultLen));
    };

    let alive = true;
    return {
      capabilities,
      async invokeTool(tool: string, arg: string): Promise<string> {
        if (!alive) throw new Error("instance terminated");
        return call(tool, arg);
      },
      async sendMessage(text: string): Promise<string> {
        if (!alive) throw new Error("instance terminated");
        // Direct messages route through the agent's own echo tool — the
        // reply provably comes from inside the process (it carries the
        // instance-private tick count).
        return call("echo", text);
      },
      terminate(): void {
        // Dropping every reference lets the instance and its memory be
        // collected; there is no ambient handle to leak.
        alive = false;
      },
    };
  }
}
