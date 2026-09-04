#!/usr/bin/env tsx
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN_FIELD_NAMES = [
  "access_token",
  "refresh_token",
  "sessionTokenHash",
];

const BUNDLE_DIR = join(process.cwd(), "apps/web/.next/static");

function walk(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...walk(fullPath));
    } else if (fullPath.endsWith(".js")) {
      files.push(fullPath);
    }
  }
  return files;
}

function main() {
  const files = walk(BUNDLE_DIR);
  const violations: string[] = [];

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    for (const fieldName of FORBIDDEN_FIELD_NAMES) {
      if (content.includes(fieldName)) {
        violations.push(`${file}: contains field name "${fieldName}"`);
      }
    }
  }

  if (violations.length > 0) {
    console.error("Forbidden field names found in client bundle:");
    violations.forEach((v) => console.error(`  ${v}`));
    process.exit(1);
  }

  console.log(`Scanned ${files.length} bundle files — no forbidden field names found.`);
}

main();
