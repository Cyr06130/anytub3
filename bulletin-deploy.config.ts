// Product manifest for `bulletin-deploy --config bulletin-deploy.config.ts` (≥0.19).
//
// A deploy writes two dotNS text records from this file: the ROOT manifest on
// the product name (who the product is: name, description, icon, cross-product
// grants) and one EXECUTABLE manifest per modality (`app.<name>.<tld>`: how to
// run it). Per the product-manifest RFC a product without a root manifest "is
// not discoverable; executables MUST NOT be launched" — so deploy with this
// config, not with bare positional arguments.
//
// It declares nothing about OUR permissions: Bulletin / Statement Store
// allowances stay runtime (RFC-0010, implicit on first write) and external
// access prompts stay RFC-0002. `trustedProducts` would only grant OTHER
// products access to us, so it is left out.
//
// The `domain` TLD must match the target environment's registry AND the
// positional <domain> argument as typed (pass the full name, not the bare label):
//   bulletin-deploy --env paseo-next-v2 --config bulletin-deploy.config.ts ./build anytub3tv.paseo
//   ANYTUB3_DOTNS=anytub3tv.test bulletin-deploy --env preview --config … ./build anytub3tv.test
//
// Not part of the app's tsconfig projects: bulletin-deploy loads it itself.

type Executable = { kind: "app"; path: string; appVersion: [number, number, number] };
type ProductConfig = {
  domain: string;
  displayName: string;
  description: string;
  icon: { path: string; format: "png" | "jpeg" };
  executables: Executable[];
};

const config: ProductConfig = {
  domain: process.env.ANYTUB3_DOTNS ?? "anytub3tv.paseo",
  displayName: "AnyTub3",
  description: "Decentralized IPTV with inter-host continuity",
  icon: { path: "./deploy/icon.png", format: "png" },
  executables: [{ kind: "app", path: "./build", appVersion: [0, 1, 0] }],
};

export default config;
