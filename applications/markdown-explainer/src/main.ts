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
const hero = requireElement<HTMLElement>(".hero-panel");
document.body.classList.add("app-ready");

const themeError = (window as Window & { __markdownExplainerThemeError?: string }).__markdownExplainerThemeError;
let reports: ManifestReport[] = [];
let reportById = new Map<string, ManifestReport>();
let navigationToken = 0;
let activeController: AbortController | undefined;

function setStatus(message: string, kind: "info" | "error" = "info"): void {
  status.textContent = message;
  status.dataset.kind = kind;
}

function clearReport(): void {
  reportView.replaceChildren();
  reportView.hidden = true;
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
    meta.textContent = `${formatDate(report.published)} · ${report.tags.join(" / ") || "タグなし"}`;
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

function addReportMeta(report: ManifestReport): void {
  const meta = document.createElement("div");
  meta.className = "report-meta";
  const date = document.createElement("span");
  date.textContent = formatDate(report.published);
  const group = document.createElement("span");
  group.textContent = report.group;
  const source = document.createElement("a");
  source.href = `https://github.com/Ryoma0622/ai-documents-pages/blob/main/${report.source.slice("content/".length)}`;
  source.textContent = "GitHubで原文を見る";
  meta.append(date, group, source);
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
    hero.hidden = true;
    setStatus(`${report.title} を読み込んでいます…`);
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
reportView.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  const href = target?.getAttribute("href") ?? "";
  if (!target || !href.startsWith("?report=")) return;
  event.preventDefault();
  const next = new URL(target.href, window.location.href);
  history.pushState({}, "", next);
  void renderRoute();
});
window.addEventListener("popstate", () => void renderRoute());
window.addEventListener("hashchange", scrollToFragment);
themeToggle.addEventListener("click", () => {
  try {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem(themeKey, next);
  } catch {
    showError("テーマ設定を保存できません。ブラウザのlocalStorageを有効にしてください。");
  }
});

void start();
