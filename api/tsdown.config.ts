import { defineConfig } from "tsdown";

export default defineConfig([
  // Server bundle
  {
    entry: ["src/index.ts"],
    format: "esm",
    platform: "node",
    target: "node26",
    outDir: "dist",
    fixedExtension: false,
    // Workspace packages are consumed as TypeScript source, so bundle them in
    deps: { alwaysBundle: [/^@jobvr\//] },
    clean: true,
    sourcemap: true,
  },
  // Typed RPC client (+ bundled declarations) for frontends: `@jobvr/api/client`
  {
    entry: { client: "src/client.ts" },
    format: "esm",
    platform: "neutral",
    // Server-only modules appear in the type graph but never in the client's runtime code
    deps: { neverBundle: [/^node:/] },
    outDir: "dist",
    fixedExtension: false,
    clean: false,
    dts: true,
  },
]);
