#!/usr/bin/env node
// Single source of truth for the ESEfact version: `[workspace.package] version` in the root
// Cargo.toml. Every other place that carries a version is derived from it:
//
//   - package.json, apps/desktop/package.json, e2e/package.json
//   - apps/desktop/src-tauri/tauri.conf.json   (installer / product metadata)
//   - Cargo.lock                                (entries of the workspace crates)
//   - member crates inherit it with `version.workspace = true`
//
//   node scripts/version.mjs set <x.y.z>   write the version everywhere
//   node scripts/version.mjs check         fail (exit 1) when anything disagrees
//
// No dependencies on purpose: plain Node, text edits that keep the existing formatting.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => join(root, ...p.split("/"));

const CARGO_TOML = "Cargo.toml";
const CARGO_LOCK = "Cargo.lock";
const CHANGELOG = "CHANGELOG.md";
const JSON_FILES = [
  "package.json",
  "apps/desktop/package.json",
  "e2e/package.json",
  "apps/desktop/src-tauri/tauri.conf.json",
];

// https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const read = (p) => readFileSync(rel(p), "utf8");
const write = (p, text) => writeFileSync(rel(p), text);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);

// ---- Cargo.toml (source of truth) -----------------------------------------------------------

const WORKSPACE_VERSION_RE = /(\[workspace\.package\][^[]*?\r?\n\s*version\s*=\s*")([^"]*)(")/;

function readWorkspaceVersion() {
  const m = WORKSPACE_VERSION_RE.exec(read(CARGO_TOML));
  if (!m) throw new Error(`${CARGO_TOML}: no version under [workspace.package]`);
  return m[2];
}

/** Workspace member manifests, from `members = [...]` in the root Cargo.toml. */
function readMembers() {
  const toml = read(CARGO_TOML);
  const block = /members\s*=\s*\[([\s\S]*?)\]/.exec(toml);
  if (!block) throw new Error(`${CARGO_TOML}: no workspace members`);
  const paths = [...block[1].replace(/#.*$/gm, "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  return paths.map((dir) => {
    const manifest = `${dir}/Cargo.toml`;
    const text = read(manifest);
    const pkg = /\[package\]([\s\S]*?)(?:\r?\n\[|$)/.exec(text)?.[1] ?? "";
    const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(pkg)?.[1];
    if (!name) throw new Error(`${manifest}: no package name`);
    return {
      name,
      manifest,
      inherits: /^\s*version\.workspace\s*=\s*true\s*$/m.test(pkg),
    };
  });
}

// ---- Cargo.lock -----------------------------------------------------------------------------

function lockEntry(name) {
  return new RegExp(
    String.raw`(\[\[package\]\]\r?\nname = "${escapeRe(name)}"\r?\nversion = ")([^"]*)(")`,
  );
}

// ---- JSON files -----------------------------------------------------------------------------

// The top-level `"version"` key (two-space indent) of each JSON file.
const JSON_VERSION_RE = /^(  "version"\s*:\s*")([^"]*)(")/m;

// ---- commands -------------------------------------------------------------------------------

function check() {
  const problems = [];
  const expected = readWorkspaceVersion();
  if (!SEMVER.test(expected)) problems.push(`${CARGO_TOML}: "${expected}" is not a SemVer version`);

  for (const file of JSON_FILES) {
    let actual;
    try {
      actual = JSON.parse(read(file)).version;
    } catch (e) {
      problems.push(`${file}: cannot read (${e.message})`);
      continue;
    }
    if (actual !== expected) problems.push(`${file}: version is ${JSON.stringify(actual)}`);
  }

  const members = readMembers();
  const lock = read(CARGO_LOCK);
  for (const { name, manifest, inherits } of members) {
    if (!inherits) problems.push(`${manifest}: must use \`version.workspace = true\``);
    const m = lockEntry(name).exec(lock);
    if (!m) problems.push(`${CARGO_LOCK}: no entry for workspace crate "${name}"`);
    else if (m[2] !== expected) problems.push(`${CARGO_LOCK}: ${name} is ${m[2]}`);
  }

  if (existsSync(rel(CHANGELOG))) {
    const log = read(CHANGELOG);
    if (!/^## \[Unreleased\]/m.test(log)) problems.push(`${CHANGELOG}: missing "## [Unreleased]"`);
    if (!new RegExp(String.raw`^## \[${escapeRe(expected)}\]`, "m").test(log))
      problems.push(`${CHANGELOG}: no "## [${expected}]" section for the current version`);
  } else {
    problems.push(`${CHANGELOG}: file is missing`);
  }

  if (problems.length > 0) {
    console.error(`Version check failed. Expected ${expected} (from ${CARGO_TOML}):`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error("Fix: `pnpm version:set <x.y.z>` (and add the CHANGELOG section).");
    process.exit(1);
  }
  console.log(`Version check passed: ${expected} everywhere.`);
}

function set(version) {
  if (!version || !SEMVER.test(version)) {
    console.error(`Usage: pnpm version:set <x.y.z>   (SemVer, got ${JSON.stringify(version)})`);
    process.exit(2);
  }

  const toml = read(CARGO_TOML);
  if (!WORKSPACE_VERSION_RE.test(toml)) throw new Error(`${CARGO_TOML}: no workspace version`);
  write(CARGO_TOML, toml.replace(WORKSPACE_VERSION_RE, `$1${version}$3`));

  for (const file of JSON_FILES) {
    const text = read(file);
    if (!JSON_VERSION_RE.test(text)) throw new Error(`${file}: no top-level "version"`);
    write(file, text.replace(JSON_VERSION_RE, `$1${version}$3`));
  }

  let lock = read(CARGO_LOCK);
  for (const { name } of readMembers()) {
    const re = lockEntry(name);
    if (!re.test(lock)) throw new Error(`${CARGO_LOCK}: no entry for "${name}"`);
    lock = lock.replace(re, `$1${version}$3`);
  }
  write(CARGO_LOCK, lock);

  console.log(`Version set to ${version} in ${CARGO_TOML}, ${CARGO_LOCK}, ${JSON_FILES.join(", ")}.`);
  console.log(
    `Next: move the "## [Unreleased]" entries of ${CHANGELOG} into "## [${version}] - <date>", then \`pnpm check\`.`,
  );
}

const [command, arg] = process.argv.slice(2);
if (command === "check") check();
else if (command === "set") set(arg);
else {
  console.error("Usage: node scripts/version.mjs <set <x.y.z> | check>");
  process.exit(2);
}
