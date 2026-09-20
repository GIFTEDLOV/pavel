import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const files = ["contracts/pavel_core.py", "contracts/pavel_vault.py"];
const sensitive = [
  "wallet", "principal", "agent", "recipient", "amount", "refund_amount",
  "budget", "deadline", "mandate_id", "intent_id", "evidence_id",
  "authority_origin", "settlement_id", "vault_address",
];
const violations = [];

for (const relative of files) {
  const text = fs.readFileSync(path.join(root, relative), "utf8");
  for (const field of sensitive) {
    const pattern = new RegExp(`\\["${field}"\\]\\s*=\\s*(?:result|vector|proposed|independent)\\[`, "g");
    if (pattern.test(text)) violations.push(`${relative}: semantic result assigns ${field}`);
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log(`semantic authority audit: passed (${files.length} contract sources, ${sensitive.length} protected fields)`);
