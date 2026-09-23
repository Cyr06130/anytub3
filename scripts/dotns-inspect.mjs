#!/usr/bin/env node
// Read what a Polkadot host sees on dotNS for this product — the records the
// product-manifest resolution walks (RFC product-manifest / hosts' resolvers):
//   <name>.<tld>       registry.resolver(node), owner, text["manifest"], contenthash
//   app.<name>.<tld>   registry.resolver(node), owner, text["executable"], contenthash
// A host shows "This product doesn't have an app on this device" when the root
// manifest resolves but the app subname has no resolver / empty or rejected
// text record — this script tells the two apart without a device.
//
// Uses the DotNS client of the globally installed bulletin-deploy (≥0.19):
//   npm install -g bulletin-deploy
//   node scripts/dotns-inspect.mjs [env=paseo-next-v2] [label=anytub3tv]
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
const pkg = join(globalRoot, "bulletin-deploy");
if (!existsSync(pkg)) {
  console.error("bulletin-deploy is not installed globally: npm install -g bulletin-deploy");
  process.exit(2);
}
const { DotNS, DEFAULT_MNEMONIC, loadEnvironments, resolveEndpoints } = await import(pathToFileURL(join(pkg, "dist/index.js")));
const { namehash } = await import(pathToFileURL(join(pkg, "node_modules/viem/_esm/index.js")));

const envId = process.argv[2] ?? "paseo-next-v2";
const label = process.argv[3] ?? "anytub3tv";
const { doc } = await loadEnvironments();
const env = resolveEndpoints(doc, envId);
const tld = env.tld ?? "dot";
console.log(`env=${envId} tld=${tld} assetHub=${env.assetHub[0]}`);
console.log(`registry=${env.contracts.DOTNS_REGISTRY} contentResolver=${env.contracts.DOTNS_CONTENT_RESOLVER}`);

// Read-only: the dev mnemonic only gives the client an address, nothing is signed.
const dotns = new DotNS();
await dotns.connect({
  rpc: env.assetHub[0],
  assetHubEndpoints: env.assetHub,
  contracts: env.contracts,
  nativeToEthRatio: env.nativeToEthRatio,
  mnemonic: DEFAULT_MNEMONIC,
  autoAccountMapping: false,
  environmentId: envId,
  network: env.network,
});

const registryAbi = [
  { name: "resolver", type: "function", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }], outputs: [{ type: "address" }] },
  { name: "owner", type: "function", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }], outputs: [{ type: "address" }] },
];
const show = async (what, read) => {
  try {
    console.log(`  ${what}: ${await read()}`);
  } catch (e) {
    console.log(`  ${what}: ERROR ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
  }
};

for (const [name, textKey] of [[label, "manifest"], [`app.${label}`, "executable"]]) {
  const node = namehash(`${name}.${tld}`);
  console.log(`\n== ${name}.${tld}  node=${node}`);
  await show("registry.resolver", () => dotns.contractCallNullable(env.contracts.DOTNS_REGISTRY, registryAbi, "resolver", [node]));
  await show("registry.owner", () => dotns.contractCallNullable(env.contracts.DOTNS_REGISTRY, registryAbi, "owner", [node]));
  await show(`text[${textKey}]`, () => dotns.getTextRecord(name, textKey));
  await show("contenthash", () => dotns.getContenthash(name));
}
dotns.disconnect();
process.exit(0);
