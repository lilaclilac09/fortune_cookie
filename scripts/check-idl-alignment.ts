#!/usr/bin/env tsx
/**
 * Compare the hand-maintained TS IDL (app/src/hooks/fortune_cookie_idl.ts)
 * against what `anchor build` emits in target/idl/fortune_cookie.json.
 *
 * Catches drift like missing instructions, renamed accounts, wrong arg
 * order, missing event fields. Run after every program edit:
 *
 *   anchor build
 *   cd tests && npm run check:idl
 *
 * Exit code 0 if aligned; 1 if any difference detected.
 */

import * as fs from "fs";
import * as path from "path";

const TS_IDL_PATH = path.resolve(__dirname, "../app/src/hooks/fortune_cookie_idl.ts");
const ANCHOR_IDL_PATH = path.resolve(__dirname, "../target/idl/fortune_cookie.json");

function loadTsIdl(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { IDL } = require(TS_IDL_PATH);
  return IDL;
}

function loadAnchorIdl(): any {
  if (!fs.existsSync(ANCHOR_IDL_PATH)) {
    console.error(`✗ ${ANCHOR_IDL_PATH} not found — run 'anchor build' first.`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(ANCHOR_IDL_PATH, "utf-8"));
}

interface Diff {
  kind: "missing-instruction" | "missing-account-type" | "missing-event"
       | "arg-mismatch" | "account-meta-mismatch" | "field-mismatch";
  detail: string;
}

const diffs: Diff[] = [];

function summarizeAccountMeta(a: any): string {
  return `${a.name}:writable=${!!(a.writable ?? a.isMut)}:signer=${!!(a.signer ?? a.isSigner)}`;
}

function compareInstructions(ts: any[], anchor: any[]): void {
  const tsByName = new Map(ts.map((ix: any) => [ix.name, ix]));
  for (const aIx of anchor) {
    const tIx = tsByName.get(aIx.name);
    if (!tIx) {
      diffs.push({
        kind: "missing-instruction",
        detail: `TS IDL is missing instruction '${aIx.name}'`,
      });
      continue;
    }
    const normType = (t: any) => JSON.stringify(t).replace(/"publicKey"/g, '"pubkey"');
    const tArgs = (tIx.args ?? []).map((a: any) => `${a.name}:${normType(a.type)}`);
    const aArgs = (aIx.args ?? []).map((a: any) => `${a.name}:${normType(a.type)}`);
    if (tArgs.join("|") !== aArgs.join("|")) {
      diffs.push({
        kind: "arg-mismatch",
        detail: `'${aIx.name}' args differ:\n    TS:     [${tArgs.join(", ")}]\n    anchor: [${aArgs.join(", ")}]`,
      });
    }
    const tMetas = (tIx.accounts ?? []).map(summarizeAccountMeta);
    const aMetas = (aIx.accounts ?? []).map(summarizeAccountMeta);
    if (tMetas.join("|") !== aMetas.join("|")) {
      diffs.push({
        kind: "account-meta-mismatch",
        detail: `'${aIx.name}' accounts differ:\n    TS:     [${tMetas.join(", ")}]\n    anchor: [${aMetas.join(", ")}]`,
      });
    }
  }
  const anchorNames = new Set(anchor.map((ix: any) => ix.name));
  for (const tIx of ts) {
    if (!anchorNames.has(tIx.name)) {
      diffs.push({
        kind: "missing-instruction",
        detail: `Anchor IDL is missing instruction '${tIx.name}' (only in TS)`,
      });
    }
  }
}

function compareAccounts(ts: any[], anchor: any[]): void {
  const tsByName = new Map(ts.map((a: any) => [a.name, a]));
  const anchorNames = new Set(anchor.map((a: any) => a.name));
  for (const aName of anchorNames) {
    if (!tsByName.has(aName as string)) {
      diffs.push({
        kind: "missing-account-type",
        detail: `TS IDL is missing account '${aName}'`,
      });
    }
  }
  for (const tName of tsByName.keys()) {
    if (!anchorNames.has(tName)) {
      diffs.push({
        kind: "missing-account-type",
        detail: `Anchor IDL is missing account '${tName}' (only in TS)`,
      });
    }
  }
}

function compareEvents(ts: any[], anchor: any[]): void {
  const tsNames = new Set(ts.map((e: any) => e.name));
  for (const ae of anchor) {
    if (!tsNames.has(ae.name)) {
      diffs.push({
        kind: "missing-event",
        detail: `TS IDL is missing event '${ae.name}'`,
      });
    }
  }
}

function compareTypes(ts: any[], anchor: any[]): void {
  const tsByName = new Map(
    ts
      .filter((t: any) => t.type?.kind === "struct")
      .map((t: any) => [t.name, t.type.fields ?? []]),
  );
  for (const at of anchor) {
    if (at.type?.kind !== "struct") continue;
    const tFields = tsByName.get(at.name);
    if (!tFields) continue;
    const tSig = (tFields as any[]).map((f: any) => `${f.name}:${JSON.stringify(f.type)}`).join("|");
    const aSig = (at.type.fields ?? []).map((f: any) => `${f.name}:${JSON.stringify(f.type)}`).join("|");
    const norm = (s: string) => s.replace(/"publicKey"/g, '"pubkey"');
    if (norm(tSig) !== norm(aSig)) {
      diffs.push({
        kind: "field-mismatch",
        detail: `Type '${at.name}' fields differ:\n    TS:     ${tSig}\n    anchor: ${aSig}`,
      });
    }
  }
}

function main() {
  const tsIdl = loadTsIdl();
  const anchorIdl = loadAnchorIdl();

  console.log(`Comparing:\n  TS:     ${TS_IDL_PATH}\n  anchor: ${ANCHOR_IDL_PATH}\n`);

  compareInstructions(tsIdl.instructions ?? [], anchorIdl.instructions ?? []);
  compareAccounts(tsIdl.accounts ?? [], anchorIdl.accounts ?? []);
  compareEvents(tsIdl.events ?? [], anchorIdl.events ?? []);
  compareTypes(tsIdl.accounts ?? [], anchorIdl.types ?? []);

  if (diffs.length === 0) {
    console.log(`✓ TS IDL matches anchor build IDL (${(tsIdl.instructions ?? []).length} instructions, ${(tsIdl.accounts ?? []).length} accounts, ${(tsIdl.events ?? []).length} events).`);
    process.exit(0);
  }

  console.error(`✗ Found ${diffs.length} differences:\n`);
  for (const d of diffs) {
    console.error(`  [${d.kind}] ${d.detail}\n`);
  }
  process.exit(1);
}

main();
