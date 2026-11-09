// Fails when `npm pack` would ship anything besides dist/, README, LICENSE and package.json.
import { execFileSync } from "node:child_process";

const [{ files }] = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" }),
);
const allowed = /^(dist\/|README\.md$|LICENSE$|package\.json$)/;
const stray = files
  .map((file) => file.path)
  .filter((path) => !allowed.test(path));

if (stray.length > 0) {
  console.error("Unexpected files in the package:", stray);
  process.exit(1);
}
console.log(`${files.length} files in the package, all expected.`);
