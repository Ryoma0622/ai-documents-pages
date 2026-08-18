import assert from "node:assert/strict";
import test from "node:test";
import { isExplainerMarkdown, parseMarkdown, validateManifest } from "../src/parser";

const sourceUrl = "https://pages.invalid/content/researches/2026/demo.md";
const fence = "`".repeat(3);

function document(body: string): string {
  return `---
explainer: true
id: demo
summary: テスト用のレポート
published: "2026-08-18"
lang: ja
tags:
  - test
---

# Demo title

${body}`;
}

const reports = new Map([
  ["content/researches/2026/demo.md", { id: "demo", source: "content/researches/2026/demo.md" }],
  ["content/researches/2026/other.md", { id: "other", source: "content/researches/2026/other.md" }],
]);

test("rich Markdown is converted to semantic HTML", async () => {
  const markdown = document(`
:::callout{kind="warning" title="注意"}
本文。
:::

:::metrics{label="比較" columns="2"}
::metric[16]{label="HTML" unit="tokens" tone="neutral"}
::metric[3]{label="Markdown" unit="tokens" tone="positive"}
:::

::::tabs{id="views" label="表示の観点"}
:::tab{id="reader" label="読者"}
読者向け。
:::
:::tab{id="author" label="著者"}
著者向け。
:::
::::

:::details{summary="補足" open="false"}
補足本文。
:::

| A | B |
| --- | --- |
| 1 | 2 |

${fence}svg {title="図" description="説明"}
<svg viewBox="0 0 100 40"><path id="line" d="M0 0 L100 40" stroke="var(--accent)" /></svg>
${fence}

${fence}audio
title: 音声
caption: 音声の説明
src: ./assets/demo.mp3
label: 第1章
${fence}

:::details{summary="音声原稿" open="false"}
音声原稿。
:::

[別レポート](./other.md#section)
`);
  const parsed = await parseMarkdown(markdown, { sourceUrl, reports });
  assert.match(parsed.html, /<aside class="mdx-callout is-warning"/);
  assert.match(parsed.html, /<section class="mdx-metrics columns-2"/);
  assert.match(parsed.html, /data-tabs-id="views"/);
  assert.match(parsed.html, /<details class="mdx-details"/);
  assert.match(parsed.html, /class="mdx-table-scroll"/);
  assert.match(parsed.html, /<svg[^>]+role="img"[^>]+aria-labelledby=/);
  assert.match(parsed.html, /<title id="user-content-svg-1-title">図<\/title>/);
  assert.match(parsed.html, /data-audio-src="https:\/\/pages.invalid\/content\/researches\/2026\/assets\/demo.mp3"/);
  assert.match(parsed.html, /download>ダウンロード/);
  assert.match(parsed.html, /href="\?report=other#section"/);
  assert.match(parsed.html, /<h1 id="demo-title">Demo title<\/h1>/);
  assert.doesNotMatch(parsed.html, /<script|onerror|javascript:/i);
});

test("opt-in detection does not publish ordinary Markdown", () => {
  assert.equal(isExplainerMarkdown("# ordinary"), false);
  assert.equal(isExplainerMarkdown(document("本文").replace("explainer: true", "explainer: false")), false);
  assert.equal(isExplainerMarkdown(document("本文")), true);
});

test("raw HTML, unknown directives, Mermaid, and missing transcripts are rejected", async () => {
  await assert.rejects(parseMarkdown(document("<script>alert(1)</script>"), { sourceUrl }), /raw HTML/);
  await assert.rejects(parseMarkdown(document(":::unknown\ntext\n:::"), { sourceUrl }), /未知の directive/);
  await assert.rejects(parseMarkdown(document(`${fence}mermaid\ngraph TD\n${fence}`), { sourceUrl }), /Mermaid|mermaid/);
  await assert.rejects(parseMarkdown(document(`${fence}audio\nsrc: ./assets/demo.mp3\n${fence}`), { sourceUrl }), /transcript/);
});

test("dangerous references and SVG are rejected", async () => {
  await assert.rejects(parseMarkdown(document("![x](https://evil.example/x.png)"), { sourceUrl }), /外部 URL/);
  await assert.rejects(parseMarkdown(document("[x](javascript:alert(1))"), { sourceUrl }), /外部 URL/);
  await assert.rejects(parseMarkdown(document(`${fence}svg {title="図" description="説明"}\n<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>\n${fence}`), { sourceUrl }), /許可されていない要素/);
  await assert.rejects(parseMarkdown(document(`${fence}svg {title="図" description="説明"}\n<svg viewBox="0 0 1 1" onload="alert(1)"></svg>\n${fence}`), { sourceUrl }), /属性/);
  const mail = await parseMarkdown(document("[contact](mailto:hello@example.com)"), { sourceUrl });
  assert.match(mail.html, /href="mailto:hello@example.com"/);
});

test("manifest validation is strict", () => {
  const manifest = {
    schemaVersion: 1,
    reports: [{
      id: "demo",
      summary: "summary",
      published: "2026-08-18",
      lang: "ja",
      tags: [],
      title: "Demo",
      group: "researches",
      source: "content/researches/2026/demo.md",
      revision: "a".repeat(64),
    }],
  };
  assert.equal(validateManifest(manifest).length, 1);
  assert.throws(() => validateManifest({ ...manifest, reports: [{ ...manifest.reports[0], source: "content/../secret.md" }] }), /source/);
  assert.throws(() => validateManifest({ ...manifest, reports: [{ ...manifest.reports[0], source: "content/researches/2026/report.md?x=.md" }] }), /source/);
  assert.throws(() => validateManifest({ ...manifest, reports: [{ ...manifest.reports[0], source: "content/researches/2026\\..\\secret.md" }] }), /source/);
  assert.throws(() => validateManifest({ ...manifest, reports: [{ ...manifest.reports[0], extra: true }] }), /キー/);
});
