import { fromHtml } from "hast-util-from-html";
import { toHtml } from "hast-util-to-html";
import { defaultSchema, sanitize } from "hast-util-sanitize";
import GithubSlugger from "github-slugger";
import { unified } from "unified";
import remarkDirective from "remark-directive";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
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

const allowedDirectiveNames = new Set(["callout", "metrics", "metric", "tabs", "tab", "details"]);
const allowedCalloutKinds = new Set(["note", "tip", "important", "warning", "danger"]);
const allowedMetricTones = new Set(["neutral", "positive", "warning", "negative"]);
const allowedAudioExtensions = new Set(["aac", "flac", "m4a", "mp3", "ogg", "opus", "wav"]);
const allowedImageExtensions = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif"]);
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
  "article",
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
  "details",
  "summary",
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
];

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MAX_FRONTMATTER_BYTES = 16 * 1024;
const MAX_SVG_BYTES = 256 * 1024;

const commonAttributes = [
  "className",
  "id",
  "role",
  "title",
  "lang",
  "ariaLabel",
  "ariaLabelledBy",
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
    section: [...commonAttributes],
    a: [...commonAttributes, "href", "download"],
    img: [...commonAttributes, "src", "alt", "width", "height", "loading", "decoding"],
    button: [...commonAttributes, "type"],
    input: [...commonAttributes, "type", "disabled", "checked"],
    details: [...commonAttributes, "open"],
    audio: [...commonAttributes, "controls", "preload", "src"],
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
  if (node.type === "text" || node.type === "inlineCode" || node.type === "code") return node.value ?? "";
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
  const allowed = new Set(["explainer", "id", "summary", "published", "lang", "tags"]);
  for (const key of Object.keys(data ?? {})) if (!allowed.has(key)) fail(`front matter のキー ${key} は許可されていません`, yamlNode);
  if (data?.explainer !== true) fail("公開対象の front matter には explainer: true が必要です", yamlNode);
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
  return { explainer: true, id, summary, published, lang, tags };
}

function parseFenceInfo(meta: string | null | undefined, node: Node): Record<string, string> {
  const raw = (meta ?? "").trim();
  if (!raw) return {};
  if (!raw.startsWith("{") || !raw.endsWith("}")) fail("fence の属性は {key=\"value\"} 形式で指定してください", node);
  const body = raw.slice(1, -1).trim();
  const attrs: Record<string, string> = {};
  const pattern = /([a-z][a-z0-9-]*)="([^"\\]*(?:\\.[^"\\]*)*)"/gy;
  let cursor = 0;
  while (cursor < body.length) {
    while (/\s/.test(body[cursor] ?? "")) cursor += 1;
    pattern.lastIndex = cursor;
    const match = pattern.exec(body);
    if (!match || match.index !== cursor || attrs[match[1]]) fail("fence の属性が不正です", node);
    attrs[match[1]] = match[2];
    cursor = pattern.lastIndex;
  }
  return attrs;
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
    properties: { className: ["mdx-svg"] },
    children: [svg],
  };
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
          ...(values.title ? [makeElement("h3", {}, [makeText(values.title)])] : []),
          makeElement("div", { className: ["mdx-callout-body"] }, children),
        ]);
      }
      if (node.name === "metrics") {
        const values = directiveAttrs(node, "metrics", ["label", "columns"], ["label", "columns"]);
        ensureLength(values.label, "metrics の label", 1, 80, node);
        if (!["2", "3"].includes(values.columns)) fail("metrics の columns は 2 または 3 です", node);
        return makeElement("section", { className: ["mdx-metrics", `columns-${values.columns}`], dataComponent: "metrics", ariaLabel: values.label }, [
          makeElement("h3", {}, [makeText(values.label)]),
          makeElement("dl", {}, children),
        ]);
      }
      if (node.name === "tabs") {
        const values = directiveAttrs(node, "tabs", ["id", "label"], ["id", "label"]);
        if (!/^[a-z][a-z0-9-]{0,47}$/.test(values.id)) fail("tabs の id が不正です", node);
        ensureLength(values.label, "tabs の label", 1, 80, node);
        return makeElement("section", { className: ["mdx-tabs"], dataComponent: "tabs", dataTabsId: values.id, ariaLabel: values.label }, [
          makeElement("h3", { className: ["visually-hidden"] }, [makeText(values.label)]),
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
      fail(`未知の container directive ${node.name}`, node);
    },
    leafDirective(state: any, node: Node): HastNode {
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
      if (lang === "mermaid") fail("mermaid fence は MVP では許可されていません", node);
      if (lang === "svg") {
        svgIndex += 1;
        return renderSvg(node.value ?? "", node.meta, node, svgIndex);
      }
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
      return makeElement("pre", {}, [makeElement("code", { className: lang ? [`language-${lang}`] : [] }, [makeText(node.value ?? "")])]);
    },
  };
}

type ValidationState = {
  tabIds: Set<string>;
};

function validateNode(node: Node, context: string, headings: Node[], assets: string[], state: ValidationState): void {
  if (node.type === "html") fail("raw HTML は公開対象レポートでは許可されていません", node);
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
    if (lang === "audio") {
      if (context === "details") fail("details の内部に audio fence は置けません", node);
      const audio = parseAudio(node.value ?? "", node);
      assets.push(...audio.tracks.map((track) => track.src));
    }
    if (lang === "svg") renderSvg(node.value ?? "", node.meta, node, 999);
    if (lang === "mermaid") fail("mermaid fence は MVP では許可されていません", node);
  }
  if (["containerDirective", "leafDirective"].includes(node.type)) {
    if (!node.name || !allowedDirectiveNames.has(node.name)) fail(`未知の directive ${node.name ?? ""}`, node);
    const attrs = node.attributes ?? {};
    if (new Set(Object.keys(attrs)).size !== Object.keys(attrs).length) fail(`directive ${node.name} の属性が重複しています`, node);
    if (node.name === "callout" && !["root", "tab", "details"].includes(context)) fail("callout はこの位置に置けません", node);
    if (node.name === "metrics" && !["root", "callout", "tab", "details"].includes(context)) fail("metrics はこの位置に置けません", node);
    if (node.name === "metric" && context !== "metrics") fail("metric は metrics の直下に置いてください", node);
    if (node.name === "tabs" && context !== "root") fail("tabs は本文直下に置いてください", node);
    if (node.name === "tab" && context !== "tabs") fail("tab は tabs の直下に置いてください", node);
    if (node.name === "details" && !["root", "callout", "tab"].includes(context)) fail("details はこの位置に置けません", node);
    if (node.name === "callout" && context === "callout") fail("callout の入れ子は許可されていません", node);
    if (node.name === "tabs" && context === "tab") fail("tabs の入れ子は許可されていません", node);
    if (node.name === "details" && context === "details") fail("details の入れ子は許可されていません", node);
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

function validateStructure(tree: Node, frontmatter: ReportFrontmatter): { title: string; headings: string[]; assets: string[] } {
  const headings: Node[] = [];
  const assets: string[] = [];
  validateNode(tree, "root", headings, assets, { tabIds: new Set() });
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
  return { title: childrenText(h1[0]), headings: headingSlugs, assets: assets.filter(Boolean) };
}

function baseUrl(sourceUrl: string): URL {
  try {
    return new URL(sourceUrl);
  } catch {
    throw new Error("Markdown の source URL が不正です");
  }
}

function createParser() {
  return unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]).use(remarkDirective);
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
    if (document.errors.length || document.warnings.length) return /^\s*explainer\s*:\s*true\s*$/m.test(yamlNode.value ?? "");
    const data = document.toJS({ mapAsMap: false }) as Record<string, unknown>;
    return data?.explainer === true;
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
    if (kind === "link" && (resolved.protocol === "https:" || resolved.protocol === "mailto:")) return resolved.href;
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

export function inspectMarkdown(markdown: string): { frontmatter: ReportFrontmatter; title: string; headings: string[]; assets: string[] } {
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
  const tree = parseTree(markdown);
  const yamlNode = tree.children?.[0];
  if (yamlNode?.type === "yaml" && new TextEncoder().encode(yamlNode.value ?? "").byteLength > MAX_FRONTMATTER_BYTES) {
    fail("front matter は16 KiB以下で指定してください", yamlNode);
  }
  const frontmatter = parseFrontmatter(tree);
  const structure = validateStructure(tree, frontmatter);
  const transformed = (await unified().use(remarkRehype as any, { handlers: createHandlers() }).run(tree as never)) as unknown as HastNode;
  resolveHastUrls(transformed, options);
  const clean = sanitize(transformed as never, sanitizeSchema as never) as unknown as HastNode;
  let headingIndex = 0;
  walkHast(clean, (node) => {
    if (node.type === "element" && /^h[1-6]$/.test(node.tagName ?? "")) {
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
    if (keys !== "group,id,lang,published,revision,source,summary,tags,title") throw new Error(`manifest report のキーが不正です: ${keys}`);
    if (typeof report.id !== "string" || ids.has(report.id)) throw new Error("manifest の id が重複または不正です");
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(report.id)) throw new Error("manifest の id が不正です");
    if (typeof report.source !== "string" || sources.has(report.source)) throw new Error("manifest の source が重複または不正です");
    const sourceMatch = /^content\/([^/]+)\/(.+\.md)$/.exec(report.source);
    if (!sourceMatch || /[\\?#%]/.test(report.source) || !REPORT_ROOTS.includes(sourceMatch[1] as (typeof REPORT_ROOTS)[number]) || sourceMatch[2].split("/").some((part) => !part || part === "." || part === ".." || part.includes("\\"))) throw new Error("manifest の source が不正です");
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
