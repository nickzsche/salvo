#!/usr/bin/env node
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { entrypoints, versionEcho, secrets, gitState, tagMatch, buildDrift } from "../src/checks.mjs";

let pass = 0; const failures = [];
const test = (n, f) => { try { f(); pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}`); }
  catch (e) { failures.push(n); console.log(`  \x1b[31m✗\x1b[0m ${n}\n    \x1b[31m${e.message}\x1b[0m`); } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const hits = (f, check) => f.filter((x) => x.check === check);

function repo(files, { git = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "salvo-t-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  if (git) {
    const run = (...a) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
    run("init", "-q");
    run("config", "user.email", "t@t.t"); run("config", "user.name", "t");
    run("add", "-A"); run("commit", "-qm", "x");
  }
  return dir;
}

console.log("\n\x1b[1msalvo\x1b[0m\n");

// bukalemun@1.5.0: dist'te 1.3.2, package.json'da 1.5.0
test("pakete giren dosyadaki sürüm package.json ile ayrışırsa engel", () => {
  const dir = repo({
    "package.json": JSON.stringify({ name: "x", version: "1.5.0" }),
    "dist/x.js": "var VERSION = '1.3.2';\nexport default { version: VERSION };",
  });
  const f = versionEcho({ dir, pkg: { version: "1.5.0" }, files: ["dist/x.js"] });
  assert(hits(f, "version-echo").length === 1, `1 bulgu bekleniyordu, ${f.length}`);
  assert(f[0].level === "error", "engel olmalı");
  assert(f[0].message.includes("1.3.2") && f[0].message.includes("1.5.0"), "iki sürüm de yazılmalı");
  rmSync(dir, { recursive: true, force: true });
});

test("sürümler uyuşuyorsa ses çıkmıyor", () => {
  const dir = repo({ "package.json": "{}", "dist/x.js": 'const version = "2.0.0";' });
  assert(versionEcho({ dir, pkg: { version: "2.0.0" }, files: ["dist/x.js"] }).length === 0, "yanlış alarm");
  rmSync(dir, { recursive: true, force: true });
});

test("0.0.0-dev gibi yer tutucular sürüm sayılmıyor", () => {
  const dir = repo({ "package.json": "{}", "src/c.js": "var VERSION = '0.0.0-dev';" });
  assert(versionEcho({ dir, pkg: { version: "1.5.1" }, files: ["src/c.js"] }).length === 0,
    "derlemede değiştirilen yer tutucu hata sayıldı");
  rmSync(dir, { recursive: true, force: true });
});

test("olmayan giriş noktası yakalanıyor", () => {
  const dir = repo({ "package.json": "{}", "index.js": "" });
  const pkg = { main: "index.js", types: "types/index.d.ts", exports: { ".": "./index.js", "./css": "./dist/a.css" } };
  const f = entrypoints({ dir, pkg });
  assert(f.length === 2, `2 eksik bekleniyordu, ${f.length}`);
  assert(f.some((x) => x.message.includes("types/index.d.ts")), "types kaçtı");
  assert(f.some((x) => x.message.includes("dist/a.css")), "exports alt yolu kaçtı");
  rmSync(dir, { recursive: true, force: true });
});

test("joker içeren exports yolları eksik sayılmıyor", () => {
  const dir = repo({ "package.json": "{}" });
  assert(entrypoints({ dir, pkg: { exports: { "./styles/*": "./dist/styles/*" } } }).length === 0,
    "joker yol var olmayan dosya sanıldı");
  rmSync(dir, { recursive: true, force: true });
});

test(".env pakete girerse engel", () => {
  const dir = repo({ "package.json": "{}", ".env": "SECRET=1" });
  const f = secrets({ dir, files: [".env"] });
  assert(f.length === 1 && f[0].level === "error", ".env yakalanmadı");
  rmSync(dir, { recursive: true, force: true });
});

test("dosya içindeki özel anahtar yakalanıyor", () => {
  const dir = repo({ "package.json": "{}", "a.js": "const k = `-----BEGIN RSA PRIVATE KEY-----\\nAAA`;" });
  assert(secrets({ dir, files: ["a.js"] }).length === 1, "özel anahtar kaçtı");
  rmSync(dir, { recursive: true, force: true });
});

test("temiz dosyalarda gizli bilgi alarmı yok", () => {
  const dir = repo({ "package.json": "{}", "a.js": "export const hello = 'world';" });
  assert(secrets({ dir, files: ["a.js"] }).length === 0, "yanlış alarm");
  rmSync(dir, { recursive: true, force: true });
});

test("commit'lenmemiş değişiklik engel", () => {
  const dir = repo({ "package.json": "{}" });
  writeFileSync(join(dir, "yeni.js"), "//");
  const f = gitState({ dir });
  assert(f.some((x) => x.level === "error"), "kirli ağaç engel olmalıydı");
  rmSync(dir, { recursive: true, force: true });
});

test("git olmayan dizin çökmüyor, uyarıyor", () => {
  const dir = repo({ "package.json": "{}" }, { git: false });
  const f = gitState({ dir });
  assert(f.length === 1 && f[0].level === "warn", "git yoksa uyarı beklenirdi");
  rmSync(dir, { recursive: true, force: true });
});

test("HEAD etiketsizse uyarı veriliyor", () => {
  const dir = repo({ "package.json": "{}" });
  const f = tagMatch({ dir, pkg: { version: "1.0.0" } });
  assert(f.length === 1 && f[0].level === "warn", "etiketsiz HEAD uyarılmadı");
  rmSync(dir, { recursive: true, force: true });
});

// commit'li dist, kaynaktan üretilenden farklı
test("commit'li çıktı kaynakla ayrışmışsa engel", () => {
  const dir = repo({
    "package.json": JSON.stringify({ name: "d", version: "1.0.0", scripts: { build: "node build.js" } }),
    "build.js": "const fs=require('fs');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/out.js','DOĞRU');",
    "dist/out.js": "ESKİ",
  });
  const f = buildDrift({ dir, pkg: JSON.parse(require("node:fs").readFileSync(join(dir, "package.json"), "utf8")), buildDirs: ["dist"] });
  assert(f.length === 1 && f[0].level === "error", `ayrışma yakalanmadı: ${JSON.stringify(f)}`);
  assert(f[0].detail.includes("out.js"), "hangi dosya olduğu yazılmadı");
  rmSync(dir, { recursive: true, force: true });
});

test("çıktı kaynakla aynıysa ses çıkmıyor", () => {
  const dir = repo({
    "package.json": JSON.stringify({ name: "d", version: "1.0.0", scripts: { build: "node build.js" } }),
    "build.js": "const fs=require('fs');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/out.js','AYNI');",
    "dist/out.js": "AYNI",
  });
  const f = buildDrift({ dir, pkg: { scripts: { build: "node build.js" } }, buildDirs: ["dist"] });
  assert(f.length === 0, `yanlış alarm: ${JSON.stringify(f)}`);
  rmSync(dir, { recursive: true, force: true });
});

test("build script'i olmayan pakette karşılaştırma atlanıyor", () => {
  const dir = repo({ "package.json": "{}", "dist/a.js": "x" });
  assert(buildDrift({ dir, pkg: {}, buildDirs: ["dist"] }).length === 0, "derlemesi olmayan paket zorlandı");
  rmSync(dir, { recursive: true, force: true });
});

console.log(`\n  ${failures.length ? "\x1b[31m" : "\x1b[32m"}\x1b[1m${pass} geçti\x1b[0m, ${failures.length} kaldı\n`);
process.exit(failures.length ? 1 : 0);
