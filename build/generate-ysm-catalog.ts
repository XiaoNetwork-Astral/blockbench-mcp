import { createHash } from "node:crypto";
import {
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, relative, resolve } from "node:path";

interface SourceLine {
  declared_version: string;
  commit: null;
  root_digest: string;
  files: Array<{ path: string; sha256: string }>;
}

interface Entry {
  namespace: string;
  name: string;
  kind: "function" | "variable" | "namespace";
  runtime_only: boolean;
  experimental: boolean;
  source_files: string[];
}

interface Arguments {
  stable: string;
  dev: string;
  out: string;
}

const DEV_ONLY = new Set([
  "tlm.activity",
  "tlm.backpack_type",
  "tlm.favorability_level",
  "tlm.favorability_point",
  "tlm.game_statue",
  "tlm.gomoku_rank",
  "tlm.gomoku_win_count",
  "tlm.has_backpack",
  "tlm.is_begging",
  "tlm.is_entity",
  "tlm.is_garage_kit",
  "tlm.is_sitting",
  "tlm.is_statue",
  "tlm.schedule",
  "tlm.show_item",
  "tlm.task_id",
  "ysm.bone_color",
  "ysm.bone_glow",
  "ysm.bone_transparency",
  "ysm.defer",
  "ysm.sync",
]);

// These YSM functions are implemented by the deterministic local evaluator.
// Other non-math bindings still require caller-supplied runtime values.
const LOCALLY_EVALUATED = new Set([
  "ysm.first_order",
  "ysm.second_order",
]);

function parseArguments(values: string[]): Arguments {
  const result: Partial<Arguments> = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.replace(/^--/, "") as keyof Arguments;
    const value = values[index + 1];
    if (key && value) result[key] = value;
  }
  if (!result.stable || !result.dev || !result.out) {
    throw new Error("Usage: bun run build/generate-ysm-catalog.ts --stable <java-root> --dev <java-root> --out <json>");
  }
  return result as Arguments;
}

function filesBelow(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = resolve(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else if (name.endsWith(".java")) files.push(path);
    }
  };
  visit(root);
  return files;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function namespaceFor(path: string): string | null {
  const name = basename(path);
  if (name === "MathBinding.java") return "math";
  if (name === "QueryBinding.java") return "query";
  if (name === "YSMBinding.java") return "ysm";
  if (name === "CtrlBinding.java") return "ctrl";
  if (name === "TLMBinding.java" || /touhoulittlemaid/i.test(path)) return "tlm";
  if (/[/\\]compat[/\\]/i.test(path) && /Binding\.java$/i.test(name)) return "ysm";
  return null;
}

function isAuditedMolangSource(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  const name = basename(path);
  return /(?:^|\/)molang(?:\/|$)/i.test(normalized)
    || /geckolib3\/core\/molang/i.test(normalized)
    || /^(?:Primary|Math|Query|YSM|Ctrl|TLM)Binding\.java$/i.test(name)
    || /\/compat\/.*Binding\.java$/i.test(normalized);
}

function scan(root: string): { entries: Entry[]; files: SourceLine["files"]; digest: string } {
  const entries = new Map<string, Entry>();
  const sourceFiles: SourceLine["files"] = [];
  for (const file of filesBelow(root)) {
    const text = readFileSync(file, "utf8");
    const path = relative(root, file).replace(/\\/g, "/");
    if (isAuditedMolangSource(path)) {
      sourceFiles.push({ path, sha256: sha256(text) });
    }
    if (!/(?:function|constValue|\w*Var|register|bindings\.put)\("/.test(text)) continue;
    const namespace = namespaceFor(file);
    if (!namespace && basename(file) !== "PrimaryBinding.java") continue;

    const pattern = /\b(function|constValue|var|[A-Za-z]+Var|register)\("([A-Za-z0-9_]+)"/g;
    for (const match of text.matchAll(pattern)) {
      const registration = match[1];
      const name = match[2].toLowerCase();
      const kind = registration === "function" ? "function" : "variable";
      const resolvedNamespace = namespace ?? "root";
      const key = `${resolvedNamespace}.${name}`;
      const existing = entries.get(key);
      if (existing) {
        if (!existing.source_files.includes(path)) existing.source_files.push(path);
      } else {
        entries.set(key, {
          namespace: resolvedNamespace,
          name,
          kind,
          runtime_only: resolvedNamespace !== "math",
          experimental: false,
          source_files: [path],
        });
      }
    }
  }

  const rootEntries: Entry[] = [
    ["math", "namespace"], ["query", "namespace"], ["q", "namespace"],
    ["variable", "namespace"], ["v", "namespace"], ["context", "namespace"],
    ["c", "namespace"], ["temp", "namespace"], ["t", "namespace"],
    ["ysm", "namespace"], ["ctrl", "namespace"], ["tlm", "namespace"],
    ["args", "namespace"], ["fn", "namespace"], ["loop", "function"],
    ["for_each", "function"],
  ].map(([name, kind]) => ({
    namespace: "root",
    name,
    kind: kind as Entry["kind"],
    runtime_only: name !== "loop" && name !== "for_each",
    experimental: false,
    source_files: [],
  }));
  for (const entry of rootEntries) entries.set(`${entry.namespace}.${entry.name}`, entry);

  sourceFiles.sort((a, b) => a.path.localeCompare(b.path));
  const digest = sha256(sourceFiles.map((file) => `${file.path}\0${file.sha256}`).join("\n"));
  return {
    entries: [...entries.values()].sort((a, b) =>
      a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name)
    ),
    files: sourceFiles,
    digest,
  };
}

const args = parseArguments(process.argv.slice(2));
const stableRoot = resolve(args.stable);
const devRoot = resolve(args.dev);
const stable = scan(stableRoot);
const dev = scan(devRoot);
const stableKeys = new Set(stable.entries.map((entry) => `${entry.namespace}.${entry.name}`));
const entries = new Map(stable.entries.map((entry) => [`${entry.namespace}.${entry.name}`, entry]));
for (const entry of dev.entries) {
  const key = `${entry.namespace}.${entry.name}`;
  if (!entries.has(key)) entries.set(key, { ...entry, experimental: true });
}
// The source lines use different helper names for some otherwise shared
// registrations. The audited semantic diff identifies the exact dev-only set;
// every other discovered symbol is part of the stable compatibility catalog.
for (const [key, entry] of entries) {
  stableKeys.add(key);
  entry.experimental = false;
}
for (const key of DEV_ONLY) {
  const entry = entries.get(key);
  if (entry) entry.experimental = true;
  stableKeys.delete(key);
}
for (const key of LOCALLY_EVALUATED) {
  const entry = entries.get(key);
  if (entry) entry.runtime_only = false;
}

const output = {
  schema_version: 1,
  generated_from: {
    stable: {
      declared_version: "2.6.5-forge+mc1.20.1",
      commit: null,
      root_digest: stable.digest,
      files: stable.files,
    } satisfies SourceLine,
    dev: {
      declared_version: "3.0-dev-forge+mc1.20.1",
      commit: null,
      root_digest: dev.digest,
      files: dev.files,
    } satisfies SourceLine,
  },
  stable_keys: [...stableKeys].sort(),
  entries: [...entries.values()].sort((a, b) =>
    a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name)
  ),
};

writeFileSync(resolve(args.out), `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Wrote ${output.entries.length} catalog entries to ${resolve(args.out)}`);
