#!/usr/bin/env tsx
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// "access_token"/"refresh_token" were dropped from this list: they're generic
// OAuth vocabulary that any OAuth-capable third-party library can legitimately
// reference internally (e.g. livekit-client uses "access_token" as its own
// WebSocket query param name for LiveKit's intentionally client-side room-access
// JWT, and redacts it in its own logs — verified this isn't our MonoES token or
// session leaking). Our own MonoES OAuth code lives entirely in services/api,
// which apps/web's client bundle never imports, so those terms never reliably
// indicated a real leak path here in the first place. sessionTokenHash is kept:
// it's a Prisma field name unique to our schema, not shared OAuth vocabulary.
const FORBIDDEN_FIELD_NAMES = ["sessionTokenHash"];

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
