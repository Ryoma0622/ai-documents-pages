import { parseMarkdown, validateManifest } from "./parser";
import type { ManifestReport } from "./schema";
import "./styles.css";

const themeKey = "markdown-explainer-theme";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Markdown Explainer の DOM shell が不完全です: ${selector}`);
  return element;
}

const reportList = requireElement<HTMLDivElement>("#report-list");
const reportCount = requireElement<HTMLSpanElement>("#report-count");
const reportFilter = requireElement<HTMLInputElement>("#report-filter");
const reportView = requireElement<HTMLElement>("#report-view");
const status = requireElement<HTMLElement>("#app-status");
const themeToggle = requireElement<HTMLButtonElement>("#theme-toggle");
const libraryToggle = requireElement<HTMLButtonElement>("#library-toggle");
const libraryPanel = requireElement<HTMLElement>("#library-panel");
const hero = requireElement<HTMLElement>(".hero-panel");
document.body.classList.add("app-ready");

const themeError = (window as Window & { __markdownExplainerThemeError?: string }).__markdownExplainerThemeError;
let reports: ManifestReport[] = [];
let reportById = new Map<string, ManifestReport>();
let navigationToken = 0;
let activeController: AbortController | undefined;
const sandboxUrls = new Set<string>();
let cardsResizeCleanup: (() => void) | undefined;

function setStatus(message: string, kind: "info" | "error" = "info"): void {
  status.textContent = message;
  status.dataset.kind = kind;
}

function clearReport(): void {
  cardsResizeCleanup?.();
  cardsResizeCleanup = undefined;
  for (const url of sandboxUrls) URL.revokeObjectURL(url);
  sandboxUrls.clear();
  reportView.replaceChildren();
  reportView.hidden = true;
}

function setLibraryOpen(open: boolean): void {
  libraryPanel.classList.toggle("is-open", open);
  libraryToggle.setAttribute("aria-expanded", String(open));
}

function showError(message: string): void {
  clearReport();
  setStatus(message, "error");
  hero.hidden = false;
}

function validateUrlState(url: URL): { reportId?: string; tabState: Map<string, string> } {
  const tabState = new Map<string, string>();
  let reportId: string | undefined;
  for (const [key, value] of url.searchParams.entries()) {
    if (key === "report") {
      if (reportId || !value) throw new Error("URL の report state が不正です");
      reportId = value;
    } else if (key.startsWith("tab.") && key.length > 4 && value) {
      if (tabState.has(key.slice(4))) throw new Error("URL の tab state が重複しています");
      tabState.set(key.slice(4), value);
    } else {
      throw new Error(`URL の query state ${key} は許可されていません`);
    }
  }
  if (!reportId && tabState.size) throw new Error("tab state は report state と一緒に指定してください");
  return { reportId, tabState };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00Z`));
}

function renderLibrary(): void {
  const query = reportFilter.value.trim().toLocaleLowerCase("ja");
  reportList.replaceChildren();
  const visible = reports.filter((report) => [report.title, report.summary, ...report.tags].join(" ").toLocaleLowerCase("ja").includes(query));
  reportCount.textContent = String(visible.length);
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = query ? "条件に一致するレポートはありません。" : "公開レポートはありません。";
    reportList.append(empty);
    return;
  }
  for (const report of visible) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "report-card";
    button.dataset.reportId = report.id;
    const title = document.createElement("strong");
    title.textContent = report.title;
    const summary = document.createElement("span");
    summary.textContent = report.summary;
    const meta = document.createElement("small");
    meta.textContent = `${report.format === "html" ? "HTML" : "Markdown"} · ${formatDate(report.published)} · ${report.tags.join(" / ") || "タグなし"}`;
    button.append(title, summary, meta);
    button.addEventListener("click", () => navigateToReport(report.id));
    reportList.append(button);
  }
}

function navigateToReport(id: string): void {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("report", id);
  history.pushState({}, "", url);
  setLibraryOpen(false);
  void renderRoute();
}

async function fetchReport(report: ManifestReport, signal: AbortSignal): Promise<string> {
  const url = new URL(report.source, document.baseURI);
  if (url.origin !== window.location.origin) throw new Error("report source が同一 origin ではありません");
  url.searchParams.set("v", report.revision);
  const response = await fetch(url, { signal, credentials: "same-origin" });
  if (!response.ok) throw new Error(`report source の取得に失敗しました（${response.status}）`);
  const bytes = await response.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const revision = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (revision !== report.revision) throw new Error("report source の revision が manifest と一致しません");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function renderHtmlReport(report: ManifestReport): void {
  const frame = document.createElement("iframe");
  frame.className = "html-report-frame";
  frame.title = report.title;
  frame.loading = "eager";
  frame.referrerPolicy = "no-referrer";
  frame.src = `${report.source}?v=${encodeURIComponent(report.revision)}`;
  reportView.append(frame);
}

function addReportMeta(report: ManifestReport): void {
  const meta = document.createElement("div");
  meta.className = "report-meta";
  const format = document.createElement("span");
  format.textContent = report.format === "html" ? "HTML" : "Markdown";
  const date = document.createElement("span");
  date.textContent = formatDate(report.published);
  const group = document.createElement("span");
  group.textContent = report.group;
  const source = document.createElement("a");
  source.href = `https://github.com/Ryoma0622/ai-documents-pages/blob/main/${report.source.slice("content/".length)}`;
  source.textContent = "GitHubで原文を見る";
  meta.append(format, date, group, source);
  reportView.prepend(meta);
}

function updateTabQuery(tabsId: string, tabId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(`tab.${tabsId}`, tabId);
  history.replaceState({}, "", url);
}

function activateTab(buttons: HTMLButtonElement[], panels: HTMLElement[], index: number, tabsId: string, writeUrl: boolean): void {
  buttons.forEach((button, buttonIndex) => {
    const selected = buttonIndex === index;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  panels.forEach((panel, panelIndex) => {
    panel.hidden = panelIndex !== index;
  });
  if (writeUrl) updateTabQuery(tabsId, buttons[index].dataset.tabId ?? "");
}

function enhanceTabs(tabState: Map<string, string>): void {
  const tabGroups = [...reportView.querySelectorAll<HTMLElement>("[data-component=\"tabs\"]")];
  const consumedState = new Set<string>();
  for (const group of tabGroups) {
    const tabsId = group.dataset.tabsId;
    const list = group.querySelector<HTMLElement>("[role=tablist]");
    const panels = [...group.querySelectorAll<HTMLElement>("[data-tab-id]")];
    if (!tabsId || !list || panels.length < 2) throw new Error("tabs の出力が不正です");
    const requested = tabState.get(tabsId);
    if (requested) consumedState.add(tabsId);
    const requestedIndex = requested ? panels.findIndex((panel) => panel.dataset.tabId === requested) : 0;
    if (requested && requestedIndex < 0) throw new Error(`tabs ${tabsId} の tab state が存在しません`);
    const buttons: HTMLButtonElement[] = [];
    panels.forEach((panel, index) => {
      const tabId = panel.dataset.tabId;
      const label = panel.dataset.tabLabel;
      if (!tabId || !label) throw new Error("tab の出力が不正です");
      const button = document.createElement("button");
      button.type = "button";
      button.id = `tab-${tabsId}-${tabId}`;
      button.className = "mdx-tab-button";
      button.role = "tab";
      button.textContent = label;
      button.setAttribute("aria-controls", `panel-${tabsId}-${tabId}`);
      panel.id = `panel-${tabsId}-${tabId}`;
      panel.setAttribute("aria-labelledby", button.id);
      button.addEventListener("click", () => activateTab(buttons, panels, index, tabsId, true));
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "Enter" || event.key === " ") {
          activateTab(buttons, panels, index, tabsId, true);
          return;
        }
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      });
      buttons.push(button);
      list.append(button);
    });
    activateTab(buttons, panels, requestedIndex >= 0 ? requestedIndex : 0, tabsId, false);
  }
  for (const tabsId of tabState.keys()) {
    if (!consumedState.has(tabsId)) throw new Error(`tabs ${tabsId} の URL state は存在しません`);
  }
}

function enhanceToc(): void {
  for (const toc of reportView.querySelectorAll<HTMLElement>('[data-component="toc"]')) {
    const listHost = toc.querySelector<HTMLElement>('[data-toc="list"]');
    if (!listHost) throw new Error("toc の出力が不正です");
    const minLevel = Number(toc.dataset.tocMinLevel || "2");
    const maxLevel = Number(toc.dataset.tocMaxLevel || "4");
    const ordered = toc.dataset.tocOrdered === "true";
    const list = document.createElement(ordered ? "ol" : "ul");
    const headings = [...reportView.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")].filter((heading) => {
      const level = Number(heading.tagName.slice(1));
      return level >= minLevel && level <= maxLevel && !toc.contains(heading) && heading.dataset.rendererHeading !== "true" && Boolean(heading.id);
    });
    headings.forEach((heading) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `#${encodeURIComponent(heading.id)}`;
      link.textContent = heading.textContent || heading.id;
      item.append(link);
      list.append(item);
    });
    if (!headings.length) {
      const empty = document.createElement("p");
      empty.className = "mdx-toc-empty";
      empty.textContent = "見出しはありません。";
      listHost.replaceChildren(empty);
    } else {
      listHost.replaceChildren(list);
    }
  }
}

function enhanceCards(): void {
  const update = (): void => {
    const isMobile = window.matchMedia("(max-width: 640px)").matches;
    for (const group of reportView.querySelectorAll<HTMLElement>('[data-component="cards"]')) {
      const track = group.querySelector<HTMLElement>('[data-card="track"]');
      const controls = group.querySelector<HTMLElement>(".mdx-cards-controls");
      const cards = [...group.querySelectorAll<HTMLElement>('[data-card="item"]')];
      if (!track || !controls || cards.length < 2) throw new Error("cards の出力が不正です");
      controls.hidden = !isMobile;
      if (!isMobile) continue;
      const previous = controls.querySelector<HTMLButtonElement>('[data-card="previous"]');
      const next = controls.querySelector<HTMLButtonElement>('[data-card="next"]');
      const statusNode = controls.querySelector<HTMLElement>('[data-card="status"]');
      if (!previous || !next || !statusNode) throw new Error("cards の操作部品が不正です");
      let current = Number(track.dataset.cardCurrent || "0");
      const setCurrent = (index: number, scroll: boolean): void => {
        current = Math.max(0, Math.min(cards.length - 1, index));
        track.dataset.cardCurrent = String(current);
        statusNode.textContent = `${current + 1} / ${cards.length}`;
        previous.disabled = current === 0;
        next.disabled = current === cards.length - 1;
        if (scroll) cards[current].scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest", inline: "start" });
      };
      const syncCurrent = (): void => {
        const trackLeft = track.getBoundingClientRect().left;
        let nearest = 0;
        let distance = Number.POSITIVE_INFINITY;
        cards.forEach((card, index) => {
          const distanceToStart = Math.abs(card.getBoundingClientRect().left - trackLeft);
          if (distanceToStart < distance) {
            distance = distanceToStart;
            nearest = index;
          }
        });
        setCurrent(nearest, false);
      };
      if (track.dataset.cardScrollBound !== "true") {
        track.addEventListener("scroll", syncCurrent, { passive: true });
        track.dataset.cardScrollBound = "true";
      }
      previous.onclick = () => setCurrent(current - 1, true);
      next.onclick = () => setCurrent(current + 1, true);
      setCurrent(current, false);
    }
  };
  update();
  window.addEventListener("resize", update, { passive: true });
  cardsResizeCleanup = () => window.removeEventListener("resize", update);
}

function enhanceModals(): void {
  for (const modal of reportView.querySelectorAll<HTMLElement>('[data-component="modal"]')) {
    const trigger = modal.querySelector<HTMLButtonElement>("[data-modal-open]");
    const dialog = modal.querySelector<HTMLDialogElement>("[data-modal-dialog]");
    const close = modal.querySelector<HTMLButtonElement>("[data-modal-close]");
    if (!trigger || !dialog || !close || typeof dialog.showModal !== "function") throw new Error("modal の出力が不正です");
    let restoreFocus: HTMLElement | null = null;
    const closeDialog = (): void => {
      if (dialog.open) dialog.close();
      restoreFocus?.focus();
      restoreFocus = null;
    };
    trigger.addEventListener("click", () => {
      restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      close.focus();
    });
    close.addEventListener("click", closeDialog);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog();
    });
    dialog.addEventListener("close", () => {
      restoreFocus?.focus();
      restoreFocus = null;
    });
  }
}

function prepareSandboxSource(source: string): string {
  const parsed = new DOMParser().parseFromString(`<body>${source}</body>`, "text/html");
  const isSafeResource = (value: string): boolean => {
    const candidate = value.trim();
    return Boolean(candidate) && (
      candidate.startsWith("data:") ||
      candidate.startsWith("blob:") ||
      (!candidate.startsWith("/") && !candidate.startsWith("//") && !/^[a-z][a-z0-9+.-]*:/i.test(candidate) && !candidate.split("/").includes(".."))
    );
  };
  for (const element of parsed.body.querySelectorAll("base, meta, a[href], area[href], form, img, audio, video, source, track, iframe, embed, object, link")) {
    if (element.localName === "base" || (element.localName === "meta" && element.getAttribute("http-equiv")?.toLowerCase() === "refresh")) {
      element.remove();
      continue;
    }
    if (element.localName === "a" || element.localName === "area") {
      element.setAttribute("data-hmd-blocked-href", element.getAttribute("href") || "");
      element.removeAttribute("href");
      element.removeAttribute("target");
      continue;
    }
    for (const attribute of ["src", "srcset", "poster", "data", "href"]) {
      const value = element.getAttribute(attribute);
      if (!value || (element.localName !== "link" && isSafeResource(value))) continue;
      element.setAttribute(`data-hmd-blocked-${attribute}`, value);
      element.removeAttribute(attribute);
    }
    element.removeAttribute("action");
    if (element.localName === "form") element.setAttribute("data-hmd-blocked-form", "true");
  }
  for (const element of parsed.body.querySelectorAll("style")) {
    element.textContent = (element.textContent || "").replace(/url\(\s*(['"]?)(?:https?:|\/\/|\/)[^)]*\1\s*\)/gi, "url(data:,)");
  }
  return parsed.body.innerHTML;
}

function enhanceSandboxHtml(): void {
  const childCsp = (scripts: boolean): string => [
    "default-src 'none'",
    `script-src ${scripts ? "'nonce-sandbox'" : "'none'"}`,
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "media-src data: blob:",
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  for (const figure of reportView.querySelectorAll<HTMLElement>('[data-component="sandbox-html"]')) {
    const run = figure.querySelector<HTMLButtonElement>("[data-sandbox-run]");
    const stop = figure.querySelector<HTMLButtonElement>("[data-sandbox-stop]");
    const canvas = figure.querySelector<HTMLElement>("[data-sandbox-canvas]");
    const sourceNode = figure.querySelector<HTMLElement>("[data-sandbox-source]");
    if (!run || !stop || !canvas || !sourceNode) throw new Error("sandbox-html の出力が不正です");
    let activeUrl: string | undefined;
    const stopSandbox = (): void => {
      canvas.replaceChildren();
      if (activeUrl) {
        URL.revokeObjectURL(activeUrl);
        sandboxUrls.delete(activeUrl);
        activeUrl = undefined;
      }
      run.hidden = false;
      stop.hidden = true;
    };
    const runSandbox = (): void => {
      stopSandbox();
      const scripts = figure.dataset.sandboxScripts === "true";
      const source = prepareSandboxSource(sourceNode.textContent || "");
      const executableSource = scripts
        ? source.replace(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi, (_match, rawAttributes = "", body = "") => {
          const attributes = String(rawAttributes).trim();
          if (attributes && !/^type\s*=\s*["']module["']$/i.test(attributes)) throw new Error("sandbox-html の script 属性は type=module 以外を指定できません");
          return `<script nonce="sandbox"${attributes ? ` ${attributes}` : ""}>${body}</script>`;
        })
        : source;
      const navigationGuard = scripts ? `<script nonce="sandbox">(() => { const block = (event) => { const target = event.target; if (target instanceof Element && target.closest("a[href], area[href], form")) { event.preventDefault(); event.stopImmediatePropagation(); } }; document.addEventListener("click", block, true); document.addEventListener("auxclick", block, true); document.addEventListener("submit", block, true); try { window.open = () => null; } catch {} })();</script>` : "";
      const documentSource = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${childCsp(scripts)}"></head><body>${navigationGuard}${executableSource}</body></html>`;
      const blob = new Blob([documentSource], { type: "text/html" });
      activeUrl = URL.createObjectURL(blob);
      sandboxUrls.add(activeUrl);
      const frame = document.createElement("iframe");
      frame.className = "mdx-sandbox-frame";
      frame.title = figure.dataset.sandboxTitle || "埋め込みHTMLデモ";
      frame.height = figure.dataset.sandboxHeight || "360";
      frame.sandbox.value = scripts ? "allow-scripts" : "";
      frame.referrerPolicy = "no-referrer";
      frame.src = activeUrl;
      canvas.append(frame);
      run.hidden = true;
      stop.hidden = false;
    };
    run.addEventListener("click", runSandbox);
    stop.addEventListener("click", stopSandbox);
  }
}

function importSafeMermaidSvg(value: string): SVGSVGElement {
  const documentValue = new DOMParser().parseFromString(value, "image/svg+xml");
  if (documentValue.querySelector("parsererror")) throw new Error("MermaidのSVGを解析できませんでした");
  const root = documentValue.documentElement;
  if (root.localName !== "svg") throw new Error("Mermaidの出力ルートがSVGではありません");
  const allowedElements = new Set([
    "svg", "title", "desc", "g", "defs", "marker", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
    "text", "tspan", "filter", "feDropShadow", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern",
  ]);
  const allowedAttributes = new Set([
    "id", "class", "xmlns", "xmlns:xlink", "version", "role", "focusable", "width", "height", "viewBox", "preserveAspectRatio",
    "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "transform", "dx", "dy", "stdDeviation", "textLength", "lengthAdjust",
    "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "opacity",
    "stroke-dasharray", "stroke-dashoffset", "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "alignment-baseline", "offset",
    "shape-rendering", "color-interpolation", "pointer-events", "filter", "clip-path", "mask", "letter-spacing", "word-spacing", "writing-mode", "white-space", "text-decoration", "xml:space",
    "stop-color", "stop-opacity", "marker-start", "marker-mid", "marker-end", "markerUnits", "markerWidth", "markerHeight", "refX", "refY", "orient",
    "flood-opacity", "flood-color",
  ]);
  const forbidden = new Set(["script", "foreignObject", "iframe", "object", "embed", "image", "use", "a"]);
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (forbidden.has(element.localName)) throw new Error(`Mermaidの出力に許可されない要素 ${element.localName} があります`);
    if (element.localName === "style") {
      element.remove();
      continue;
    }
    if (!allowedElements.has(element.localName)) throw new Error(`Mermaidの出力に未知の要素 ${element.localName} があります`);
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const attributeValue = attribute.value;
      if (name.startsWith("on") || ["href", "xlink:href", "src"].includes(name) || /(?:javascript|vbscript|data):/i.test(attributeValue)) {
        throw new Error("Mermaidの出力に危険な属性があります");
      }
      if (name === "style") {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (!allowedAttributes.has(attribute.name) && !name.startsWith("aria-") && !name.startsWith("data-")) throw new Error(`Mermaidの出力に未知の属性 ${attribute.name} があります`);
    }
  }
  return document.importNode(root, true) as unknown as SVGSVGElement;
}

async function enhanceMermaid(): Promise<void> {
  const figures = [...reportView.querySelectorAll<HTMLElement>('[data-component="mermaid"]')];
  if (!figures.length) return;
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    deterministicIds: true,
    htmlLabels: false,
    theme: document.documentElement.dataset.theme === "dark" ? "dark" : "default",
  });
  for (const [index, figure] of figures.entries()) {
    const canvas = figure.querySelector<HTMLElement>("[data-mermaid-canvas]");
    const source = figure.querySelector<HTMLElement>("[data-mermaid-source]")?.textContent?.trim();
    if (!canvas || !source) throw new Error("Mermaidのソースまたは表示領域が不正です");
    const title = figure.dataset.mermaidTitle || "Mermaid diagram";
    const description = figure.dataset.mermaidDescription || "Mermaid 記法から生成された図解です。";
    const originalCreateElement = document.createElement;
    document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement.call(document, tagName, options);
      if (tagName.toLowerCase() === "style") element.setAttribute("nonce", "mermaid");
      return element;
    }) as typeof document.createElement;
    let rendered;
    try {
      rendered = await mermaid.render(`mermaid-diagram-${index}`, source);
    } finally {
      document.createElement = originalCreateElement;
    }
    const svg = importSafeMermaidSvg(rendered.svg);
    const titleNode = document.createElementNS("http://www.w3.org/2000/svg", "title");
    const descriptionNode = document.createElementNS("http://www.w3.org/2000/svg", "desc");
    titleNode.id = `mermaid-diagram-${index}-title`;
    descriptionNode.id = `mermaid-diagram-${index}-description`;
    titleNode.textContent = title;
    descriptionNode.textContent = description;
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-labelledby", `${titleNode.id} ${descriptionNode.id}`);
    svg.setAttribute("focusable", "false");
    svg.prepend(titleNode, descriptionNode);
    canvas.replaceChildren(svg);
  }
}

function enhanceAudio(): void {
  for (const figure of reportView.querySelectorAll<HTMLElement>("[data-component=\"audio\"]")) {
    const player = figure.querySelector<HTMLAudioElement>("audio[data-audio-player]");
    const buttons = [...figure.querySelectorAll<HTMLButtonElement>("button[data-audio-src]")];
    if (!player || !buttons.length) throw new Error("audio の出力が不正です");
    const mediaError = document.createElement("p");
    mediaError.className = "mdx-media-error";
    mediaError.setAttribute("role", "status");
    mediaError.hidden = true;
    figure.append(mediaError);
    let current = 0;
    const select = (index: number, play: boolean): void => {
      const button = buttons[index];
      const src = button.dataset.audioSrc;
      if (!src) throw new Error("audio source が空です");
      current = index;
      buttons.forEach((item, itemIndex) => item.setAttribute("aria-current", String(itemIndex === index)));
      player.src = src;
      player.load();
      if (play) void player.play().catch(() => setStatus("音声を再生できませんでした。再生ボタンを押して再試行してください。", "error"));
    };
    select(0, false);
    buttons.forEach((button, index) => button.addEventListener("click", () => select(index, true)));
    player.addEventListener("ended", () => {
      if (current + 1 < buttons.length) select(current + 1, true);
    });
    player.addEventListener("error", () => {
      mediaError.hidden = false;
      mediaError.textContent = "この音声を取得または再生できませんでした。";
      setStatus("音声の取得に失敗しました。", "error");
    });
  }
}

function enhanceImages(): void {
  for (const image of reportView.querySelectorAll<HTMLImageElement>("img")) {
    const reportImageError = (): void => setStatus(`画像「${image.alt}」を取得できませんでした。`, "error");
    image.addEventListener("error", reportImageError, { once: true });
    if (image.complete && image.naturalWidth === 0) reportImageError();
  }
}

function scrollToFragment(): void {
  const raw = window.location.hash.slice(1);
  if (!raw) return;
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    setStatus("見出し fragment が不正です。", "error");
    return;
  }
  const target = document.getElementById(id);
  if (!target) {
    setStatus(`見出し #${id} は見つかりません。`, "error");
    return;
  }
  if (target instanceof HTMLElement) {
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }
  target.scrollIntoView({ block: "start" });
}

async function renderRoute(): Promise<void> {
  const token = ++navigationToken;
  activeController?.abort();
  activeController = new AbortController();
  clearReport();
  try {
    const { reportId, tabState } = validateUrlState(new URL(window.location.href));
    renderLibrary();
    if (!reportId) {
      hero.hidden = false;
      document.documentElement.lang = "ja";
      document.title = "Markdown Explainer";
      setStatus("レポートを選択してください。");
      return;
    }
    const report = reportById.get(reportId);
    if (!report) throw new Error(`レポート ${reportId} は存在しません`);
    if (report.format === "html" && tabState.size) throw new Error("HTML レポートには tab state を指定できません");
    hero.hidden = true;
    setStatus(`${report.title} を読み込んでいます…`);
    if (report.format === "html") {
      renderHtmlReport(report);
      addReportMeta(report);
      document.documentElement.lang = report.lang;
      document.title = `${report.title} | Markdown Explainer`;
      reportView.hidden = false;
      setStatus(`${report.title} を表示しています。`);
      return;
    }
    const markdown = await fetchReport(report, activeController.signal);
    if (token !== navigationToken) return;
    const parsed = await parseMarkdown(markdown, {
      sourceUrl: new URL(report.source, document.baseURI).href,
      reports: new Map(reports.map((item) => [item.source, { id: item.id, source: item.source }])),
      validateLinks: true,
    });
    if (token !== navigationToken) return;
    if (parsed.frontmatter.id !== report.id || parsed.title !== report.title) throw new Error("report metadata が manifest と一致しません");
    reportView.innerHTML = parsed.html;
    addReportMeta(report);
    enhanceTabs(tabState);
    enhanceToc();
    enhanceCards();
    enhanceModals();
    enhanceSandboxHtml();
    await enhanceMermaid();
    enhanceAudio();
    enhanceImages();
    const heading = reportView.querySelector<HTMLElement>("h1");
    if (!heading) throw new Error("report に H1 がありません");
    heading.tabIndex = -1;
    document.documentElement.lang = report.lang;
    document.title = `${report.title} | Markdown Explainer`;
    reportView.hidden = false;
    setStatus(`${report.title} を表示しています。`);
    heading.focus({ preventScroll: true });
    scrollToFragment();
  } catch (error) {
    if (token !== navigationToken || (error instanceof DOMException && error.name === "AbortError")) return;
    showError(error instanceof Error ? error.message : "レポートを表示できませんでした。");
  }
}

async function start(): Promise<void> {
  if (themeError) {
    showError(themeError);
    return;
  }
  try {
    const response = await fetch("./manifest.json", { credentials: "same-origin" });
    if (!response.ok) throw new Error(`manifest.json の取得に失敗しました（${response.status}）`);
    reports = validateManifest(await response.json());
    reportById = new Map(reports.map((report) => [report.id, report]));
    renderLibrary();
    setStatus("レポートを選択してください。");
    await renderRoute();
  } catch (error) {
    showError(error instanceof Error ? error.message : "manifest を読み込めませんでした。");
  }
}

reportFilter.addEventListener("input", renderLibrary);
libraryToggle.addEventListener("click", () => setLibraryOpen(!libraryPanel.classList.contains("is-open")));
reportView.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  const href = target?.getAttribute("href") ?? "";
  if (!target || !href.startsWith("?report=")) return;
  event.preventDefault();
  const next = new URL(target.href, window.location.href);
  history.pushState({}, "", next);
  setLibraryOpen(false);
  void renderRoute();
});
window.addEventListener("popstate", () => void renderRoute());
window.addEventListener("hashchange", scrollToFragment);
themeToggle.addEventListener("click", () => {
  try {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem(themeKey, next);
    void enhanceMermaid().catch((error: unknown) => showError(error instanceof Error ? error.message : "Mermaid図のテーマを更新できませんでした。"));
  } catch {
    showError("テーマ設定を保存できません。ブラウザのlocalStorageを有効にしてください。");
  }
});

void start();
