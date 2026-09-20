import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "contracts");
for (const file of ["pavel_core.py", "pavel_vault.py"]) {
  const bytes = readFileSync(resolve(root, file));
  console.log(`${file} ${createHash("sha256").update(bytes).digest("hex")}`);
}
