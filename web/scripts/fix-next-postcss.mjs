import fs from "node:fs";
import path from "node:path";

const nextPostcssLib = path.resolve("node_modules/next/node_modules/postcss/lib");
const sourceFile = path.join(nextPostcssLib, "stringify.js");
const fallbackSource = path.resolve("node_modules/postcss/lib/stringify.js");

if (!fs.existsSync(nextPostcssLib)) {
  process.exit(0);
}

if (fs.existsSync(sourceFile)) {
  process.exit(0);
}

if (!fs.existsSync(fallbackSource)) {
  throw new Error(`Missing fallback PostCSS stringify implementation: ${fallbackSource}`);
}

fs.copyFileSync(fallbackSource, sourceFile);
console.log(`Repaired missing file: ${sourceFile}`);
