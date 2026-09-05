#!/usr/bin/env tsx
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Bare-presence check: field/property names that should NEVER appear in
// client bundle source at all, because they're unique to our own schema and
// no legitimate third-party library has a reason to reference them.
const FORBIDDEN_FIELD_NAMES = ["sessionTokenHash"];

// Value-shape check: "access_token"/"refresh_token" are NOT in the bare-presence
// list above, because they're generic OAuth vocabulary that any OAuth-capable
// third-party library can legitimately reference internally — e.g. livekit-client
// uses "access_token" as its own WebSocket query param name for LiveKit's
// intentionally client-side, short-lived room-access JWT (and redacts it in its
// own logs). Our own MonoES OAuth code lives entirely in services/api, which
// apps/web's client bundle never imports, so a bare-presence check on these two
// names was never a reliable leak signal here — it only ever caught
// livekit-client's own vocabulary. Instead, check for the SHAPE of an actual
// hardcoded credential value assigned to one of these keys (a long
// JWT/base64url-looking literal), which is what a real accidental embed would
// look like, regardless of which library's code it appeared in.
const FORBIDDEN_VALUE_PATTERNS = [
  /["'](?:access_token|refresh_token)["']\s*:\s*["'][A-Za-z0-9\-_.]{40,}["']/,
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
    for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
      const match = content.match(pattern);
      if (match) {
        violations.push(`${file}: contains a hardcoded credential-shaped value (${match[0].slice(0, 60)}...)`);
      }
    }
  }

  if (violations.length > 0) {
    console.error("Forbidden field names or credential-shaped values found in client bundle:");
    violations.forEach((v) => console.error(`  ${v}`));
    process.exit(1);
  }

  console.log(`Scanned ${files.length} bundle files — no forbidden field names or credential-shaped values found.`);
}

main();
