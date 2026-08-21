import fs from "node:fs";
import path from "node:path";

const generatedTargets = [
  ".next",
  "test-results",
  "test-results 2",
  "playwright-report",
  "playwright-report 2",
  "coverage",
  "coverage 2",
];

for (const relativeTarget of generatedTargets) {
  const targetPath = path.resolve(relativeTarget);
  if (!fs.existsSync(targetPath)) {
    continue;
  }

  fs.rmSync(targetPath, { force: true, recursive: true });
  console.log(`Removed generated artifact: ${relativeTarget}`);
}
