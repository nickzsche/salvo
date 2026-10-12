/**
 * Her kontrol saf bir fonksiyon: bir bağlam alır, bulgu dizisi döner.
 * `run` alanı olanlar kabuk çalıştırır; ötekiler yalnız dosya okur, bu yüzden
 * testlerde gerçek bir depo kurmadan denenebilirler.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const finding = (level, check, message, detail) => ({ level, check, message, detail });

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 }).trim();
}

/* ─────────────────────────────────────────────────────────── git-state ── */

export function gitState({ dir }) {
  const out = [];
  let status;
  try { status = sh("git", ["status", "--porcelain"], dir); }
  catch { return [finding("warn", "git-state", "Bir git deposu değil; sürüm ile kaynak arasındaki bağ doğrulanamıyor.")]; }

  if (status) {
    const files = status.split("\n").slice(0, 5).map((l) => l.trim()).join(", ");
    out.push(finding("error", "git-state",
      `Çalışma ağacı temiz değil — yayınlanacak şey hiçbir commit'e karşılık gelmiyor.`,
      files));
  }
  try {
    const ahead = sh("git", ["rev-list", "--count", "@{upstream}..HEAD"], dir);
    if (Number(ahead) > 0)
      out.push(finding("warn", "git-state",
        `${ahead} commit pushlanmamış. Yayınlanan sürümün kaynağı uzakta bulunmayacak.`));
  } catch { /* upstream yoksa sorun değil */ }
  return out;
}

/* ────────────────────────────────────────────────────────── entrypoints ── */

function collectEntrypoints(pkg) {
  const paths = new Set();
  for (const key of ["main", "module", "types", "browser", "unpkg", "jsdelivr"]) {
    if (typeof pkg[key] === "string") paths.add(pkg[key]);
  }
  const walk = (node) => {
    if (typeof node === "string") { if (!node.includes("*")) paths.add(node); return; }
    if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(pkg.exports);
  if (pkg.bin) {
    if (typeof pkg.bin === "string") paths.add(pkg.bin);
    else Object.values(pkg.bin).forEach((v) => typeof v === "string" && paths.add(v));
  }
  return [...paths];
}

export function entrypoints({ dir, pkg }) {
  return collectEntrypoints(pkg)
    .filter((p) => !existsSync(join(dir, p)))
    .map((p) => finding("error", "entrypoints",
      `package.json "${p}" dosyasını gösteriyor, o dosya yok.`,
      "Kurulan paket bu yolu çözemez; require/import hata verir."));
}

/* ────────────────────────────────────────────────────────── files-list ── */

const GLOB = /[*?[\]{}!]/;

/**
 * `files` beyaz listesindeki bir yol gerçekten var mı? npm var olmayan bir
 * girdiyi sessizce atlar — "LICENSE gönderiyorum" deyip göndermeyen bir paket
 * hiçbir hata vermez. Sürüm çubuğu yeniden adlandırılınca (ör. `dist`→`build`)
 * eski girdi kalır ve amaçlanan dosyalar pakete hiç girmez.
 *
 * Joker içeren girdiler atlanmaz: ilk joker karaktere kadarki gerçek dizin
 * öneki yoksa ("dist/**" ama dist/ hiç yok) bu da bir hatadır.
 */
export function filesList({ dir, pkg }) {
  if (!pkg.files) return [];
  const entries = typeof pkg.files === "string" ? [pkg.files] : pkg.files;
  const out = [];
  for (const raw of entries) {
    if (typeof raw !== "string") continue;
    const entry = raw.trim();
    if (!entry || entry.startsWith("!")) continue;

    // Joker varsa yalnız ilk joker içeren segmentten önceki dizine bak.
    const literal = entry.split(/[*?[\]{}!]/)[0].replace(/\/+$/, "");
    const probe = (GLOB.test(entry) ? literal : entry).replace(/^\.\//, "");
    if (!probe || existsSync(join(dir, probe))) continue;

    out.push(finding("error", "declared-files",
      `package.json files listesinde "${entry}" var, o yol yok.`,
      "npm bu girdiyi sessizce atlar; göndermeyi amaçladığın dosya pakete girmez."));
  }
  return out;
}

/* ───────────────────────────────────────────────────────── version-echo ── */


/**
 * Kaba ama yeterli yorum ayıklayıcı: dizge sınırlarını takip etmediği için
 * yorum benzeri metin içeren bir dizgeyi de siler. Bu yönde yanılmak
 * doğrusu — eksik tarama yanlış alarmdan iyidir, çünkü yanlış alarm aracı
 * kapattırır.
 */
function stripComments(text, rel) {
  if (rel.endsWith(".json")) return text;
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

const VERSION_PATTERNS = [
  /version\s*[:=]\s*["'`](\d+\.\d+\.\d+[^"'`]*)["'`]/g,
  /VERSION\s*=\s*["'`](\d+\.\d+\.\d+[^"'`]*)["'`]/g,
];

/**
 * Paketin içinde kendi sürümünü tekrar eden yerler package.json ile uyuşmalı.
 * bukalemun'da `var VERSION = '1.3.2'` sabiti tam olarak burada yakalanırdı.
 */
export function versionEcho({ dir, pkg, files }) {
  const out = [];
  const declared = pkg.version;
  for (const rel of files) {
    if (!/\.(m?js|cjs|ts|json)$/.test(rel)) continue;
    const full = join(dir, rel);
    let text;
    try { text = readFileSync(full, "utf8"); } catch { continue; }
    if (text.length > 4 << 20) continue;

    // Yorumlar ayıklanıyor: bu aracın kendi kaynağında, yakaladığı hatayı
    // anlatan bir yorumda "1.3.2" geçiyor ve kendi kendini engelledi.
    const code = stripComments(text, rel);

    const seen = new Set();
    for (const re of VERSION_PATTERNS) {
      re.lastIndex = 0;
      for (const m of code.matchAll(re)) seen.add(m[1]);
    }
    for (const v of seen) {
      if (v !== declared && !v.startsWith("0.0.0")) {
        out.push(finding("error", "version-echo",
          `${rel} içinde sürüm "${v}" yazıyor, package.json "${declared}" diyor.`,
          "Kurulan paket kendi sürümünü yanlış bildirir."));
      }
    }
  }
  return out;
}

/* ────────────────────────────────────────────────────────────── secrets ── */

const SECRET_NAMES = [/^\.env(\..+)?$/, /^\.npmrc$/, /^\.netrc$/, /\.pem$/, /\.p12$/, /^id_(rsa|ed25519)$/];
const SECRET_CONTENT = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "özel anahtar"],
  [/\bnpm_[A-Za-z0-9]{36}\b/, "npm token"],
  [/\bgh[pousr]_[A-Za-z0-9]{36}\b/, "GitHub token"],
  [/\bsk-[A-Za-z0-9]{20,}\b/, "API anahtarı"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS anahtarı"],
];

export function secrets({ dir, files }) {
  const out = [];
  for (const rel of files) {
    const base = rel.split("/").pop();
    if (SECRET_NAMES.some((re) => re.test(base))) {
      out.push(finding("error", "secrets", `${rel} pakete giriyor.`, "npm'e yüklenen tarball herkese açıktır."));
      continue;
    }
    if (!/\.(m?js|cjs|ts|json|txt|md|ya?ml)$/.test(rel)) continue;
    let text;
    try {
      if (statSync(join(dir, rel)).size > 2 << 20) continue;
      text = readFileSync(join(dir, rel), "utf8");
    } catch { continue; }
    for (const [re, label] of SECRET_CONTENT) {
      if (re.test(text)) {
        out.push(finding("error", "secrets", `${rel} içinde ${label} görünüyor.`, "Yayınlamadan önce iptal et."));
        break;
      }
    }
  }
  return out;
}

/* ──────────────────────────────────────────────────────────── tag-match ── */

export function tagMatch({ dir, pkg }) {
  let tags;
  try { tags = sh("git", ["tag", "--points-at", "HEAD"], dir).split("\n").filter(Boolean); }
  catch { return []; }
  if (!tags.length) {
    return [finding("warn", "tag-match",
      `HEAD'de etiket yok. ${pkg.version} yayınlanırsa hangi commit'ten çıktığı sonradan bulunamaz.`)];
  }
  const expected = [`v${pkg.version}`, pkg.version];
  if (!tags.some((t) => expected.includes(t))) {
    return [finding("warn", "tag-match",
      `HEAD'deki etiket(ler) ${tags.join(", ")}, sürüm ${pkg.version}.`)];
  }
  return [];
}

/* ─────────────────────────────────────────────────────────── build-drift ── */

function hashTree(root, dir) {
  const out = new Map();
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.set(relative(root, full), createHash("sha256").update(readFileSync(full)).digest("hex"));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/**
 * HEAD'i temiz bir dizine çıkarır, orada derler ve sonucu commit'li çıktı ile
 * karşılaştırır. Ayrışma varsa yayınlanacak dosyalar kaynağın karşılığı değil.
 */
export function buildDrift({ dir, pkg, buildDirs, buildScript = "build", install }) {
  const dirs = buildDirs.filter((d) => existsSync(join(dir, d)));
  if (!dirs.length) return [];
  if (!pkg.scripts?.[buildScript]) return [];

  const work = mkdtempSync(join(tmpdir(), "salvo-"));
  try {
    const archive = join(work, "src.tar");
    sh("git", ["archive", "-o", archive, "HEAD"], dir);
    sh("tar", ["-xf", archive, "-C", work], work);
    // Bağımlılığı olmayan bir pakette `npm ci` lockfile bulamayıp düşer;
    // kurulacak bir şey yoksa adımı atlamak doğru davranış.
    const needsInstall = Object.keys(pkg.dependencies ?? {}).length +
                         Object.keys(pkg.devDependencies ?? {}).length > 0;
    if (install && needsInstall) {
      try { sh(install[0], install.slice(1), work); }
      catch (err) {
        return [finding("warn", "build-drift",
          `Bağımlılıklar kurulamadığı için karşılaştırma yapılamadı: ${String(err.message).split("\n")[0]}`)];
      }
    }
    sh("npm", ["run", buildScript, "--silent"], work);

    const out = [];
    for (const d of dirs) {
      const mine = hashTree(join(dir, d), join(dir, d));
      const fresh = hashTree(join(work, d), join(work, d));
      const differing = [...mine].filter(([f, h]) => fresh.get(f) !== h).map(([f]) => f);
      const missing = [...fresh.keys()].filter((f) => !mine.has(f));
      if (differing.length || missing.length) {
        out.push(finding("error", "build-drift",
          `${d}/ HEAD'den yapılan derlemeyle aynı değil (${differing.length} farklı, ${missing.length} eksik dosya).`,
          [...differing.slice(0, 5), ...missing.slice(0, 3)].join(", ") +
          " — commit'li çıktı kaynağın karşılığı değil; `npm run " + buildScript + "` çalıştırıp commit'le."));
      }
    }
    return out;
  } catch (err) {
    return [finding("warn", "build-drift", `Karşılaştırma yapılamadı: ${String(err.message).split("\n")[0]}`)];
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export const ALL = { gitState, entrypoints, filesList, versionEcho, secrets, tagMatch, buildDrift };
export const NAMES = {
  gitState: "git-state", entrypoints: "entrypoints", filesList: "declared-files",
  versionEcho: "version-echo", secrets: "secrets", tagMatch: "tag-match", buildDrift: "build-drift",
};
