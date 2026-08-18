#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distRoot = resolve(appRoot, "dist");
const prefix = "/ai-documents-pages/";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mp3": "audio/mpeg",
};

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (!requestUrl.pathname.startsWith(prefix)) {
      response.writeHead(404).end();
      return;
    }
    const relative = decodeURIComponent(requestUrl.pathname.slice(prefix.length)) || "index.html";
    const target = resolve(distRoot, relative);
    if (target !== distRoot && !target.startsWith(`${distRoot}/`)) {
      response.writeHead(403).end();
      return;
    }
    const body = await readFile(target);
    response.writeHead(200, { "Content-Type": types[extname(target)] ?? "application/octet-stream" }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
const address = server.address();
if (!address || typeof address === "string") throw new Error("テストサーバーを起動できませんでした");
const baseUrl = `http://127.0.0.1:${address.port}${prefix}`;
const browser = await chromium.launch();
const errors = [];
const unexpectedRequests = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("https://example.invalid/blocked")) errors.push(`console: ${message.text()}`);
});
page.on("request", (request) => {
  const url = request.url();
  if (!url.startsWith(baseUrl) && !url.startsWith("data:") && !url.startsWith("blob:")) unexpectedRequests.push(url);
});

async function waitForReport() {
  try {
    await page.locator("#report-view h1").waitFor({ timeout: 5000 });
    await page.locator("#report-view [data-component=\"tabs\"]").waitFor({ timeout: 5000 });
  } catch (error) {
    const detail = await page.evaluate(() => ({ status: document.querySelector("#app-status")?.textContent, report: document.querySelector("#report-view")?.innerHTML.slice(0, 500) }));
    throw new Error(`${error.message} detail=${JSON.stringify(detail)} errors=${JSON.stringify(errors)}`);
  }
}

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.locator("#report-list .report-card").first().waitFor();
await page.locator("#report-list .report-card").filter({ hasText: "Markdown と HTML" }).click();
await waitForReport();
const reportId = "markdown-html-hybrid-platform";

const initial = await page.evaluate(() => ({
  title: document.title,
  h1: document.querySelector("#report-view h1")?.textContent,
  svg: Boolean(document.querySelector("#report-view svg[role=img] title")),
  mermaid: Boolean(document.querySelector("#report-view [data-component=mermaid] svg[role=img]")),
  mermaidStyleElements: document.querySelectorAll("#report-view [data-component=mermaid] svg style").length,
  math: Boolean(document.querySelector("#report-view math")),
  plot: Boolean(document.querySelector("#report-view [data-component=plot] svg")),
  board: Boolean(document.querySelector("#report-view [data-component=board] [data-component=panel]")),
  toc: Boolean(document.querySelector("#report-view [data-component=toc] [data-toc=\"list\"] a")),
  panes: Boolean(document.querySelector("#report-view [data-component=panes] [data-component=pane]")),
  cards: Boolean(document.querySelector("#report-view [data-component=cards] [data-component=card]")),
  modal: Boolean(document.querySelector("#report-view [data-component=modal] [data-modal-open]")),
  sandbox: Boolean(document.querySelector("#report-view [data-component=sandbox-html] [data-sandbox-run]")),
  audio: Boolean(document.querySelector("#report-view audio[controls]")),
  transcript: Boolean(document.querySelector("#report-view [data-component=audio] + details")),
  noAutoplay: [...document.querySelectorAll("#report-view audio")].every((audio) => !audio.autoplay && audio.paused),
  internalLink: document.querySelector("#report-view a[href^='?report=']")?.getAttribute("href"),
}));
if (!initial.title.includes("Markdown と HTML")) throw new Error("レポートの document.title が不正です");
if (!initial.h1 || !initial.svg || !initial.mermaid || initial.mermaidStyleElements !== 0 || !initial.math || !initial.plot || !initial.board || !initial.toc || !initial.panes || !initial.cards || !initial.modal || !initial.sandbox || !initial.audio || !initial.transcript || !initial.noAutoplay) throw new Error(`リッチ部品の表示または音声の初期状態が不正です: ${JSON.stringify(initial)}`);
if (initial.internalLink !== "?report=markdown-html-hybrid-platform#%E7%B5%90%E8%AB%96") throw new Error(`内部レポートリンクが不正です: ${initial.internalLink}`);

await page.locator("#report-view [data-modal-open]").click();
if (!(await page.locator("#report-view [data-modal-dialog]").evaluate((dialog) => dialog.open))) throw new Error("modal が開きません");
await page.locator("#report-view [data-modal-close]").click();
if (await page.locator("#report-view [data-modal-dialog]").evaluate((dialog) => dialog.open)) throw new Error("modal が閉じません");
await page.locator("#report-view [data-component=sandbox-html] [data-sandbox-run]").click();
const sandboxFrame = page.locator("#report-view [data-component=sandbox-html] iframe");
await sandboxFrame.waitFor();
if (await sandboxFrame.getAttribute("sandbox") !== "allow-scripts") throw new Error("sandbox iframe の権限が不正です");
const sandboxButton = page.frameLocator("#report-view [data-component=sandbox-html] iframe").locator("#counter");
await sandboxButton.click();
if (await sandboxButton.textContent() !== "1") throw new Error("sandbox HTML/JS の実行結果が不正です");
const sandboxNavigation = page.frameLocator("#report-view [data-component=sandbox-html] iframe").locator("#blocked-navigation");
await sandboxNavigation.click();
if (await sandboxButton.textContent() !== "1") throw new Error("sandbox の外部遷移が遮断されません");
await page.locator("#report-view [data-component=sandbox-html] [data-sandbox-stop]").click();
if (await page.locator("#report-view [data-component=sandbox-html] iframe").count() !== 0) throw new Error("sandbox iframe が停止時に破棄されません");

await page.locator("#report-list .report-card").filter({ hasText: "HTML レポート読み込み PoC" }).click();
const htmlFrame = page.frameLocator("#report-view iframe.html-report-frame");
await htmlFrame.locator("#html-poc-button").waitFor();
await htmlFrame.locator("#html-poc-button").click();
if (await htmlFrame.locator("#html-poc-count").textContent() !== "1") throw new Error("通常のHTML report の JavaScript が実行されません");
await page.locator("#report-list .report-card").filter({ hasText: "Markdown と HTML" }).click();
await page.locator("#report-view a[href^='?report=']").click();
await waitForReport();
if (page.url() !== `${baseUrl}?report=${reportId}#%E7%B5%90%E8%AB%96`) throw new Error(`内部リンクがSPA遷移になっていません: ${page.url()}`);
if (await page.evaluate(() => document.activeElement?.id) !== "結論") throw new Error("fragment遷移で見出しへfocusできません");
await page.goBack({ waitUntil: "networkidle" });
await waitForReport();

const directUrl = `${baseUrl}?report=${reportId}&tab.reader-author=author#%E7%B5%90%E8%AB%96`;
await page.goto(directUrl, { waitUntil: "networkidle" });
await waitForReport();
const direct = await page.evaluate(() => ({
  selected: document.querySelector(".mdx-tab-button[aria-selected='true']")?.textContent,
  heading: document.querySelector("#結論")?.textContent,
  hash: location.hash,
}));
if (direct.selected !== "著者" || direct.heading !== "結論" || decodeURIComponent(direct.hash.slice(1)) !== "結論") {
  throw new Error(`direct URL state が不正です: ${JSON.stringify(direct)}`);
}

const widths = [320, 390, 768, 1440, 2560];
for (const width of widths) {
  await page.setViewportSize({ width, height: 900 });
  const layout = await page.evaluate(() => {
    const header = document.querySelector(".site-header");
    const bad = [...document.querySelectorAll("body *")].map((element) => {
      const rect = element.getBoundingClientRect();
      return { tag: element.tagName.toLowerCase(), id: element.id, className: String(element.className), width: Math.round(rect.width), right: Math.round(rect.right), overflow: getComputedStyle(element).overflowX };
    }).filter((item) => item.width > document.documentElement.clientWidth + 1 || item.right > document.documentElement.clientWidth + 1).slice(0, 8);
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      headerHeight: header ? Math.round(header.getBoundingClientRect().height) : 0,
      bad,
    };
  });
  if (layout.scrollWidth > layout.clientWidth + 1) throw new Error(`${width}pxで横overflowが発生しました: ${JSON.stringify(layout)}`);
  if (layout.headerHeight < 48 || layout.headerHeight > 52) throw new Error(`${width}pxでheader高さが不正です: ${layout.headerHeight}`);
}

await page.setViewportSize({ width: 1280, height: 900 });
const lightBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
await page.emulateMedia({ colorScheme: "dark" });
await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
if (lightBackground === darkBackground) throw new Error("ライト／ダークの背景tokenが切り替わりません");
await page.emulateMedia({ reducedMotion: "reduce" });
const motion = await page.evaluate(() => [...document.querySelectorAll("body *")].some((element) => {
  const style = getComputedStyle(element);
  return Number.parseFloat(style.animationDuration) > 0.15 || Number.parseFloat(style.transitionDuration) > 0.15;
}));
if (motion) throw new Error("reduced motionで長いanimation/transitionが残っています");

await page.setViewportSize({ width: 390, height: 900 });
if (await page.locator("#library-panel").evaluate((panel) => getComputedStyle(panel).display) !== "none") throw new Error("モバイルのライブラリが初期表示されています");
await page.locator("#library-toggle").click();
if (await page.locator("#library-panel").evaluate((panel) => getComputedStyle(panel).display) === "none") throw new Error("モバイルのハンバーガーメニューでライブラリを開けません");

await page.locator("#report-list .report-card").filter({ hasText: "HMD-1 全特殊記法デモ" }).click();
await waitForReport();
const demo = await page.evaluate(() => ({
  title: document.title,
  h1: document.querySelector("#report-view h1")?.textContent,
  toc: Boolean(document.querySelector("#report-view [data-component=toc] [data-toc=list] a")),
  gfmTable: Boolean(document.querySelector("#report-view table")),
  taskList: document.querySelectorAll("#report-view input[type=checkbox]").length,
  footnote: Boolean(document.querySelector("#report-view a[href^='#user-content-fn-']")),
  callout: Boolean(document.querySelector("#report-view [data-component=callout]")),
  metrics: document.querySelectorAll("#report-view [data-component=metric]").length,
  label: Boolean(document.querySelector("#report-view [data-component=label]")),
  text: Boolean(document.querySelector("#report-view [data-component=text]")),
  tabs: Boolean(document.querySelector("#report-view [data-component=tabs]")),
  details: document.querySelectorAll("#report-view [data-component=details]").length,
  math: Boolean(document.querySelector("#report-view math")),
  mermaid: Boolean(document.querySelector("#report-view [data-component=mermaid] svg[role=img]")),
  svg: Boolean(document.querySelector("#report-view svg[role=img] title")),
  plot: Boolean(document.querySelector("#report-view [data-component=plot] svg")),
  audio: Boolean(document.querySelector("#report-view audio[controls]")),
  transcript: Boolean(document.querySelector("#report-view [data-component=audio] + details")),
  board: document.querySelectorAll("#report-view [data-component=board] [data-component=panel]").length,
  panes: document.querySelectorAll("#report-view [data-component=panes] [data-component=pane]").length,
  cards: document.querySelectorAll("#report-view [data-component=cards] [data-component=card]").length,
  modal: Boolean(document.querySelector("#report-view [data-component=modal] [data-modal-open]")),
  sandbox: Boolean(document.querySelector("#report-view [data-component=sandbox-html] [data-sandbox-run]")),
}));
if (!demo.title.includes("HMD-1 全特殊記法デモ") || !demo.h1 || !demo.toc || !demo.gfmTable || demo.taskList !== 3 || !demo.footnote || !demo.callout || demo.metrics !== 3 || !demo.label || !demo.text || !demo.tabs || demo.details !== 2 || !demo.math || !demo.mermaid || !demo.svg || !demo.plot || !demo.audio || !demo.transcript || demo.board !== 4 || demo.panes !== 3 || demo.cards !== 3 || !demo.modal || !demo.sandbox) {
  throw new Error(`全特殊記法デモの表示が不完全です: ${JSON.stringify(demo)}`);
}

if (errors.length) throw new Error(errors.join("\n"));
if (unexpectedRequests.length) throw new Error(`同一origin外の自動request: ${unexpectedRequests.join(", ")}`);

await page.close();
await browser.close();
await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
console.log("OK — Markdown Explainer の Pages subpath / rich components / URL state / responsive / theme / CSP boundary checks passed");
