// Each package keeps its template's tooling: Biome for core/poller/api, ESLint + Prettier for web.
const quote = (files) => files.map((f) => JSON.stringify(f)).join(" ");

export default {
  "{core,poller,api}/**/*.{ts,js,json,md}": (files) =>
    `biome check --write --no-errors-on-unmatched ${quote(files)}`,
  "web/**/*.{ts,tsx,js}": (files) => [
    `pnpm --dir web exec eslint --fix ${quote(files)}`,
    `pnpm --dir web exec prettier --write ${quote(files)}`,
  ],
  "web/**/*.{json,css,html,md}": (files) => `pnpm --dir web exec prettier --write ${quote(files)}`,
};
