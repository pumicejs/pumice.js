// Trusted publishing (OIDC) needs npm 11.5.1 or later.
import { execFileSync } from "node:child_process";

const version = execFileSync("npm", ["--version"], { encoding: "utf8" }).trim();
const [major, minor, patch] = version.split(".").map(Number);
const ok =
  major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1)));

if (!ok) {
  console.error(
    `npm ${version} is older than 11.5.1, which trusted publishing needs.`,
  );
  process.exit(1);
}
console.log(`npm ${version}`);
