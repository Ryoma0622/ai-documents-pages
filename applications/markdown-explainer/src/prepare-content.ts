import { createHash } from "node:crypto";
import { cp, lstat, mkdir, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { inspectMarkdown, isExplainerMarkdown, parseMarkdown } from "./parser";
import { REPORT_ROOTS, type Manifest, type ManifestReport, type ReportFormat, type ReportRoot } from "./schema";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appRoot, "../..");
const publicRoot = join(appRoot, "public");
const pageOrigin = "https://pages.invalid/";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
function installGlobal(name: string, value: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  if (name === "navigator" && descriptor && !descriptor.writable && !descriptor.set) return;
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: descriptor?.enumerable ?? false,
    writable: true,
    value,
  });
}

for (const [name, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  DOMParser: dom.window.DOMParser,
  DocumentFragment: dom.window.DocumentFragment,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  HTMLTemplateElement: dom.window.HTMLTemplateElement,
  Node: dom.window.Node,
  NodeFilter: dom.window.NodeFilter,
  SVGElement: dom.window.SVGElement,
})) installGlobal(name, value);
const { default: mermaid } = await import("mermaid");

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  deterministicIds: true,
  htmlLabels: false,
});

type Candidate = {
  absolutePath: string;
  source: string;
  root: ReportRoot;
  format: ReportFormat;
  content: string;
  report: ManifestReport;
  assets: string[];
};

async function listReportFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symlink は公開対象 root に置けません: ${absolutePath}`);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && [".md", ".html"].includes(extname(entry.name).toLowerCase())) {
        output.push(absolutePath);
      }
    }
  }
  await visit(root);
  return output;
}

function sourcePath(absolutePath: string): { source: string; root: ReportRoot } {
  const repoRelative = relative(repoRoot, absolutePath).split(sep).join("/");
  const root = repoRelative.split("/")[0] as ReportRoot;
  if (!REPORT_ROOTS.includes(root)) throw new Error(`report root が不正です: ${repoRelative}`);
  return { source: `content/${repoRelative}`, root };
}

function sourceUrl(source: string): string {
  return new URL(source, pageOrigin).href;
}

function digest(markdown: string): string {
  return createHash("sha256").update(Buffer.from(markdown, "utf8")).digest("hex");
}

function htmlAssetUrls(html: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith("#") || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) continue;
    const clean = raw.split(/[?#]/, 1)[0];
    if (clean) urls.add(clean);
  }
  return [...urls];
}

function htmlReportMetadata(html: string, source: string, root: ReportRoot): ManifestReport {
  const document = new JSDOM(html).window.document;
  const text = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();
  const title = text(document.querySelector("title")?.textContent) || text(document.querySelector("h1")?.textContent) || basename(source, ".html");
  const summary = text(document.querySelector('meta[name="description"]')?.getAttribute("content")) || title;
  const publishedCandidate = text(document.querySelector('meta[property="article:published_time"], meta[name="published"]')?.getAttribute("content"));
  const pathYear = source.match(/(?:^|\/)20\d{2}(?:\/|$)/)?.[0]?.replace(/\//g, "");
  const published = /^\d{4}-\d{2}-\d{2}$/.test(publishedCandidate)
    ? publishedCandidate
    : pathYear
      ? `${pathYear}-01-01`
      : "1970-01-01";
  const sourceSlug = source.slice("content/".length, -".html".length).replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  const id = `html-${sourceSlug || digest(source).slice(0, 12)}`.slice(0, 80);
  return {
    format: "html",
    id,
    summary: summary.slice(0, 160) || title.slice(0, 160),
    published,
    lang: document.documentElement.getAttribute("lang") || "ja",
    tags: [],
    title: title.slice(0, 200),
    group: root,
    source,
    revision: digest(html),
  };
}

function resolveAssetPath(raw: string, source: string): string {
  const resolved = new URL(raw, sourceUrl(source));
  const sourceOrigin = new URL(pageOrigin).origin;
  if (resolved.protocol !== "https:" || resolved.origin !== sourceOrigin || resolved.search || !resolved.pathname.startsWith("/content/")) {
    throw new Error(`asset の URL が不正です: ${raw}`);
  }
  const assetRelative = decodeURIComponent(resolved.pathname.slice("/content/".length));
  const assetAbsolute = resolve(repoRoot, assetRelative);
  const outside = relative(repoRoot, assetAbsolute);
  if (outside.startsWith(`..${sep}`) || outside === ".." || outside.includes(`${sep}..${sep}`)) {
    throw new Error(`asset が repository 外を参照しています: ${raw}`);
  }
  return assetAbsolute;
}

async function copyAsset(raw: string, source: string): Promise<void> {
  const absolutePath = resolveAssetPath(raw, source);
  const fileInfo = await lstat(absolutePath).catch(() => null);
  if (!fileInfo?.isFile()) throw new Error(`参照 asset が存在しません: ${raw}`);
  const expected = extname(new URL(raw, sourceUrl(source)).pathname).slice(1).toLowerCase();
  const detected = await detectMediaExtension(absolutePath);
  const aliases: Record<string, string[]> = {
    jpg: ["jpg", "jpeg"],
    jpeg: ["jpg", "jpeg"],
    opus: ["ogg", "opus"],
  };
  const accepted = aliases[expected] ?? [expected];
  if (!detected || !accepted.includes(detected.ext)) throw new Error(`asset の MIME / 拡張子が一致しません: ${raw}`);
  const target = join(publicRoot, "content", relative(repoRoot, absolutePath));
  await mkdir(dirname(target), { recursive: true });
  await cp(absolutePath, target);
}

async function copyStaticAsset(raw: string, source: string): Promise<void> {
  const absolutePath = resolveAssetPath(raw, source);
  const sourceRoot = source.split("/")[1];
  const publishedRoot = resolve(repoRoot, sourceRoot);
  const outsidePublishedRoot = relative(publishedRoot, absolutePath);
  if (outsidePublishedRoot.startsWith(`..${sep}`) || outsidePublishedRoot === "..") {
    throw new Error(`HTML asset は同じ report root 内だけを参照できます: ${raw}`);
  }
  const fileInfo = await lstat(absolutePath).catch(() => null);
  if (!fileInfo?.isFile()) throw new Error(`HTML が参照する asset が存在しません: ${raw}`);
  const target = join(publicRoot, "content", relative(repoRoot, absolutePath));
  await mkdir(dirname(target), { recursive: true });
  await cp(absolutePath, target);
}

async function detectMediaExtension(path: string): Promise<{ ext: string } | undefined> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(64);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead);
    const text = (start: number, length: number): string => header.subarray(start, start + length).toString("ascii");
    if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png" };
    if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return { ext: "jpg" };
    if (text(0, 4) === "GIF8") return { ext: "gif" };
    if (text(0, 4) === "RIFF" && text(8, 4) === "WEBP") return { ext: "webp" };
    if (text(4, 4) === "ftyp") {
      const brand = text(8, 4);
      if (["avif", "avis"].includes(brand)) return { ext: "avif" };
      if (["M4A ", "isom", "mp42", "mp41"].includes(brand)) return { ext: "m4a" };
    }
    if (text(0, 4) === "fLaC") return { ext: "flac" };
    if (text(0, 4) === "OggS") return { ext: "ogg" };
    if (text(0, 4) === "RIFF" && text(8, 4) === "WAVE") return { ext: "wav" };
    if (header[0] === 0xff && (header[1] & 0xf6) === 0xf0) return { ext: "aac" };
    if (text(0, 3) === "ID3" || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)) return { ext: "mp3" };
    return undefined;
  } finally {
    await handle.close();
  }
}

async function collectCandidates(): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const ids = new Set<string>();
  for (const root of REPORT_ROOTS) {
    const directory = join(repoRoot, root);
    const files = await listReportFiles(directory).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    });
    for (const absolutePath of files) {
      const { source } = sourcePath(absolutePath);
      const content = await readFile(absolutePath, "utf8");
      if (extname(absolutePath).toLowerCase() === ".md") {
        if (!isExplainerMarkdown(content)) continue;
        const inspected = inspectMarkdown(content);
        if (ids.has(inspected.frontmatter.id)) throw new Error(`report id が重複しています: ${inspected.frontmatter.id}`);
        ids.add(inspected.frontmatter.id);
        candidates.push({
          absolutePath,
          source,
          root,
          format: "markdown",
          content,
          assets: inspected.assets,
          report: {
            format: "markdown",
            id: inspected.frontmatter.id,
            summary: inspected.frontmatter.summary,
            published: inspected.frontmatter.published,
            lang: inspected.frontmatter.lang,
            tags: inspected.frontmatter.tags,
            title: inspected.title,
            group: root,
            source,
            revision: digest(content),
          },
        });
        continue;
      }
      const report = htmlReportMetadata(content, source, root);
      if (ids.has(report.id)) throw new Error(`report id が重複しています: ${report.id}`);
      ids.add(report.id);
      candidates.push({
        absolutePath,
        source,
        root,
        format: "html",
        content,
        assets: htmlAssetUrls(content),
        report,
      });
    }
  }
  return candidates;
}

async function validateMermaidSources(sources: string[], source: string): Promise<void> {
  for (const [index, mermaidSource] of sources.entries()) {
    try {
      await mermaid.parse(mermaidSource);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Mermaid の構文が不正です（${source} の ${index + 1}個目）: ${detail}`);
    }
  }
}

async function main(): Promise<void> {
  await rm(publicRoot, { recursive: true, force: true });
  await mkdir(publicRoot, { recursive: true });
  const candidates = await collectCandidates();
  const reportMap = new Map(candidates.map((candidate) => [candidate.source, { id: candidate.report.id, source: candidate.source }]));

  for (const candidate of candidates) {
    const target = join(publicRoot, candidate.source);
    await mkdir(dirname(target), { recursive: true });
    if (candidate.format === "markdown") {
      const inspected = inspectMarkdown(candidate.content);
      await validateMermaidSources(inspected.mermaidSources, candidate.source);
      await parseMarkdown(candidate.content, { sourceUrl: sourceUrl(candidate.source), reports: reportMap, validateLinks: true });
      await cp(candidate.absolutePath, target);
      for (const asset of new Set(candidate.assets)) await copyAsset(asset, candidate.source);
    } else {
      await cp(candidate.absolutePath, target);
      for (const asset of new Set(candidate.assets)) await copyStaticAsset(asset, candidate.source);
    }
  }

  const reports = candidates
    .map((candidate) => candidate.report)
    .sort((left, right) => right.published.localeCompare(left.published) || left.id.localeCompare(right.id));
  const manifest: Manifest = { schemaVersion: 1, reports };
  await writeFile(join(publicRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(join(publicRoot, ".nojekyll"), "", "utf8");
}

await main();
