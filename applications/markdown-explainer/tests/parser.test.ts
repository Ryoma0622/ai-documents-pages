import assert from "node:assert/strict";
import test from "node:test";
import { isExplainerMarkdown, parseMarkdown, validateManifest } from "../src/parser";

const sourceUrl = "https://pages.invalid/content/researches/2026/demo.md";
const fence = "`".repeat(3);

function document(body: string): string {
  return `---
explainer: true
hybridMarkdown: 1
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

::::board{label="構造" columns="2"}
:::panel{title="入力" x="1" y="1" w="1" h="2"}
Markdown。
:::
:::panel{title="出力" x="2" y="1"}
HTML。
:::
::::

## After component

| A | B |
| --- | --- |
| 1 | 2 |

- [x] GFM task list

脚注[^note]と数式 $x^2$。

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

[^note]: GFM footnote。

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
  assert.match(parsed.html, /<figure class="mdx-svg" data-component="svg">/);
  assert.match(parsed.html, /<title id="user-content-svg-1-title">図<\/title>/);
  assert.match(parsed.html, /data-audio-src="https:\/\/pages.invalid\/content\/researches\/2026\/assets\/demo.mp3"/);
  assert.match(parsed.html, /<figure class="mdx-audio" data-component="audio"/);
  assert.match(parsed.html, /download>ダウンロード/);
  assert.match(parsed.html, /href="\?report=other#section"/);
  assert.match(parsed.html, /<h1 id="demo-title">Demo title<\/h1>/);
  assert.match(parsed.html, /class="contains-task-list"/);
  assert.match(parsed.html, /class="footnotes"/);
  assert.match(parsed.html, /class="katex"/);
  assert.match(parsed.html, /<msubsup>/);
  assert.match(parsed.html, /class="mdx-board columns-2"/);
  assert.match(parsed.html, /class="mdx-board-panel mdx-panel-x1-w1 mdx-panel-y1-h2"/);
  assert.match(parsed.html, /<h2 id="after-component">After component<\/h2>/);
  assert.doesNotMatch(parsed.html, /<script|onerror|javascript:/i);
});

test("opt-in detection does not publish ordinary Markdown", () => {
  assert.equal(isExplainerMarkdown("# ordinary"), false);
  assert.equal(isExplainerMarkdown(document("本文").replace("explainer: true", "explainer: false")), false);
  assert.equal(isExplainerMarkdown(document("本文").replace("hybridMarkdown: 1\n", "")), false);
  assert.equal(isExplainerMarkdown(document("本文")), true);
});

test("HMD-1 layout, navigation, labels, modal, and sandbox components are semantic", async () => {
  const markdown = document(`
::toc[Contents]{minLevel="2" maxLevel="3" ordered="false" mobile="hidden"}

## Section

:label[Beta]{tone="accent" variant="soft" size="sm"} :text[重要]{color="danger" size="lg"}

::::panes{label="比較" columns="2"}
:::pane{title="正本"}
Markdown。
:::
:::pane{title="表示"}
HTML。
:::
::::

::::cards{label="選択肢" columns="2"}
:::card{title="一つ目" label="推奨"}
本文。
:::
:::card{title="二つ目"}
本文。
:::
::::

:::modal{id="details" trigger="詳細を見る" title="詳細" size="md"}
モーダル本文。
:::

${fence}sandbox-html {title="Demo" description="説明" height="240" scripts="false"}
<p>実行されるHTML。</p>
${fence}
`);
  const parsed = await parseMarkdown(markdown, { sourceUrl });
  assert.match(parsed.html, /data-component="toc"/);
  assert.match(parsed.html, /data-component="label"/);
  assert.match(parsed.html, /data-component="text"/);
  assert.match(parsed.html, /data-component="panes"/);
  assert.match(parsed.html, /data-component="cards"/);
  assert.match(parsed.html, /data-component="modal"/);
  assert.match(parsed.html, /aria-labelledby="user-content-modal-details-title"/);
  assert.match(parsed.html, /data-component="sandbox-html"/);
  assert.match(parsed.html, /data-sandbox-scripts="false"/);
  assert.match(parsed.html, /実行されるHTML/);
  await assert.rejects(parseMarkdown(document(`:label[Bad]{color="red"}`), { sourceUrl }), /属性/);
  await assert.rejects(parseMarkdown(document(`:label[Bad]{tone="accent" tone="danger"}`), { sourceUrl }), /重複/);
  await assert.rejects(parseMarkdown(document(`:unknown[Bad]`), { sourceUrl }), /未知/);
  await assert.rejects(parseMarkdown(document(":::cards{label=\"不正\" columns=\"2\" unknown=\"x\"}\n:::card{title=\"A\"}\nA\n:::\n:::card{title=\"B\"}\nB\n:::\n::::"), { sourceUrl }), /属性/);
  await assert.rejects(parseMarkdown(document(`${fence}sandbox-html {title="Demo" scripts="true" height="120"}\n<p>x</p>\n${fence}`), { sourceUrl }), /height/);
});

test("safe HTML, Mermaid, plot, unknown directives, and missing transcripts follow the contract", async () => {
  const safeHtml = await parseMarkdown(document("<mark>安全なHTML</mark>"), { sourceUrl });
  assert.match(safeHtml.html, /<mark>安全なHTML<\/mark>/);
  const passiveHtml = await parseMarkdown(document('<abbr title="略語">HTML</abbr>'), { sourceUrl });
  assert.match(passiveHtml.html, /<abbr title="略語">HTML<\/abbr>/);
  await assert.rejects(parseMarkdown(document("<script>alert(1)</script>"), { sourceUrl }), /raw HTML/);
  await assert.rejects(parseMarkdown(document('<h1 id="spoof">偽の見出し</h1>'), { sourceUrl }), /raw HTML/);
  await assert.rejects(parseMarkdown(document('<span class="mdx-callout" data-component="callout">偽装</span>'), { sourceUrl }), /raw HTML/);
  await assert.rejects(parseMarkdown(document(":::unknown\ntext\n:::"), { sourceUrl }), /未知の directive/);
  const mermaid = await parseMarkdown(document(`${fence}mermaid {title="処理フロー" description="入力から出力への流れ"}\ngraph TD\n  A[入力] --> B[出力]\n${fence}`), { sourceUrl });
  assert.match(mermaid.html, /data-component="mermaid"/);
  assert.match(mermaid.html, /data-mermaid-source="true"/);
  const plot = await parseMarkdown(document(`${fence}plot {type="bar" title="比較" xLabel="項目" yLabel="値"}\n{"x":"A","y":1}\n{"x":"B","y":2}\n${fence}`), { sourceUrl });
  assert.match(plot.html, /class="mdx-plot"/);
  assert.match(plot.html, /class="mdx-plot-svg"/);
  await assert.rejects(parseMarkdown(document(`${fence}mermaid\n%%{init: {"securityLevel": "loose"}}%%\ngraph TD\n${fence}`), { sourceUrl }), /directive/);
  await assert.rejects(parseMarkdown(document(`${fence}mermaid\n%%{initialize: {"securityLevel": "loose"}}%%\ngraph TD\n${fence}`), { sourceUrl }), /directive/);
  await assert.rejects(parseMarkdown(document(`${fence}mermaid\ngraph TD\n  A --> B\n  click A "https://evil.example"\n${fence}`), { sourceUrl }), /外部遷移/);
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
      format: "markdown",
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
  assert.equal(validateManifest({
    ...manifest,
    reports: [{ ...manifest.reports[0], format: "html", source: "content/researches/2026/demo.html" }],
  }).length, 1);
  assert.throws(() => validateManifest({
    ...manifest,
    reports: [{ ...manifest.reports[0], format: "html" }],
  }), /拡張子/);
  assert.throws(() => validateManifest({ ...manifest, reports: [{ ...manifest.reports[0], source: "content/../secret.md" }] }), /source/);
  assert.throws(() => validateManifest({ ...manifest, reports: [{ ...manifest.reports[0], source: "content/researches/2026/report.md?x=.md" }] }), /source/);
  assert.throws(() => validateManifest({ ...manifest, reports: [{ ...manifest.reports[0], source: "content/researches/2026\\..\\secret.md" }] }), /source/);
  assert.throws(() => validateManifest({ ...manifest, reports: [{ ...manifest.reports[0], extra: true }] }), /キー/);
});
