import { fromHtml } from "hast-util-from-html";
import { toHtml } from "hast-util-to-html";
import { defaultSchema, sanitize } from "hast-util-sanitize";
import GithubSlugger from "github-slugger";
import { unified } from "unified";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkDirective from "remark-directive";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import YAML from "yaml";
import { REPORT_ROOTS, type ManifestReport, type ParseOptions, type ParsedReport, type ReportFrontmatter, type ReportMapEntry } from "./schema";

type Node = {
  type: string;
  name?: string;
  value?: string;
  lang?: string | null;
  meta?: string | null;
  depth?: number;
  url?: string;
  alt?: string;
  attributes?: Record<string, string | null> | null;
  children?: Node[];
  position?: { start?: { line?: number; column?: number } };
};

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  value?: string;
  children?: HastNode[];
};

type ParserResult = {
  tree: Node;
  frontmatter: ReportFrontmatter;
  title: string;
  headings: string[];
  assets: string[];
};

const allowedDirectiveNames = new Set([
  "callout", "metrics", "metric", "tabs", "tab", "details", "board", "panel",
  "toc", "label", "text", "panes", "pane", "cards", "card", "modal",
]);
const allowedCalloutKinds = new Set(["note", "tip", "important", "warning", "danger"]);
const allowedMetricTones = new Set(["neutral", "positive", "warning", "negative"]);
const allowedLabelTones = new Set(["neutral", "accent", "positive", "warning", "danger"]);
const allowedLabelVariants = new Set(["soft", "solid", "outline"]);
const allowedLabelSizes = new Set(["sm", "md"]);
const allowedTextColors = new Set(["default", "muted", "accent", "positive", "warning", "danger"]);
const allowedTextSizes = new Set(["xs", "sm", "md", "lg", "xl"]);
const allowedAudioExtensions = new Set(["aac", "flac", "m4a", "mp3", "ogg", "opus", "wav"]);
const allowedImageExtensions = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);
const allowedPlotTypes = new Set(["bar", "line", "scatter"]);
const allowedSvgTags = new Set([
  "svg",
  "g",
  "defs",
  "clippath",
  "lineargradient",
  "radialgradient",
  "marker",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "stop",
  "text",
  "tspan",
]);
const allowedSvgAttributes = new Set([
  "viewbox",
  "preserveaspectratio",
  "id",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "width",
  "height",
  "transform",
  "opacity",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "font-size",
  "font-weight",
  "text-anchor",
  "offset",
  "stop-color",
  "stop-opacity",
  "marker-start",
  "marker-mid",
  "marker-end",
  "refx",
  "refy",
  "orient",
  "markerwidth",
  "markerheight",
]);
const allowedHtmlTags = [
  "address",
  "article",
  "abbr",
  "section",
  "aside",
  "div",
  "span",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "br",
  "hr",
  "strong",
  "em",
  "del",
  "ins",
  "s",
  "u",
  "small",
  "mark",
  "sub",
  "sup",
  "cite",
  "q",
  "kbd",
  "samp",
  "var",
  "time",
  "blockquote",
  "ul",
  "ol",
  "li",
  "pre",
  "code",
  "a",
  "img",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "dl",
  "dt",
  "dd",
  "figure",
  "figcaption",
  "button",
  "input",
  "main",
  "nav",
  "header",
  "footer",
  "hgroup",
  "details",
  "summary",
  "dialog",
  "audio",
  "svg",
  "g",
  "defs",
  "clipPath",
  "linearGradient",
  "radialGradient",
  "marker",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "stop",
  "text",
  "tspan",
  "title",
  "desc",
  "math",
  "semantics",
  "mrow",
  "mi",
  "mo",
  "mn",
  "msup",
  "msub",
  "msubsup",
  "mfrac",
  "msqrt",
  "mroot",
  "mover",
  "munder",
  "munderover",
  "mtable",
  "mtr",
  "mtd",
  "mtext",
  "mspace",
  "mpadded",
  "menclose",
  "mstyle",
  "mphantom",
  "merror",
  "mmultiscripts",
  "mprescripts",
  "none",
  "annotation",
];

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MAX_FRONTMATTER_BYTES = 16 * 1024;
const MAX_SVG_BYTES = 256 * 1024;
const MAX_MERMAID_BYTES = 32 * 1024;
const MAX_PLOT_BYTES = 128 * 1024;
const MAX_SANDBOX_BYTES = 128 * 1024;
const MAX_SANDBOX_COUNT = 4;
const MAX_BOARD_ROWS = 6;

const commonAttributes = [
  "className",
  "id",
  "role",
  "title",
  "lang",
  "ariaLabel",
  "ariaLabelledBy",
  "ariaDescribedBy",
  "ariaCurrent",
  "ariaControls",
  "ariaSelected",
  "ariaLive",
  "ariaHidden",
  "tabIndex",
  "hidden",
  "dataComponent",
  "dataTabsId",
  "dataTabId",
  "dataTabLabel",
  "dataAudio",
  "dataAudioSrc",
  "dataAudioIndex",
  "dataAudioPlayer",
  "dataFootnotes",
  "dataFootnoteRef",
  "dataFootnoteBackref",
  "dataFootnoteBackrefs",
  "dataMermaid",
  "dataMermaidCanvas",
  "dataMermaidSource",
  "dataMermaidTitle",
  "dataMermaidDescription",
  "dataPlot",
  "dataRendererHeading",
  "dataBoardColumns",
  "dataPanelX",
  "dataPanelY",
  "dataPanelW",
  "dataPanelH",
  "dataToc",
  "dataTocMinLevel",
  "dataTocMaxLevel",
  "dataTocOrdered",
  "dataTocMobile",
  "dataLabel",
  "dataText",
  "dataPanesColumns",
  "dataPane",
  "dataCardsColumns",
  "dataCard",
  "dataCardLabel",
  "dataModalId",
  "dataModalOpen",
  "dataModalDialog",
  "dataModalClose",
  "dataSandbox",
  "dataSandboxTitle",
  "dataSandboxDescription",
  "dataSandboxHeight",
  "dataSandboxScripts",
  "dataSandboxSource",
  "dataSandboxRun",
  "dataSandboxStop",
  "dataSandboxCanvas",
];

const svgAttributeNames = [
  "viewBox",
  "preserveAspectRatio",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "width",
  "height",
  "transform",
  "opacity",
  "fill",
  "fillOpacity",
  "fillRule",
  "stroke",
  "strokeWidth",
  "strokeOpacity",
  "strokeLinecap",
  "strokeLinejoin",
  "strokeDasharray",
  "strokeDashoffset",
  "fontSize",
  "fontWeight",
  "textAnchor",
  "offset",
  "stopColor",
  "stopOpacity",
  "markerStart",
  "markerMid",
  "markerEnd",
  "refX",
  "refY",
  "orient",
  "markerWidth",
  "markerHeight",
];

const sanitizeSchema = {
  ...defaultSchema,
  clobber: ["id"],
  clobberPrefix: "user-content-",
  tagNames: allowedHtmlTags,
  attributes: {
    ...defaultSchema.attributes,
    "*": commonAttributes,
    span: [...commonAttributes, "style"],
    section: [...commonAttributes],
    a: [...commonAttributes, "href", "download"],
    img: [...commonAttributes, "src", "alt", "width", "height", "loading", "decoding"],
    button: [...commonAttributes, "type"],
    input: [...commonAttributes, "type", "disabled", "checked"],
    details: [...commonAttributes, "open"],
    dialog: [...commonAttributes, "open"],
    audio: [...commonAttributes, "controls", "preload", "src"],
    q: [...commonAttributes, "cite"],
    time: [...commonAttributes, "dateTime"],
    math: [...commonAttributes, "xmlns", "display"],
    annotation: [...commonAttributes, "encoding"],
    table: [...commonAttributes],
    ol: [...commonAttributes],
    ul: [...commonAttributes],
    th: [...commonAttributes, "colSpan", "rowSpan", "align"],
    td: [...commonAttributes, "colSpan", "rowSpan", "align"],
    svg: [...commonAttributes, ...svgAttributeNames],
    g: [...commonAttributes, ...svgAttributeNames],
    defs: [...commonAttributes, ...svgAttributeNames],
    clipPath: [...commonAttributes, ...svgAttributeNames],
    linearGradient: [...commonAttributes, ...svgAttributeNames],
    radialGradient: [...commonAttributes, ...svgAttributeNames],
    marker: [...commonAttributes, ...svgAttributeNames],
    path: [...commonAttributes, ...svgAttributeNames],
    rect: [...commonAttributes, ...svgAttributeNames],
    circle: [...commonAttributes, ...svgAttributeNames],
    ellipse: [...commonAttributes, ...svgAttributeNames],
    line: [...commonAttributes, ...svgAttributeNames],
    polyline: [...commonAttributes, ...svgAttributeNames],
    polygon: [...commonAttributes, ...svgAttributeNames],
    stop: [...commonAttributes, ...svgAttributeNames],
    text: [...commonAttributes, ...svgAttributeNames],
    tspan: [...commonAttributes, ...svgAttributeNames],
    title: [...commonAttributes, ...svgAttributeNames],
    desc: [...commonAttributes, ...svgAttributeNames],
  },
};

function fail(message: string, node?: Node): never {
  const line = node?.position?.start?.line;
  const location = line ? `（${line}行目）` : "";
  throw new Error(`${message}${location}`);
}

function textContent(node: Node): string {
  if (["text", "inlineCode", "code", "inlineMath", "math"].includes(node.type)) return node.value ?? "";
  return (node.children ?? []).map(textContent).join("");
}

function childrenText(node: Node): string {
  return (node.children ?? []).map(textContent).join("").trim();
}

function requireAttrs(node: Node, allowed: string[], required: string[] = []): Record<string, string> {
  const attrs = node.attributes ?? {};
  for (const key of Object.keys(attrs)) {
    if (!allowed.includes(key)) fail(`directive ${node.name} の属性 ${key} は許可されていません`, node);
    if (attrs[key] === null) fail(`directive ${node.name} の属性 ${key} は空にできません`, node);
  }
  for (const key of required) {
    if (!(key in attrs) || attrs[key] === null) fail(`directive ${node.name} に属性 ${key} が必要です`, node);
  }
  return Object.fromEntries(Object.entries(attrs).map(([key, value]) => [key, value ?? ""]));
}

function ensureLength(value: string, label: string, min: number, max: number, node?: Node): void {
  if (value.length < min || value.length > max) fail(`${label} は ${min}〜${max}文字で指定してください`, node);
}

function parseFrontmatter(tree: Node): ReportFrontmatter {
  const children = tree.children ?? [];
  const yamlNodes = children.filter((child) => child.type === "yaml");
  if (yamlNodes.length !== 1 || children[0]?.type !== "yaml") fail("先頭に YAML front matter を一つだけ指定してください");
  const yamlNode = yamlNodes[0];
  const document = YAML.parseDocument(yamlNode.value ?? "", { schema: "core", uniqueKeys: true });
  if (document.errors.length || document.warnings.length) fail("front matter の YAML が不正です", yamlNode);
  if (/(^|[\s\[\]{},:])(?:&|\*)[A-Za-z0-9_-]+/.test(yamlNode.value ?? "")) {
    fail("front matter の anchor / alias は許可されていません", yamlNode);
  }
  const data = document.toJS({ mapAsMap: false }) as Record<string, unknown>;
  const allowed = new Set(["explainer", "hybridMarkdown", "id", "summary", "published", "lang", "tags"]);
  for (const key of Object.keys(data ?? {})) if (!allowed.has(key)) fail(`front matter のキー ${key} は許可されていません`, yamlNode);
  if (data?.explainer !== true) fail("公開対象の front matter には explainer: true が必要です", yamlNode);
  if (data?.hybridMarkdown !== 1) fail("front matter には hybridMarkdown: 1 が必要です", yamlNode);
  const id = typeof data.id === "string" ? data.id : "";
  const summary = typeof data.summary === "string" ? data.summary : "";
  const published = typeof data.published === "string" ? data.published : "";
  const lang = typeof data.lang === "string" ? data.lang : "";
  const tags = Array.isArray(data.tags) && data.tags.every((tag) => typeof tag === "string") ? data.tags as string[] : [];
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) fail("front matter の id が不正です", yamlNode);
  ensureLength(summary, "front matter の summary", 1, 160, yamlNode);
  if (/[\r\n]/.test(summary)) fail("front matter の summary に改行は指定できません", yamlNode);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(published)) fail("front matter の published は YYYY-MM-DD で指定してください", yamlNode);
  try {
    new Intl.Locale(lang);
  } catch {
    fail("front matter の lang が不正です", yamlNode);
  }
  if (tags.length > 8 || new Set(tags).size !== tags.length) fail("front matter の tags は重複しない0〜8件で指定してください", yamlNode);
  for (const tag of tags) ensureLength(tag, "front matter の tag", 1, 32, yamlNode);
  return { explainer: true, hybridMarkdown: 1, id, summary, published, lang, tags };
}

function parseFenceInfo(meta: string | null | undefined, node: Node): Record<string, string> {
  const raw = (meta ?? "").trim();
  if (!raw) return {};
  if (!raw.startsWith("{") || !raw.endsWith("}")) fail("fence の属性は {key=\"value\"} 形式で指定してください", node);
  const body = raw.slice(1, -1).trim();
  const attrs: Record<string, string> = {};
  const pattern = /([a-z][A-Za-z0-9-]*)="([^"\\]*(?:\\.[^"\\]*)*)"/gy;
  let cursor = 0;
  while (cursor < body.length) {
    while (/\s/.test(body[cursor] ?? "")) cursor += 1;
    pattern.lastIndex = cursor;
    const match = pattern.exec(body);
    if (!match || match.index !== cursor || Object.prototype.hasOwnProperty.call(attrs, match[1])) fail("fence の属性が不正です", node);
    attrs[match[1]] = match[2];
    cursor = pattern.lastIndex;
  }
  return attrs;
}

function assertUniqueAttributeSyntax(raw: string, label: string): void {
  const body = raw.trim();
  if (!body) return;
  if (!body.startsWith("{") || !body.endsWith("}")) throw new Error(`${label} の属性が不正です`);
  const source = body.slice(1, -1).trim();
  const attrs = new Set<string>();
  const pattern = /([a-z][A-Za-z0-9-]*)="([^"\\]*(?:\\.[^"\\]*)*)"/gy;
  let cursor = 0;
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    pattern.lastIndex = cursor;
    const match = pattern.exec(source);
    if (!match || match.index !== cursor) throw new Error(`${label} の属性が不正です`);
    if (attrs.has(match[1])) throw new Error(`${label} の属性 ${match[1]} が重複しています`);
    attrs.add(match[1]);
    cursor = pattern.lastIndex;
  }
}

function validateRawAttributeSyntax(markdown: string): void {
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    const fence = /^```([A-Za-z0-9-]+)(?:\s+(\{.*\}))?\s*$/.exec(line);
    if (fenced) {
      if (/^```\s*$/.test(line)) fenced = false;
      continue;
    }
    if (fence) {
      if (["mermaid", "svg", "audio", "plot", "sandbox-html"].includes(fence[1].toLowerCase())) assertUniqueAttributeSyntax(fence[2] ?? "", `${fence[1]} fence`);
      fenced = true;
      continue;
    }
    const directive = /^\s*:{2,}[a-z][a-z0-9-]*(?:\[[^\]]*\])?(\{.*\})?\s*$/.exec(line);
    if (directive) {
      assertUniqueAttributeSyntax(directive[1] ?? "", "directive");
      continue;
    }
    for (const match of line.matchAll(/(?<![A-Za-z0-9_]):{1,2}([a-z][a-z0-9-]*)\[[^\]]*\](\{[^{}]*\})?/g)) {
      const name = match[1] === "metric" && line.slice(Math.max(0, (match.index ?? 0)), (match.index ?? 0) + 2) === "::" ? "metric" : match[1];
      if (!["label", "text", "metric"].includes(name)) throw new Error(`未知の inline directive ${match[1]}`);
      assertUniqueAttributeSyntax(match[2] ?? "", `${name} directive`);
    }
  }
}

function parseAudio(value: string, node: Node): { title: string; caption: string; tracks: { src: string; label: string }[] } {
  let title = "音声解説";
  let caption = "";
  let hasTitle = false;
  const tracks: { src: string; label: string }[] = [];
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf(":");
    if (separator < 1) fail("audio fence は key: value 形式で指定してください", node);
    const key = trimmed.slice(0, separator).trim();
    const item = trimmed.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    if (!["title", "caption", "src", "label"].includes(key)) fail(`audio fence のキー ${key} は許可されていません`, node);
    if (key === "title") {
      if (hasTitle) fail("audio fence の title は一つだけ指定できます", node);
      ensureLength(item, "audio の title", 1, 120, node);
      hasTitle = true;
      title = item;
    } else if (key === "caption") {
      if (caption || !item) fail("audio fence の caption は一つだけ指定でき、空にできません", node);
      ensureLength(item, "audio の caption", 1, 160, node);
      caption = item;
    } else if (key === "label") {
      if (!tracks.length || tracks[tracks.length - 1].label || !item) fail("audio fence の label は直前の src に一つだけ指定し、空にできません", node);
      ensureLength(item, "audio の label", 1, 80, node);
      tracks[tracks.length - 1].label = item;
    } else {
      if (tracks.length >= 20 || !item) fail("audio fence の src は1〜20件で指定してください", node);
      tracks.push({ src: item, label: "" });
    }
  }
  if (!tracks.length) fail("audio fence には src が必要です", node);
  for (const track of tracks) {
    const extension = track.src.toLowerCase().split("?")[0].split(".").pop() ?? "";
    if (!allowedAudioExtensions.has(extension)) fail(`audio の拡張子 .${extension} は許可されていません`, node);
  }
  ensureLength(title, "audio の title", 1, 120, node);
  caption ||= title;
  ensureLength(caption, "audio の caption", 1, 160, node);
  return { title, caption, tracks };
}

function validateSvgNode(node: HastNode, root = true): void {
  if (node.type === "text") return;
  if (node.type !== "element" || !node.tagName || !allowedSvgTags.has(node.tagName.toLowerCase())) fail("SVG に許可されていない要素があります");
  const tag = node.tagName.toLowerCase();
  const properties = node.properties ?? {};
  for (const [key, value] of Object.entries(properties)) {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const allowed = [...allowedSvgAttributes].some((attribute) => attribute.replace(/[^a-z0-9]/gi, "").toLowerCase() === normalized);
    if (normalized.startsWith("on") || normalized === "style" || normalized === "href" || normalized === "xlinkhref" || !allowed) fail(`SVG の属性 ${key} は許可されていません`);
    if (typeof value === "string" && /url\s*\(/i.test(value) && !/^url\(#[-\w:.]+\)$/.test(value)) fail("SVG の url() は同一 SVG 内の参照だけ許可されます");
  }
  if (root && tag !== "svg") fail("SVG fence のルート要素は svg である必要があります");
  if (root && !properties.viewBox && !properties.viewbox) fail("SVG fence には viewBox が必要です");
  for (const child of node.children ?? []) validateSvgNode(child, false);
}

function normalizeSvgReferences(node: HastNode, index: number): void {
  const ids = new Map<string, string>();
  walkHast(node, (child) => {
    if (child.type !== "element" || !child.properties || typeof child.properties.id !== "string") return;
    const sourceId = child.properties.id;
    const normalized = `svg-${index}-${sourceId}`;
    ids.set(sourceId, normalized);
    child.properties.id = normalized;
  });
  walkHast(node, (child) => {
    if (child.type !== "element" || !child.properties) return;
    for (const [key, value] of Object.entries(child.properties)) {
      if (typeof value !== "string") continue;
      child.properties[key] = value.replace(/url\(#([-\w:.]+)\)/g, (_match, sourceId: string) => {
        const normalized = ids.get(sourceId);
        return normalized ? `url(#user-content-${normalized})` : `url(#${sourceId})`;
      });
    }
  });
}

function renderSvg(value: string, meta: string | null | undefined, node: Node, index: number): HastNode {
  const attrs = parseFenceInfo(meta, node);
  const allowed = new Set(["title", "description", "decorative"]);
  for (const key of Object.keys(attrs)) if (!allowed.has(key)) fail(`SVG fence の属性 ${key} は許可されていません`, node);
  const decorative = attrs.decorative === "true";
  if (attrs.decorative && !["true", "false"].includes(attrs.decorative)) fail("SVG fence の decorative は true または false です", node);
  if (decorative ? attrs.title || attrs.description : !attrs.title || !attrs.description) fail("SVG fence の title / description を確認してください", node);
  const parsed = fromHtml(value.trim(), { fragment: true }) as unknown as HastNode;
  const roots = (parsed.children ?? []).filter((child) => child.type !== "text" || (child.value ?? "").trim());
  if (roots.length !== 1) fail("SVG fence は一つの SVG だけを含めてください", node);
  validateSvgNode(roots[0], true);
  const svg = roots[0];
  normalizeSvgReferences(svg, index);
  svg.properties ??= {};
  if (decorative) {
    svg.properties.ariaHidden = true;
  } else {
    const titleId = `svg-${index}-title`;
    const descId = `svg-${index}-desc`;
    svg.properties.role = "img";
    svg.properties.ariaLabelledBy = `user-content-${titleId} user-content-${descId}`;
    svg.children = [
      { type: "element", tagName: "title", properties: { id: titleId }, children: [{ type: "text", value: attrs.title }] },
      { type: "element", tagName: "desc", properties: { id: descId }, children: [{ type: "text", value: attrs.description }] },
      ...(svg.children ?? []),
    ];
  }
  return {
    type: "element",
    tagName: "figure",
    properties: { className: ["mdx-svg"], dataComponent: "svg" },
    children: [svg],
  };
}

type MermaidInfo = {
  title: string;
  description: string;
};

function parseMermaidInfo(value: string, meta: string | null | undefined, node: Node): MermaidInfo {
  const attrs = parseFenceInfo(meta, node);
  for (const key of Object.keys(attrs)) if (!["title", "description"].includes(key)) fail(`Mermaid fence の属性 ${key} は許可されていません`, node);
  if (/%%\s*\{[\s\S]*?\}%%/i.test(value)) fail("Mermaid の init/initialize/config directive は許可されていません", node);
  if (/(^|\n)\s*(?:click|href|callback)\b/i.test(value)) fail("Mermaid の外部遷移／callback は許可されていません", node);
  const title = attrs.title || "Mermaid diagram";
  const description = attrs.description || "Mermaid 記法から生成された図解です。";
  ensureLength(value.trim(), "Mermaid のソース", 1, MAX_MERMAID_BYTES, node);
  ensureLength(title, "Mermaid の title", 1, 120, node);
  ensureLength(description, "Mermaid の description", 1, 240, node);
  return { title, description };
}

type PlotDatum = { x: string; y: number };
type PlotInfo = { type: "bar" | "line" | "scatter"; title: string; xLabel: string; yLabel: string; data: PlotDatum[] };

function parsePlot(value: string, meta: string | null | undefined, node: Node): PlotInfo {
  const attrs = parseFenceInfo(meta, node);
  for (const key of Object.keys(attrs)) if (!["type", "title", "xLabel", "yLabel"].includes(key)) fail(`plot fence の属性 ${key} は許可されていません`, node);
  const type = attrs.type || "line";
  if (!allowedPlotTypes.has(type)) fail("plot の type は bar、line、scatter のいずれかです", node);
  const data: PlotDatum[] = [];
  for (const line of value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    let item: unknown;
    try {
      item = JSON.parse(line);
    } catch {
      fail("plot fence は x と y を持つJSON Linesで指定してください", node);
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) fail("plot の各行はJSONオブジェクトで指定してください", node);
    const record = item as Record<string, unknown>;
    if (Object.keys(record).sort().join(",") !== "x,y" || typeof record.x !== "string" || typeof record.y !== "number" || !Number.isFinite(record.y)) {
      fail("plot の各行は {\"x\":文字列,\"y\":数値} だけを持つ必要があります", node);
    }
    ensureLength(record.x, "plot の x", 1, 80, node);
    data.push({ x: record.x, y: record.y });
  }
  if (data.length < 2 || data.length > 24) fail("plot のデータは2〜24行で指定してください", node);
  return {
    type: type as PlotInfo["type"],
    title: attrs.title || "データプロット",
    xLabel: attrs.xLabel || "",
    yLabel: attrs.yLabel || "",
    data,
  };
}

function plotText(value: number): string {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);
}

function renderPlot(value: string, meta: string | null | undefined, node: Node, index: number): HastNode {
  const plot = parsePlot(value, meta, node);
  const width = 720;
  const height = 360;
  const left = 72;
  const right = 24;
  const top = 48;
  const bottom = 64;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const values = plot.data.map((item) => item.y);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = rawMin === rawMax ? Math.max(1, Math.abs(rawMin) * 0.1) : (rawMax - rawMin) * 0.1;
  const min = rawMin - padding;
  const max = rawMax + padding;
  const xAt = (position: number): number => left + (plot.data.length === 1 ? chartWidth / 2 : (position / (plot.data.length - 1)) * chartWidth);
  const yAt = (valueAt: number): number => top + ((max - valueAt) / (max - min)) * chartHeight;
  const titleId = `plot-${index}-title`;
  const descriptionId = `plot-${index}-description`;
  const grid = Array.from({ length: 5 }, (_, gridIndex) => {
    const valueAt = max - ((max - min) * gridIndex) / 4;
    const y = yAt(valueAt);
    return [
      makeElement("line", { className: ["mdx-plot-grid"], x1: left, y1: y, x2: width - right, y2: y }),
      makeElement("text", { className: ["mdx-plot-axis-label"], x: left - 10, y: y + 4, textAnchor: "end" }, [makeText(plotText(valueAt))]),
    ];
  }).flat();
  const xLabels = plot.data.map((item, itemIndex) => {
    const x = xAt(itemIndex);
    return makeElement("text", { className: ["mdx-plot-axis-label", "mdx-plot-x-label"], x, y: height - 28, textAnchor: "middle" }, [makeText(item.x)]);
  });
  const zeroY = rawMin <= 0 && rawMax >= 0 ? yAt(0) : height - bottom;
  const axis = [
    makeElement("line", { className: ["mdx-plot-axis"], x1: left, y1: top, x2: left, y2: height - bottom }),
    makeElement("line", { className: ["mdx-plot-axis"], x1: left, y1: zeroY, x2: width - right, y2: zeroY }),
  ];
  const marks: HastNode[] = [];
  if (plot.type === "line" || plot.type === "scatter") {
    if (plot.type === "line") {
      const path = plot.data.map((item, itemIndex) => `${itemIndex ? "L" : "M"}${xAt(itemIndex).toFixed(2)} ${yAt(item.y).toFixed(2)}`).join(" ");
      marks.push(makeElement("path", { className: ["mdx-plot-line"], d: path }));
    }
    for (const [itemIndex, item] of plot.data.entries()) marks.push(makeElement("circle", { className: ["mdx-plot-point"], cx: xAt(itemIndex), cy: yAt(item.y), r: plot.type === "line" ? 4 : 6 }));
  } else {
    const slot = chartWidth / plot.data.length;
    const barWidth = Math.min(48, slot * 0.68);
    for (const [itemIndex, item] of plot.data.entries()) {
      const x = left + slot * itemIndex + (slot - barWidth) / 2;
      const y = yAt(item.y);
      const barTop = Math.min(y, zeroY);
      marks.push(makeElement("rect", { className: ["mdx-plot-bar"], x, y: barTop, width: barWidth, height: Math.max(1, Math.abs(zeroY - y)), rx: 4 }));
    }
  }
  const description = `${plot.title}。${plot.data.length}件のデータを${plot.type}形式で表示しています。`;
  const svg = makeElement("svg", {
    className: ["mdx-plot-svg"],
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    ariaLabelledBy: `user-content-${titleId} user-content-${descriptionId}`,
  }, [
    makeElement("title", { id: titleId }, [makeText(plot.title)]),
    makeElement("desc", { id: descriptionId }, [makeText(description)]),
    ...grid,
    ...axis,
    ...marks,
    ...xLabels,
    ...(plot.xLabel ? [makeElement("text", { className: ["mdx-plot-axis-title"], x: left + chartWidth / 2, y: height - 4, textAnchor: "middle" }, [makeText(plot.xLabel)])] : []),
    ...(plot.yLabel ? [makeElement("text", { className: ["mdx-plot-axis-title"], x: 16, y: top + chartHeight / 2, textAnchor: "middle", transform: `rotate(-90 16 ${top + chartHeight / 2})` }, [makeText(plot.yLabel)])] : []),
  ]);
  return makeElement("figure", { className: ["mdx-plot"], dataComponent: "plot" }, [
    makeElement("figcaption", {}, [makeText(plot.title)]),
    svg,
    makeElement("details", { className: ["mdx-plot-data"] }, [
      makeElement("summary", {}, [makeText("データを表示")]),
      makeElement("pre", {}, [makeElement("code", { className: ["language-json"] }, [makeText(value.trim())])]),
    ]),
  ]);
}

function renderMermaid(value: string, meta: string | null | undefined, node: Node): HastNode {
  const info = parseMermaidInfo(value, meta, node);
  return makeElement("figure", {
    className: ["mdx-mermaid"],
    dataComponent: "mermaid",
    dataMermaid: "true",
    dataMermaidTitle: info.title,
    dataMermaidDescription: info.description,
  }, [
    makeElement("figcaption", {}, [makeText(info.title)]),
    makeElement("div", { className: ["mdx-mermaid-canvas"], dataMermaidCanvas: "true" }, [
      makeElement("pre", {}, [makeElement("code", { className: ["language-mermaid"], dataMermaidSource: "true" }, [makeText(value.trim())])]),
    ]),
    makeElement("details", { className: ["mdx-diagram-source"] }, [
      makeElement("summary", {}, [makeText("Mermaidソースを表示")]),
      makeElement("pre", {}, [makeElement("code", { className: ["language-mermaid"] }, [makeText(value.trim())])]),
    ]),
  ]);
}

function makeText(value: string): HastNode {
  return { type: "text", value };
}

function makeElement(tagName: string, properties: Record<string, unknown>, children: HastNode[] = []): HastNode {
  return { type: "element", tagName, properties, children };
}

function directiveAttrs(node: Node, name: string, allowed: string[], required: string[] = []): Record<string, string> {
  return requireAttrs({ ...node, name }, allowed, required);
}

function createHandlers() {
  let svgIndex = 0;
  const headingSlugger = new GithubSlugger();
  return {
    heading(state: any, node: Node): HastNode {
      const depth = node.depth ?? 1;
      return makeElement(`h${depth}`, { id: headingSlugger.slug(childrenText(node)) }, state.all(node) as HastNode[]);
    },
    table(state: any, node: Node): HastNode {
      return makeElement("div", { className: ["mdx-table-scroll"], role: "region", ariaLabel: "表", tabIndex: 0 }, [
        makeElement("table", {}, state.all(node) as HastNode[]),
      ]);
    },
    containerDirective(state: any, node: Node): HastNode {
      const attrs = node.attributes ?? {};
      const children = state.all(node) as HastNode[];
      if (node.name === "callout") {
        const values = directiveAttrs(node, "callout", ["kind", "title"], ["kind"]);
        if (!allowedCalloutKinds.has(values.kind)) fail("callout の kind が不正です", node);
        ensureLength(values.kind, "callout の kind", 1, 16, node);
        if (values.title) ensureLength(values.title, "callout の title", 1, 80, node);
        return makeElement("aside", { className: ["mdx-callout", `is-${values.kind}`], dataComponent: "callout", role: "note" }, [
          makeElement("p", { className: ["mdx-callout-kind"] }, [makeText(values.kind)]),
          ...(values.title ? [makeElement("h3", { dataRendererHeading: "true" }, [makeText(values.title)])] : []),
          makeElement("div", { className: ["mdx-callout-body"] }, children),
        ]);
      }
      if (node.name === "metrics") {
        const values = directiveAttrs(node, "metrics", ["label", "columns"], ["label", "columns"]);
        ensureLength(values.label, "metrics の label", 1, 80, node);
        if (!["2", "3"].includes(values.columns)) fail("metrics の columns は 2 または 3 です", node);
        return makeElement("section", { className: ["mdx-metrics", `columns-${values.columns}`], dataComponent: "metrics", ariaLabel: values.label }, [
          makeElement("h3", { dataRendererHeading: "true" }, [makeText(values.label)]),
          makeElement("dl", {}, children),
        ]);
      }
      if (node.name === "tabs") {
        const values = directiveAttrs(node, "tabs", ["id", "label"], ["id", "label"]);
        if (!/^[a-z][a-z0-9-]{0,47}$/.test(values.id)) fail("tabs の id が不正です", node);
        ensureLength(values.label, "tabs の label", 1, 80, node);
        return makeElement("section", { className: ["mdx-tabs"], dataComponent: "tabs", dataTabsId: values.id, ariaLabel: values.label }, [
          makeElement("h3", { className: ["visually-hidden"], dataRendererHeading: "true" }, [makeText(values.label)]),
          makeElement("div", { className: ["mdx-tab-list"], role: "tablist", ariaLabel: values.label }),
          makeElement("div", { className: ["mdx-tab-panels"] }, children),
        ]);
      }
      if (node.name === "tab") {
        const values = directiveAttrs(node, "tab", ["id", "label"], ["id", "label"]);
        if (!/^[a-z][a-z0-9-]{0,47}$/.test(values.id)) fail("tab の id が不正です", node);
        ensureLength(values.label, "tab の label", 1, 40, node);
        return makeElement("div", { className: ["mdx-tab-panel"], dataTabId: values.id, dataTabLabel: values.label, role: "tabpanel" }, children);
      }
      if (node.name === "details") {
        const values = directiveAttrs(node, "details", ["summary", "open"], ["summary", "open"]);
        ensureLength(values.summary, "details の summary", 1, 80, node);
        if (!["true", "false"].includes(values.open)) fail("details の open は true または false です", node);
        return makeElement("details", { className: ["mdx-details"], open: values.open === "true", dataComponent: "details" }, [
          makeElement("summary", {}, [makeText(values.summary)]),
          ...children,
        ]);
      }
      if (node.name === "board") {
        const values = directiveAttrs(node, "board", ["label", "columns"], ["label", "columns"]);
        ensureLength(values.label, "board の label", 1, 80, node);
        if (!["2", "3", "4"].includes(values.columns)) fail("board の columns は 2〜4 です", node);
        return makeElement("section", { className: ["mdx-board", `columns-${values.columns}`], dataComponent: "board", dataBoardColumns: values.columns, ariaLabel: values.label }, [
          makeElement("h3", { dataRendererHeading: "true" }, [makeText(values.label)]),
          makeElement("div", { className: ["mdx-board-grid"] }, children),
        ]);
      }
      if (node.name === "panel") {
        const values = directiveAttrs(node, "panel", ["title", "x", "y", "w", "h"], ["title", "x", "y"]);
        ensureLength(values.title, "panel の title", 1, 80, node);
        const x = parseGridInteger(values.x, "panel の x", 1, 4, node);
        const y = parseGridInteger(values.y, "panel の y", 1, MAX_BOARD_ROWS, node);
        const w = parseGridInteger(values.w ?? "1", "panel の w", 1, 4, node);
        const h = parseGridInteger(values.h ?? "1", "panel の h", 1, MAX_BOARD_ROWS, node);
        return makeElement("article", {
          className: ["mdx-board-panel", `mdx-panel-x${x}-w${w}`, `mdx-panel-y${y}-h${h}`],
          dataComponent: "panel",
          dataPanelX: String(x),
          dataPanelY: String(y),
          dataPanelW: String(w),
          dataPanelH: String(h),
        }, [
          makeElement("h4", { dataRendererHeading: "true" }, [makeText(values.title)]),
          ...children,
        ]);
      }
      if (node.name === "panes") {
        const values = directiveAttrs(node, "panes", ["label", "columns"], ["label", "columns"]);
        ensureLength(values.label, "panes の label", 1, 80, node);
        if (!["2", "3"].includes(values.columns)) fail("panes の columns は 2 または 3 です", node);
        return makeElement("section", { className: ["mdx-panes", `columns-${values.columns}`], dataComponent: "panes", dataPanesColumns: values.columns, ariaLabel: values.label }, [
          makeElement("h3", { dataRendererHeading: "true" }, [makeText(values.label)]),
          makeElement("div", { className: ["mdx-panes-grid"] }, children),
        ]);
      }
      if (node.name === "pane") {
        const values = directiveAttrs(node, "pane", ["title"], ["title"]);
        ensureLength(values.title, "pane の title", 1, 80, node);
        return makeElement("article", { className: ["mdx-pane"], dataComponent: "pane", dataPane: "true" }, [
          makeElement("h4", { dataRendererHeading: "true" }, [makeText(values.title)]),
          ...children,
        ]);
      }
      if (node.name === "cards") {
        const values = directiveAttrs(node, "cards", ["label", "columns"], ["label", "columns"]);
        ensureLength(values.label, "cards の label", 1, 80, node);
        if (!["2", "3"].includes(values.columns)) fail("cards の columns は 2 または 3 です", node);
        return makeElement("section", { className: ["mdx-cards", `columns-${values.columns}`], dataComponent: "cards", dataCardsColumns: values.columns, ariaLabel: values.label }, [
          makeElement("h3", { dataRendererHeading: "true" }, [makeText(values.label)]),
          makeElement("div", { className: ["mdx-cards-track"], dataCard: "track" }, children),
          makeElement("div", { className: ["mdx-cards-controls"], hidden: true }, [
            makeElement("button", { type: "button", dataCard: "previous", ariaLabel: "前のカード" }, [makeText("前へ")]),
            makeElement("span", { dataCard: "status", ariaLive: "polite" }, [makeText("")]),
            makeElement("button", { type: "button", dataCard: "next", ariaLabel: "次のカード" }, [makeText("次へ")]),
          ]),
        ]);
      }
      if (node.name === "card") {
        const values = directiveAttrs(node, "card", ["title", "label"], ["title"]);
        ensureLength(values.title, "card の title", 1, 80, node);
        if (values.label) ensureLength(values.label, "card の label", 1, 40, node);
        return makeElement("article", { className: ["mdx-card"], dataComponent: "card", dataCard: "item", dataCardLabel: values.label || "" }, [
          makeElement("header", {}, [
            makeElement("h4", { dataRendererHeading: "true" }, [makeText(values.title)]),
            ...(values.label ? [makeElement("span", { className: ["mdx-card-label"] }, [makeText(values.label)])] : []),
          ]),
          ...children,
        ]);
      }
      if (node.name === "modal") {
        const values = directiveAttrs(node, "modal", ["id", "trigger", "title", "size"], ["id", "trigger", "title"]);
        if (!/^[a-z][a-z0-9_-]{0,63}$/.test(values.id)) fail("modal の id が不正です", node);
        if (!["sm", "md", "lg"].includes(values.size || "md")) fail("modal の size は sm、md、lg です", node);
        ensureLength(values.trigger, "modal の trigger", 1, 80, node);
        ensureLength(values.title, "modal の title", 1, 120, node);
        const modalId = `modal-${values.id}`;
        const titleId = `${modalId}-title`;
        return makeElement("section", { className: ["mdx-modal", `size-${values.size || "md"}`], dataComponent: "modal", dataModalId: modalId }, [
          makeElement("button", { type: "button", dataModalOpen: modalId }, [makeText(values.trigger)]),
          makeElement("dialog", { id: modalId, className: ["mdx-modal-dialog"], dataModalDialog: "true", ariaLabelledBy: `user-content-${titleId}` }, [
            makeElement("div", { className: ["mdx-modal-header"] }, [
              makeElement("h3", { id: titleId, dataRendererHeading: "true" }, [makeText(values.title)]),
              makeElement("button", { type: "button", dataModalClose: "true", ariaLabel: "閉じる" }, [makeText("閉じる")]),
            ]),
            makeElement("div", { className: ["mdx-modal-body"] }, children),
          ]),
        ]);
      }
      fail(`未知の container directive ${node.name}`, node);
    },
    leafDirective(state: any, node: Node): HastNode {
      if (node.name === "toc") {
        const values = directiveAttrs(node, "toc", ["minLevel", "maxLevel", "ordered", "mobile"]);
        const minLevel = parseGridInteger(values.minLevel || "2", "toc の minLevel", 1, 6, node);
        const maxLevel = parseGridInteger(values.maxLevel || "4", "toc の maxLevel", minLevel, 6, node);
        if (!["true", "false"].includes(values.ordered || "false")) fail("toc の ordered は true または false です", node);
        if (!["hidden", "visible"].includes(values.mobile || "hidden")) fail("toc の mobile は hidden または visible です", node);
        const label = childrenText(node) || "目次";
        ensureLength(label, "toc の label", 1, 80, node);
        return makeElement("nav", { className: ["mdx-toc", `mobile-${values.mobile || "hidden"}`], dataComponent: "toc", dataToc: "true", dataTocMinLevel: String(minLevel), dataTocMaxLevel: String(maxLevel), dataTocOrdered: values.ordered || "false", dataTocMobile: values.mobile || "hidden", ariaLabel: label }, [
          makeElement("h2", { dataRendererHeading: "true" }, [makeText(label)]),
          makeElement("div", { className: ["mdx-toc-list"], dataToc: "list" }),
        ]);
      }
      if (node.name !== "metric") fail(`未知の leaf directive ${node.name}`, node);
      const values = directiveAttrs(node, "metric", ["label", "unit", "tone"], ["label", "unit", "tone"]);
      ensureLength(values.label, "metric の label", 1, 80, node);
      ensureLength(values.unit, "metric の unit", 0, 24, node);
      if (!allowedMetricTones.has(values.tone)) fail("metric の tone が不正です", node);
      const value = childrenText(node);
      if ((node.children ?? []).some((child) => child.type !== "text")) fail("metric の値はプレーンテキストだけ指定してください", node);
      ensureLength(value, "metric の値", 1, 32, node);
      return makeElement("div", { className: ["mdx-metric", `is-${values.tone}`], dataComponent: "metric" }, [
        makeElement("dt", {}, [makeText(values.label)]),
        makeElement("dd", {}, [makeElement("strong", {}, [makeText(value)]), makeElement("span", { className: ["mdx-metric-unit"] }, [makeText(values.unit)])]),
      ]);
    },
    code(state: any, node: Node): HastNode {
      const lang = (node.lang ?? "").toLowerCase();
      if (lang === "svg") {
        svgIndex += 1;
        return renderSvg(node.value ?? "", node.meta, node, svgIndex);
      }
      if (lang === "mermaid") return renderMermaid(node.value ?? "", node.meta, node);
      if (lang === "plot") return renderPlot(node.value ?? "", node.meta, node, svgIndex += 1);
      if (lang === "audio") {
        const audio = parseAudio(node.value ?? "", node);
        return makeElement("figure", { className: ["mdx-audio"], dataComponent: "audio", dataAudio: "true" }, [
          makeElement("figcaption", {}, [makeText(audio.caption)]),
          makeElement("audio", { controls: true, preload: "metadata", title: audio.title, dataAudioPlayer: "true" }, []),
          makeElement("ol", { className: ["mdx-audio-tracks"] }, audio.tracks.map((track, index) => makeElement("li", {}, [
            makeElement("button", { type: "button", dataAudioSrc: track.src, dataAudioIndex: String(index), ariaCurrent: index === 0 ? "true" : "false" }, [makeText(track.label || `パート ${index + 1}`)]),
            makeElement("a", { href: track.src, download: true }, [makeText("ダウンロード")]),
          ]))),
        ]);
      }
      if (lang === "sandbox-html") {
        const attrs = parseFenceInfo(node.meta, node);
        for (const key of Object.keys(attrs)) if (!["title", "description", "height", "scripts"].includes(key)) fail(`sandbox-html fence の属性 ${key} は許可されていません`, node);
        if (!attrs.title || !attrs.scripts || !["true", "false"].includes(attrs.scripts)) fail("sandbox-html fence には title と scripts が必要です", node);
        const height = attrs.height || "360";
        const heightNumber = parseGridInteger(height, "sandbox-html の height", 160, 900, node);
        ensureLength(attrs.title, "sandbox-html の title", 1, 120, node);
        if (attrs.description) ensureLength(attrs.description, "sandbox-html の description", 1, 240, node);
        if (new TextEncoder().encode(node.value ?? "").byteLength > MAX_SANDBOX_BYTES) fail("sandbox-html fence は128 KiB以下で指定してください", node);
        return makeElement("figure", { className: ["mdx-sandbox"], dataComponent: "sandbox-html", dataSandbox: "true", dataSandboxTitle: attrs.title, dataSandboxDescription: attrs.description || "", dataSandboxHeight: String(heightNumber), dataSandboxScripts: attrs.scripts }, [
          makeElement("figcaption", {}, [makeText(attrs.title)]),
          ...(attrs.description ? [makeElement("p", { className: ["mdx-sandbox-description"] }, [makeText(attrs.description)])] : []),
          makeElement("div", { className: ["mdx-sandbox-actions"] }, [
            makeElement("button", { type: "button", dataSandboxRun: "true" }, [makeText("実行")]),
            makeElement("button", { type: "button", dataSandboxStop: "true", hidden: true }, [makeText("停止")]),
          ]),
          makeElement("div", { className: ["mdx-sandbox-canvas"], dataSandboxCanvas: "true" }, []),
          makeElement("details", { className: ["mdx-sandbox-source"] }, [
            makeElement("summary", {}, [makeText("HTMLソースを表示")]),
            makeElement("pre", {}, [makeElement("code", { dataSandboxSource: "true" }, [makeText(node.value ?? "")])]),
          ]),
        ]);
      }
      return makeElement("pre", {}, [makeElement("code", { className: lang ? [`language-${lang}`] : [] }, [makeText(node.value ?? "")])]);
    },
    textDirective(state: any, node: Node): HastNode {
      if (node.name === "label") {
        const values = directiveAttrs(node, "label", ["tone", "variant", "size"]);
        const tone = values.tone || "neutral";
        const variant = values.variant || "soft";
        const size = values.size || "md";
        if (!allowedLabelTones.has(tone) || !allowedLabelVariants.has(variant) || !allowedLabelSizes.has(size)) fail("label の tone、variant、size が不正です", node);
        const value = childrenText(node);
        ensureLength(value, "label の本文", 1, 80, node);
        return makeElement("span", { className: ["mdx-label", `tone-${tone}`, `variant-${variant}`, `size-${size}`], dataComponent: "label", dataLabel: value }, state.all(node) as HastNode[]);
      }
      if (node.name === "text") {
        const values = directiveAttrs(node, "text", ["color", "size"]);
        const color = values.color || "default";
        const size = values.size || "md";
        if (!allowedTextColors.has(color) || !allowedTextSizes.has(size)) fail("text の color または size が不正です", node);
        const value = childrenText(node);
        ensureLength(value, "text の本文", 1, 4000, node);
        return makeElement("span", { className: ["mdx-text", `color-${color}`, `size-${size}`], dataComponent: "text", dataText: "true" }, state.all(node) as HastNode[]);
      }
      fail(`未知の text directive ${node.name}`, node);
    },
  };
}

const rawHtmlAllowedAttributes = new Map<string, Set<string>>([
  ["abbr", new Set(["title"])],
  ["q", new Set(["cite"])],
  ["span", new Set(["title"])],
  ["time", new Set(["dateTime"])],
]);
const rawHtmlAllowedTags = new Set(["abbr", "cite", "del", "em", "ins", "kbd", "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "br"]);

function validateRawHtml(value: string, node: Node): void {
  const parsed = fromHtml(value, { fragment: true }) as unknown as HastNode;
  const visit = (current: HastNode): void => {
    if (current.type !== "element") {
      for (const child of current.children ?? []) visit(child);
      return;
    }
    if (!current.tagName || !rawHtmlAllowedTags.has(current.tagName)) fail(`raw HTML の要素 ${current.tagName ?? ""} は許可されていません`, node);
    const allowedAttributes = rawHtmlAllowedAttributes.get(current.tagName) ?? new Set<string>();
    for (const [key, attribute] of Object.entries(current.properties ?? {})) {
      if (key.toLowerCase().startsWith("on") || key === "style" || key === "srcDoc" || !allowedAttributes.has(key)) {
        fail(`raw HTML の属性 ${key} は許可されていません`, node);
      }
      if (typeof attribute === "string" && /(?:javascript|vbscript|data):/i.test(attribute)) fail(`raw HTML の属性 ${key} に危険なURLがあります`, node);
    }
    for (const child of current.children ?? []) visit(child);
  };
  visit(parsed);
}

type ValidationState = {
  tabIds: Set<string>;
  modalIds: Set<string>;
  tocCount: number;
  mermaidSources: string[];
  sandboxCount: number;
};

function parseGridInteger(value: string, label: string, min: number, max: number, node: Node): number {
  if (!/^[1-9]\d*$/.test(value)) fail(`${label} は正の整数で指定してください`, node);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) fail(`${label} は ${min}〜${max} の範囲で指定してください`, node);
  return number;
}

function validateNode(node: Node, context: string, headings: Node[], assets: string[], state: ValidationState): void {
  if (node.type === "html") validateRawHtml(node.value ?? "", node);
  if (["inlineMath", "math"].includes(node.type)) ensureLength(node.value ?? "", "数式", 1, 64 * 1024, node);
  if (node.type === "heading") {
    if (context !== "root") fail("directive の内部に見出しは置けません", node);
    headings.push(node);
  }
  if (node.type === "image") {
    const alt = String(node.alt ?? "").trim();
    if (!alt) fail("画像には空でない alt が必要です", node);
    assets.push(String(node.url ?? ""));
  }
  if (node.type === "code") {
    const lang = (node.lang ?? "").toLowerCase();
    if (lang === "svg" && new TextEncoder().encode(node.value ?? "").byteLength > MAX_SVG_BYTES) {
      fail("SVG fence は256 KiB以下で指定してください", node);
    }
    if (lang === "mermaid") {
      if (new TextEncoder().encode(node.value ?? "").byteLength > MAX_MERMAID_BYTES) fail("Mermaid fence は32 KiB以下で指定してください", node);
      parseMermaidInfo(node.value ?? "", node.meta, node);
      state.mermaidSources.push(node.value ?? "");
      if (state.mermaidSources.length > 12) fail("一つのレポートに置ける Mermaid は12個までです", node);
    }
    if (lang === "plot") {
      if (new TextEncoder().encode(node.value ?? "").byteLength > MAX_PLOT_BYTES) fail("plot fence は128 KiB以下で指定してください", node);
      parsePlot(node.value ?? "", node.meta, node);
    }
    if (lang === "audio") {
      if (context === "details") fail("details の内部に audio fence は置けません", node);
      const audio = parseAudio(node.value ?? "", node);
      assets.push(...audio.tracks.map((track) => track.src));
    }
    if (lang === "svg") renderSvg(node.value ?? "", node.meta, node, 999);
    if (lang === "sandbox-html") {
      if (context !== "root") fail("sandbox-html は本文直下に置いてください", node);
      state.sandboxCount += 1;
      if (state.sandboxCount > MAX_SANDBOX_COUNT) fail("一つのレポートに置ける sandbox-html は4個までです", node);
      const values = parseFenceInfo(node.meta, node);
      for (const key of Object.keys(values)) if (!["title", "description", "height", "scripts"].includes(key)) fail(`sandbox-html fence の属性 ${key} は許可されていません`, node);
      requireAttrs({ ...node, attributes: values, name: "sandbox-html" }, ["title", "description", "height", "scripts"], ["title", "scripts"]);
      if (!["true", "false"].includes(values.scripts)) fail("sandbox-html の scripts は true または false です", node);
      const height = parseGridInteger(values.height || "360", "sandbox-html の height", 160, 900, node);
      void height;
      ensureLength(values.title, "sandbox-html の title", 1, 120, node);
      if (values.description) ensureLength(values.description, "sandbox-html の description", 1, 240, node);
      if (new TextEncoder().encode(node.value ?? "").byteLength > MAX_SANDBOX_BYTES) fail("sandbox-html fence は128 KiB以下で指定してください", node);
    }
  }
  if (node.type === "textDirective") {
    if (!node.name || !["label", "text"].includes(node.name)) fail(`未知の text directive ${node.name ?? ""}`, node);
    const values = node.name === "label"
      ? directiveAttrs(node, "label", ["tone", "variant", "size"])
      : directiveAttrs(node, "text", ["color", "size"]);
    const value = childrenText(node);
    ensureLength(value, `${node.name} の本文`, 1, node.name === "label" ? 80 : 4000, node);
    if (node.name === "label") {
      if (!allowedLabelTones.has(values.tone || "neutral") || !allowedLabelVariants.has(values.variant || "soft") || !allowedLabelSizes.has(values.size || "md")) fail("label の tone、variant、size が不正です", node);
    } else if (!allowedTextColors.has(values.color || "default") || !allowedTextSizes.has(values.size || "md")) {
      fail("text の color または size が不正です", node);
    }
  }
  if (["containerDirective", "leafDirective"].includes(node.type)) {
    if (!node.name || !allowedDirectiveNames.has(node.name)) fail(`未知の directive ${node.name ?? ""}`, node);
    const attrs = node.attributes ?? {};
    if (new Set(Object.keys(attrs)).size !== Object.keys(attrs).length) fail(`directive ${node.name} の属性が重複しています`, node);
    if (node.name === "callout" && !["root", "tab", "details", "board", "panel"].includes(context)) fail("callout はこの位置に置けません", node);
    if (node.name === "metrics" && !["root", "callout", "tab", "details", "board", "panel"].includes(context)) fail("metrics はこの位置に置けません", node);
    if (node.name === "metric" && context !== "metrics") fail("metric は metrics の直下に置いてください", node);
    if (node.name === "tabs" && context !== "root") fail("tabs は本文直下に置いてください", node);
    if (node.name === "tab" && context !== "tabs") fail("tab は tabs の直下に置いてください", node);
    if (node.name === "details" && !["root", "callout", "tab", "board", "panel"].includes(context)) fail("details はこの位置に置けません", node);
    if (node.name === "callout" && context === "callout") fail("callout の入れ子は許可されていません", node);
    if (node.name === "tabs" && context === "tab") fail("tabs の入れ子は許可されていません", node);
    if (node.name === "details" && context === "details") fail("details の入れ子は許可されていません", node);
    if (node.name === "toc") {
      if (node.type !== "leafDirective" || context !== "root") fail("toc は本文直下の leaf directive として一つだけ置いてください", node);
      state.tocCount += 1;
      if (state.tocCount > 1) fail("toc は一つのレポートに一つだけ置けます", node);
      const values = directiveAttrs(node, "toc", ["minLevel", "maxLevel", "ordered", "mobile"]);
      const minLevel = parseGridInteger(values.minLevel || "2", "toc の minLevel", 1, 6, node);
      parseGridInteger(values.maxLevel || "4", "toc の maxLevel", minLevel, 6, node);
      if (!["true", "false"].includes(values.ordered || "false")) fail("toc の ordered は true または false です", node);
      if (!["hidden", "visible"].includes(values.mobile || "hidden")) fail("toc の mobile は hidden または visible です", node);
      if (childrenText(node).length > 80) fail("toc の label は80文字以下で指定してください", node);
    }
    if (node.name === "panes" || node.name === "cards" || node.name === "modal") {
      if (context !== "root") fail(`${node.name} は本文直下に置いてください`, node);
    }
    if (node.name === "pane" && context !== "panes") fail("pane は panes の直下に置いてください", node);
    if (node.name === "card" && context !== "cards") fail("card は cards の直下に置いてください", node);
    if (node.name === "panes") {
      const values = requireAttrs({ ...node, name: "panes" }, ["label", "columns"], ["label", "columns"]);
      if (!/[23]/.test(values.columns) || !["2", "3"].includes(values.columns)) fail("panes の columns は 2 または 3 です", node);
      const panes = node.children ?? [];
      if (panes.length < 2 || panes.length > 3 || panes.some((child) => child.type !== "containerDirective" || child.name !== "pane")) fail("panes は pane を2〜3個だけ直下に含めてください", node);
    }
    if (node.name === "pane") {
      const values = requireAttrs({ ...node, name: "pane" }, ["title"], ["title"]);
      ensureLength(values.title, "pane の title", 1, 80, node);
    }
    if (node.name === "cards") {
      const values = requireAttrs({ ...node, name: "cards" }, ["label", "columns"], ["label", "columns"]);
      if (!["2", "3"].includes(values.columns)) fail("cards の columns は 2 または 3 です", node);
      const cards = node.children ?? [];
      if (cards.length < 2 || cards.length > 12 || cards.some((child) => child.type !== "containerDirective" || child.name !== "card")) fail("cards は card を2〜12個だけ直下に含めてください", node);
    }
    if (node.name === "card") {
      const values = requireAttrs({ ...node, name: "card" }, ["title", "label"], ["title"]);
      ensureLength(values.title, "card の title", 1, 80, node);
      if (values.label) ensureLength(values.label, "card の label", 1, 40, node);
    }
    if (node.name === "modal") {
      const values = requireAttrs({ ...node, name: "modal" }, ["id", "trigger", "title", "size"], ["id", "trigger", "title"]);
      if (!/^[a-z][a-z0-9_-]{0,63}$/.test(values.id) || state.modalIds.has(values.id)) fail("modal の id は文書内で一意な識別子にしてください", node);
      state.modalIds.add(values.id);
      if (values.size && !["sm", "md", "lg"].includes(values.size)) fail("modal の size は sm、md、lg です", node);
      ensureLength(values.trigger, "modal の trigger", 1, 80, node);
      ensureLength(values.title, "modal の title", 1, 120, node);
    }
    if (node.name === "tabs") {
      const id = node.attributes?.id ?? "";
      if (state.tabIds.has(id)) fail(`tabs の id ${id} が重複しています`, node);
      state.tabIds.add(id);
      const tabs = node.children ?? [];
      if (tabs.length < 2 || tabs.length > 6 || tabs.some((child) => child.type !== "containerDirective" || child.name !== "tab")) {
        fail("tabs は tab を2〜6個だけ含めてください", node);
      }
      const ids = new Set<string>();
      for (const tab of tabs) {
        const id = tab.attributes?.id ?? "";
        if (ids.has(id)) fail(`tab の id ${id} が重複しています`, tab);
        ids.add(id);
      }
    }
    if (node.name === "metrics") {
      const metrics = node.children ?? [];
      if (metrics.length < 2 || metrics.length > 6 || metrics.some((child) => child.type !== "leafDirective" || child.name !== "metric")) {
        fail("metrics は metric を2〜6個だけ含めてください", node);
      }
    }
    if (node.name === "board") {
      if (!["root", "callout", "tab", "details"].includes(context)) fail("board はこの位置に置けません", node);
      const values = requireAttrs({ ...node, name: "board" }, ["label", "columns"], ["label", "columns"]);
      if (!["2", "3", "4"].includes(values.columns)) fail("board の columns は 2〜4 です", node);
      const columns = Number(values.columns);
      const panels = node.children ?? [];
      if (panels.length < 1 || panels.length > 12 || panels.some((child) => child.type !== "containerDirective" || child.name !== "panel")) {
        fail("board は panel を1〜12個だけ直下に含めてください", node);
      }
      const occupied = new Set<string>();
      for (const panel of panels) {
        const panelValues = requireAttrs({ ...panel, name: "panel" }, ["title", "x", "y", "w", "h"], ["title", "x", "y"]);
        const x = parseGridInteger(panelValues.x, "panel の x", 1, columns, panel);
        const y = parseGridInteger(panelValues.y, "panel の y", 1, MAX_BOARD_ROWS, panel);
        const w = parseGridInteger(panelValues.w ?? "1", "panel の w", 1, columns, panel);
        const h = parseGridInteger(panelValues.h ?? "1", "panel の h", 1, MAX_BOARD_ROWS, panel);
        if (x + w - 1 > columns || y + h - 1 > MAX_BOARD_ROWS) fail("panel が board の範囲を超えています", panel);
        for (let row = y; row < y + h; row += 1) for (let column = x; column < x + w; column += 1) {
          const cell = `${row}:${column}`;
          if (occupied.has(cell)) fail("board 内の panel が重なっています", panel);
          occupied.add(cell);
        }
      }
    }
    if (node.name === "panel") {
      if (context !== "board") fail("panel は board の直下に置いてください", node);
      const values = requireAttrs({ ...node, name: "panel" }, ["title", "x", "y", "w", "h"], ["title", "x", "y"]);
      ensureLength(values.title, "panel の title", 1, 80, node);
      parseGridInteger(values.x, "panel の x", 1, 4, node);
      parseGridInteger(values.y, "panel の y", 1, MAX_BOARD_ROWS, node);
      parseGridInteger(values.w ?? "1", "panel の w", 1, 4, node);
      parseGridInteger(values.h ?? "1", "panel の h", 1, MAX_BOARD_ROWS, node);
    }
  }
  const children = node.children ?? [];
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.type === "code" && (child.lang ?? "").toLowerCase() === "audio") {
      const transcript = children[index + 1];
      if (transcript?.type !== "containerDirective" || transcript.name !== "details") {
        fail("audio fence の直後に transcript 用 details を置いてください", child);
      }
    }
    const childContext = node.type === "root" ? "root" : node.name ?? context;
    validateNode(child, childContext, headings, assets, state);
  }
}

function validateStructure(tree: Node, frontmatter: ReportFrontmatter): { title: string; headings: string[]; assets: string[]; mermaidSources: string[] } {
  const headings: Node[] = [];
  const assets: string[] = [];
  const state: ValidationState = { tabIds: new Set(), modalIds: new Set(), tocCount: 0, mermaidSources: [], sandboxCount: 0 };
  validateNode(tree, "root", headings, assets, state);
  const h1 = headings.filter((heading) => heading.depth === 1);
  if (h1.length !== 1 || tree.children?.find((node) => node.type !== "yaml")?.type !== "heading") fail("front matter 直後にレベル1見出しを一つだけ置いてください");
  let previousDepth = 0;
  for (const heading of headings) {
    const depth = (heading as Node & { depth: number }).depth;
    if (previousDepth && depth > previousDepth + 1) fail("見出しレベルを一段以上飛ばせません", heading);
    previousDepth = depth;
  }
  const slugger = new GithubSlugger();
  const headingSlugs = headings.map((heading) => slugger.slug(childrenText(heading)));
  return { title: childrenText(h1[0]), headings: headingSlugs, assets: assets.filter(Boolean), mermaidSources: state.mermaidSources };
}

function baseUrl(sourceUrl: string): URL {
  try {
    return new URL(sourceUrl);
  } catch {
    throw new Error("Markdown の source URL が不正です");
  }
}

function createParser() {
  return unified().use(remarkParse).use(remarkGfm, { singleTilde: false }).use(remarkMath).use(remarkFrontmatter, ["yaml"]).use(remarkDirective);
}

function parseTree(markdown: string): Node {
  if (new TextEncoder().encode(markdown).byteLength > MAX_MARKDOWN_BYTES) fail("Markdown は2 MiB以下で指定してください");
  return createParser().parse(markdown) as unknown as Node;
}

export function isExplainerMarkdown(markdown: string): boolean {
  try {
    const tree = parseTree(markdown);
    const yamlNode = tree.children?.[0];
    if (yamlNode?.type !== "yaml" || new TextEncoder().encode(yamlNode.value ?? "").byteLength > MAX_FRONTMATTER_BYTES) return false;
    const document = YAML.parseDocument(yamlNode.value ?? "", { schema: "core", uniqueKeys: true });
    if (document.errors.length || document.warnings.length) return /^\s*explainer\s*:\s*true\s*$/m.test(yamlNode.value ?? "") && /^\s*hybridMarkdown\s*:\s*1\s*$/m.test(yamlNode.value ?? "");
    const data = document.toJS({ mapAsMap: false }) as Record<string, unknown>;
    return data?.explainer === true && data?.hybridMarkdown === 1;
  } catch {
    return false;
  }
}

function resolveReference(raw: string, sourceUrl: string, kind: "image" | "audio" | "link", reports: Map<string, ReportMapEntry> | undefined, validateLinks: boolean): string {
  if (!raw || raw.startsWith("/") || raw.startsWith("//")) fail(`${kind} の URL は Markdown 基準の相対 URL で指定してください`);
  if (kind === "link" && raw.startsWith("#")) return raw;
  const source = baseUrl(sourceUrl);
  let resolved: URL;
  try {
    resolved = new URL(raw, source);
  } catch {
    fail(`${kind} の URL を解決できません`);
  }
  const sameOrigin = resolved.protocol === source.protocol && resolved.origin === source.origin;
  if (!sameOrigin) {
    if (kind === "link" && ["https:", "http:", "mailto:"].includes(resolved.protocol)) return resolved.href;
    fail(`${kind} の外部 URL は許可されていません`);
  }
  if (resolved.search || (kind !== "link" && resolved.hash)) fail(`${kind} のローカル URL に query / fragment は指定できません`);
  const pathname = resolved.pathname;
  const sourceSegments = source.pathname.split("/").filter(Boolean);
  const contentIndex = sourceSegments.indexOf("content");
  const sourceRoot = contentIndex >= 0 && sourceSegments[contentIndex + 1]
    ? `/${sourceSegments.slice(0, contentIndex + 2).join("/")}/`
    : `${source.pathname.slice(0, source.pathname.lastIndexOf("/") + 1)}`;
  if (!pathname.startsWith(sourceRoot)) fail(`${kind} の URL は同じ report root 内に置いてください`);
  if (kind === "link" && pathname.endsWith(".md")) {
    const contentMarker = "/content/";
    const contentOffset = source.pathname.indexOf(contentMarker);
    const appPrefix = contentOffset >= 0 ? source.pathname.slice(0, contentOffset + 1) : "/";
    const target = [...(reports?.values() ?? [])].find((entry) => new URL(entry.source, `${source.origin}${appPrefix}`).pathname === pathname);
    if (!target) {
      if (validateLinks) fail("未公開 Markdown への内部リンクは許可されていません");
      return resolved.href;
    }
    return `?report=${encodeURIComponent(target.id)}${resolved.hash}`;
  }
  if (kind === "image") {
    const extension = pathname.toLowerCase().split(".").pop() ?? "";
    if (!allowedImageExtensions.has(extension)) fail(`画像の拡張子 .${extension} は許可されていません`);
  }
  if (kind === "audio") {
    const extension = pathname.toLowerCase().split(".").pop() ?? "";
    if (!allowedAudioExtensions.has(extension)) fail(`音声の拡張子 .${extension} は許可されていません`);
  }
  return resolved.href;
}

function walkHast(node: HastNode, visit: (node: HastNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walkHast(child, visit);
}

function resolveHastUrls(tree: HastNode, options: ParseOptions): void {
  walkHast(tree, (node) => {
    if (node.type !== "element" || !node.properties) return;
    const attrs = node.properties;
    if (typeof attrs.href === "string") attrs.href = resolveReference(attrs.href, options.sourceUrl, "link", options.reports, options.validateLinks ?? true);
    if (typeof attrs.src === "string") attrs.src = resolveReference(attrs.src, options.sourceUrl, node.tagName === "audio" ? "audio" : "image", options.reports, options.validateLinks ?? true);
    if (typeof attrs.dataAudioSrc === "string") attrs.dataAudioSrc = resolveReference(attrs.dataAudioSrc, options.sourceUrl, "audio", options.reports, options.validateLinks ?? true);
    if (typeof attrs["data-audio-src"] === "string") attrs["data-audio-src"] = resolveReference(String(attrs["data-audio-src"]), options.sourceUrl, "audio", options.reports, options.validateLinks ?? true);
  });
}

export function inspectMarkdown(markdown: string): { frontmatter: ReportFrontmatter; title: string; headings: string[]; assets: string[]; mermaidSources: string[] } {
  validateRawAttributeSyntax(markdown);
  const tree = parseTree(markdown);
  const yamlNode = tree.children?.[0];
  if (yamlNode?.type === "yaml" && new TextEncoder().encode(yamlNode.value ?? "").byteLength > MAX_FRONTMATTER_BYTES) {
    fail("front matter は16 KiB以下で指定してください", yamlNode);
  }
  const frontmatter = parseFrontmatter(tree);
  const structure = validateStructure(tree, frontmatter);
  return { frontmatter, ...structure };
}

export async function parseMarkdown(markdown: string, options: ParseOptions): Promise<ParsedReport> {
  validateRawAttributeSyntax(markdown);
  const tree = parseTree(markdown);
  const yamlNode = tree.children?.[0];
  if (yamlNode?.type === "yaml" && new TextEncoder().encode(yamlNode.value ?? "").byteLength > MAX_FRONTMATTER_BYTES) {
    fail("front matter は16 KiB以下で指定してください", yamlNode);
  }
  const frontmatter = parseFrontmatter(tree);
  const structure = validateStructure(tree, frontmatter);
  const transformed = (await unified()
    .use(remarkRehype as any, { allowDangerousHtml: true, handlers: createHandlers() })
    .use(rehypeRaw as any)
    .use(rehypeKatex as any, {
      output: "mathml",
      throwOnError: true,
      trust: false,
      strict: "error",
      maxExpand: 1000,
    })
    .run(tree as never)) as unknown as HastNode;
  resolveHastUrls(transformed, options);
  const clean = sanitize(transformed as never, sanitizeSchema as never) as unknown as HastNode;
  let headingIndex = 0;
  walkHast(clean, (node) => {
    if (node.type === "element" && /^h[1-6]$/.test(node.tagName ?? "") && node.properties?.dataRendererHeading !== "true") {
      const slug = structure.headings[headingIndex++];
      if (slug) {
        node.properties ??= {};
        node.properties.id = slug;
      }
    }
  });
  return {
    frontmatter,
    title: structure.title,
    headings: structure.headings,
    assets: structure.assets,
    html: toHtml(clean as never),
    sourceUrl: options.sourceUrl,
  };
}

export function validateManifest(value: unknown): ManifestReport[] {
  if (!value || typeof value !== "object" || (value as { schemaVersion?: unknown }).schemaVersion !== 1 || !Array.isArray((value as { reports?: unknown }).reports)) throw new Error("manifest.json の schemaVersion または reports が不正です");
  const reports = (value as { reports: unknown[] }).reports;
  const ids = new Set<string>();
  const sources = new Set<string>();
  return reports.map((item) => {
    if (!item || typeof item !== "object") throw new Error("manifest の report がオブジェクトではありません");
    const report = item as Partial<ManifestReport>;
    const keys = Object.keys(report).sort().join(",");
    if (keys !== "format,group,id,lang,published,revision,source,summary,tags,title") throw new Error(`manifest report のキーが不正です: ${keys}`);
    if (typeof report.id !== "string" || ids.has(report.id)) throw new Error("manifest の id が重複または不正です");
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(report.id)) throw new Error("manifest の id が不正です");
    if (typeof report.source !== "string" || sources.has(report.source)) throw new Error("manifest の source が重複または不正です");
    const sourceMatch = /^content\/([^/]+)\/(.+\.(?:md|html))$/.exec(report.source);
    if (!sourceMatch || /[\\?#%]/.test(report.source) || !REPORT_ROOTS.includes(sourceMatch[1] as (typeof REPORT_ROOTS)[number]) || sourceMatch[2].split("/").some((part) => !part || part === "." || part === ".." || part.includes("\\"))) throw new Error("manifest の source が不正です");
    if (report.format !== "markdown" && report.format !== "html") throw new Error("manifest の format が不正です");
    if ((report.format === "markdown" && !report.source.endsWith(".md")) || (report.format === "html" && !report.source.endsWith(".html"))) throw new Error("manifest の format と source の拡張子が一致しません");
    const group = report.group;
    if (typeof group !== "string" || !REPORT_ROOTS.includes(group as (typeof REPORT_ROOTS)[number])) throw new Error("manifest の group が不正です");
    if (sourceMatch[1] !== group) throw new Error("manifest の group と source が一致しません");
    if (typeof report.title !== "string" || !report.title.trim() || report.title.length > 200) throw new Error("manifest の title が不正です");
    if (typeof report.summary !== "string" || report.summary.length < 1 || report.summary.length > 160) throw new Error("manifest の summary が不正です");
    if (typeof report.published !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(report.published)) throw new Error("manifest の published が不正です");
    if (typeof report.lang !== "string") throw new Error("manifest の lang が不正です");
    try {
      new Intl.Locale(report.lang);
    } catch {
      throw new Error("manifest の lang が不正です");
    }
    if (!Array.isArray(report.tags) || report.tags.length > 8 || report.tags.some((tag) => typeof tag !== "string" || tag.length < 1 || tag.length > 32) || new Set(report.tags).size !== report.tags.length) throw new Error("manifest の tags が不正です");
    if (typeof report.revision !== "string" || !/^[a-f0-9]{64}$/.test(report.revision)) throw new Error("manifest の revision が不正です");
    ids.add(report.id);
    sources.add(report.source);
    return report as ManifestReport;
  });
}
