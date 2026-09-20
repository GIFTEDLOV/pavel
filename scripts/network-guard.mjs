const canonical = {
  chainId: 61999,
  rpc: "https://studio.genlayer.com/api",
};

const chainId = Number(process.env.PAVEL_CHAIN_ID ?? canonical.chainId);
const rpc = process.env.PAVEL_RPC_URL ?? canonical.rpc;
const chainAlias = process.env.PAVEL_NETWORK_ALIAS ?? "studionet";

if (chainAlias !== "studionet") throw new Error(`PAVEL network guard: alias ${chainAlias} is not studionet`);
if (chainId !== canonical.chainId) throw new Error(`PAVEL network guard: chain ${chainId} != ${canonical.chainId}`);
if (rpc !== canonical.rpc) throw new Error(`PAVEL network guard: RPC ${rpc} != ${canonical.rpc}`);
if (/studio-dev|studio-next|61997/i.test(`${rpc}:${chainId}`)) throw new Error("PAVEL network guard: preview configuration is forbidden");

console.log(JSON.stringify({ ok: true, alias: chainAlias, rpc, chainId }, null, 2));
