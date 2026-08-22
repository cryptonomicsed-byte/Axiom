import type { AgentCapability, AgentInstance, AgentNode, AgentRuntimeProvider } from "../engine/types";

/**
 * Move is architecturally unlike the other five languages: there's no
 * long-running process to poll — a Move node represents a package + objects
 * published on Sui, queried straight from the chain's public JSON-RPC.
 *
 * `omokoda-on-chain` (sources/{agent,consensus_ledger,epistemic_nft,garden,
 * hive,soul,synapse,zbt_core,zbt_errors,zbt_guard}.move) was compiled-but-
 * never-published before this (Move.toml still had the `0x0` placeholder
 * address, and soul.move had a real compile error — an unbound `vector`
 * module alias, missing `use std::vector;`). Fixed and published to Sui
 * testnet 2026-07-16 (digest Dz6biH6NMis9PjQneQ9FwfM5KyYburuaLU4gj4rTJ3a4).
 *
 * No custom backend to deploy: Sui's public RPC IS the API. Uses a public
 * mirror (`fullnode.testnet.sui.io` 404s on direct curl/fetch for reasons
 * unclear — works fine through the official SDK, so likely a soft-block on
 * non-SDK clients — `sui-testnet-rpc.publicnode.com` mirrors the same chain
 * and has open CORS, confirmed live).
 */
const PACKAGE_ID = "0x380e0599702b7ebd9005b02f36dd611cff209c94ca678f051233346cf7dbf22e";
const AGENT_REGISTRY_ID = "0xdf7ee684510d8f5c95512d444536a273fe59e8363c9a9b8fb89c862203743d92";
const UPGRADE_CAP_ID = "0x18cc8ea8bfea12850e69ca15bb7c44c42b77b09bfbc7e580e75b967e2c75f25a";

const MOVE_MODULES = [
  "agent", "consensus_ledger", "epistemic_nft", "garden",
  "hive", "soul", "synapse", "zbt_core", "zbt_errors", "zbt_guard",
];

const MOVE_TOOLS: { tool: string; description: string; call: () => unknown[] }[] = [
  {
    tool: "package",
    description: "The published package object (modules, version, immutable digest).",
    call: () => ["sui_getObject", PACKAGE_ID, { showContent: true, showType: true }],
  },
  {
    tool: "agent_registry",
    description: "The shared AgentRegistry object (garden.move) — real on-chain agent count.",
    call: () => ["sui_getObject", AGENT_REGISTRY_ID, { showContent: true, showType: true }],
  },
  {
    tool: "upgrade_cap",
    description: "The UpgradeCap this deployer holds — proof of publish authority.",
    call: () => ["sui_getObject", UPGRADE_CAP_ID, { showContent: true, showType: true }],
  },
];

async function rpc(apiBase: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(apiBase, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`Sui RPC ${method} → ${JSON.stringify(body.error)}`);
  return body.result;
}

export class MoveOnChainRuntimeHost implements AgentRuntimeProvider {
  readonly typeIds = ["move-onchain"];

  constructor(private apiBase: string) {}

  async spawn(_node: AgentNode): Promise<AgentInstance> {
    const apiBase = this.apiBase;
    let alive = true;

    const capabilities: AgentCapability[] = MOVE_TOOLS.map((t) => ({
      name: t.tool,
      description: t.description,
    }));

    return {
      capabilities,
      async invokeTool(tool: string, _arg: string): Promise<string> {
        if (!alive) throw new Error("instance terminated");
        const entry = MOVE_TOOLS.find((t) => t.tool === tool);
        if (!entry) {
          throw new Error(`Move package has no "${tool}" tool — known: ${MOVE_TOOLS.map((t) => t.tool).join(", ")}`);
        }
        const [method, ...params] = entry.call();
        const result = await rpc(apiBase, method as string, params);
        return JSON.stringify(result);
      },
      async sendMessage(_text: string): Promise<string> {
        if (!alive) throw new Error("instance terminated");
        // Nothing to "message" — a published, immutable package. The honest
        // reply is its real module list.
        return JSON.stringify({ package: PACKAGE_ID, modules: MOVE_MODULES, network: "testnet" });
      },
      terminate(): void {
        // A published, immutable on-chain package — nothing to boot or
        // kill in the first place. Detach only, same as the others.
        alive = false;
      },
    };
  }
}
