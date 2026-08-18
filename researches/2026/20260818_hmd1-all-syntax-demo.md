---
explainer: true
hybridMarkdown: 1
id: hmd1-all-syntax-demo
summary: HMD-1 の基本 Markdown と特殊記法を一つの画面で確認する実演用サンプル。
published: "2026-08-18"
lang: ja
tags:
  - HMD-1
  - サンプル
  - 記法デモ
---

# HMD-1 全特殊記法デモ

このページは、AI が編集しやすい Markdown の正本に、HTML の情報表現を足す HMD-1 の動作確認用サンプルです。ライブラリからこのレポートを選び、上から順に読み進めると、各記法のソースと表示結果を確認できます。

::toc[このデモの目次]{minLevel="2" maxLevel="3" ordered="false"}

## 1. 基本 Markdown と GFM

HMD-1 は、独自記法だけの言語ではありません。**太字**、*斜体*、~~取り消し線~~、`inline code`、[共有仕様 README](https://github.com/Ryoma0622/agent-skills/blob/main/hybrid-markdown-reporting/README.md)、<https://github.com/Ryoma0622/ai-documents-pages> を通常の Markdown として書けます。脚注も使えます[^gfm-note]。

> 引用ブロックは、根拠やレビューコメントを本文の流れから分けて表示します。

箇条書き、入れ子、番号付きリストもそのまま利用できます。

- ソースは短い
  - 差分は局所的
  - AI は見出しと意味を追いやすい
- 表示側で図や操作部品へ変換できる

1. front matter を読む
2. Markdown を AST として検証する
3. semantic HTML として表示する

| 確認項目 | Markdown の役割 | HTML 表示の役割 |
| --- | --- | --- |
| 見出し | 文書構造 | ナビゲーション |
| 表 | 行と列のデータ | 横スクロール可能な表 |
| 部品 | 属性付きの宣言 | 操作可能な UI |

- [x] CommonMark / GFM の本文
- [x] 数式、Mermaid、SVG、音声
- [ ] 任意の JavaScript を正本にする

```text
これは通常のコードフェンスです。
通常のコードは実行されず、ソースとして表示されます。
```

---

## 2. ラベル、強調テキスト、コールアウト、指標

:label[HMD-1]{tone="accent" variant="solid" size="sm"} :label[検証済み]{tone="positive" variant="soft" size="sm"} :text[ここはテーマ token による装飾テキストです。]{color="muted" size="md"}

:::callout{kind="tip" title="記法の読み方"}
directive の属性は `key="value"` で宣言します。著者が任意の CSS やイベントハンドラーを直接入力するのではなく、既知の属性を選ぶことで、AI の生成とブラウザの検証を同じ契約にできます。
:::

:::metrics{label="サンプルに含まれる部品数" columns="3"}
::metric[16]{label="基本構文" unit="種類" tone="neutral"}
::metric[8]{label="表示部品" unit="種類" tone="positive"}
::metric[100%]{label="このページの目的" unit="可視化" tone="positive"}
:::

## 3. タブと折りたたみ

:::::tabs{id="syntax-tabs" label="同じ正本を三つの視点で読む"}
:::tab{id="reader" label="読者"}
読者は、目次、タブ、カード、図、音声、モーダルを HTML の操作部品として使います。
:::

:::tab{id="author" label="著者"}
著者は、見出しと Markdown 本文に、意味のある directive と fence を必要な場所だけ追加します。
:::

:::tab{id="agent" label="AI"}
AI は、短いテキスト、固定された属性、明示的なデータ構造を読み取り、HTML の細かなタグを直接生成せずに済みます。
:::
:::::

:::details{summary="折りたたみの中に補足を書く" open="false"}
details は、長い補足、レビュー観点、計算過程、音声の transcript などを初期状態で折りたたみます。開いたあとも中身は通常の Markdown として検索・読み上げできます。
:::

## 4. 数式、Mermaid、SVG、plot

インライン数式は $E = mc^2$ のように書き、表示数式は次のように書きます。

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

Mermaid はテキストのまま編集し、表示時に図へ変換します。

```mermaid {title="HMD-1 の変換パイプライン" description="Markdown の正本を検証済み HTML に変換する流れ"}
flowchart LR
  A[Markdown] --> B[AST 検証]
  B --> C[Semantic HTML]
  C --> D[人間向け表示]
```

SVG は、図のタイトルと説明を fence の属性で宣言し、許可された SVG 要素だけを使います。

```svg {title="三つの表示層" description="Markdown、検証、HTML の関係を示す図"}
<svg viewBox="0 0 640 180">
  <rect x="16" y="48" width="160" height="72" rx="14" fill="var(--surface)" stroke="var(--separator)" />
  <text x="96" y="90" text-anchor="middle" fill="var(--label)">Markdown</text>
  <path d="M184 84 H280" stroke="var(--accent)" stroke-width="4" />
  <circle cx="232" cy="84" r="6" fill="var(--accent)" />
  <rect x="240" y="48" width="160" height="72" rx="14" fill="var(--surface)" stroke="var(--accent)" />
  <text x="320" y="90" text-anchor="middle" fill="var(--label)">検証済み AST</text>
  <path d="M408 84 H504" stroke="var(--accent)" stroke-width="4" />
  <circle cx="456" cy="84" r="6" fill="var(--accent)" />
  <rect x="464" y="48" width="160" height="72" rx="14" fill="var(--surface)" stroke="var(--separator)" />
  <text x="544" y="90" text-anchor="middle" fill="var(--label)">HTML 表示</text>
</svg>
```

plot は、JavaScript ではなく JSON Lines のデータ契約です。

```plot {type="bar" title="デモに含まれる表示部品" xLabel="部品" yLabel="個数"}
{"x":"directive","y":8}
{"x":"fence","y":5}
{"x":"GFM","y":6}
```

## 5. 音声と transcript

音声は自動再生せず、ネイティブの controls と全文 transcript を同時に提供します。

```audio
title: HMD-1 の設計要点
caption: Markdown の正本と HTML の表示層を説明する音声
src: ./assets/markdown-explainer-demo.mp3
label: 設計要点
```

:::details{summary="音声 transcript を読む" open="false"}
音声でも説明している要点は、Markdown を正本として Git でレビューし、ブラウザ側で構造を検証してから図、指標、操作部品へ変換することです。音声を再生できない環境でも、同じ内容をここで確認できます。
:::

## 6. 2 次元レイアウトとペーン

board は、パネルの位置と大きさを `x`、`y`、`w`、`h` で宣言します。デスクトップでは 2 次元に配置し、モバイルではソース順に積みます。

:::::board{label="HMD-1 の責務を 2 次元で確認" columns="3"}
:::panel{title="正本" x="1" y="1" w="1" h="2"}
Markdown、GFM、directive、fence を Git でレビューします。
:::
:::panel{title="変換" x="2" y="1" w="1" h="1"}
AST、URL、属性、アクセシビリティを検証します。
:::
:::panel{title="表示" x="3" y="1" w="1" h="2"}
図、数式、表、音声、操作部品を提示します。
:::
:::panel{title="AI の入力契約" x="2" y="2" w="1" h="1"}
生成 HTML ではなく、短い Markdown と規範仕様を読みます。
:::
:::::

:::::panes{label="同じレポートを分けて考える" columns="3"}
:::pane{title="編集面"}
差分、コメント、front matter、本文を扱います。
:::
:::pane{title="検証面"}
未知の記法、危険な URL、重複 ID、レイアウトの重なりを拒否します。
:::
:::pane{title="表示面"}
semantic HTML、CSS、DOM イベントで人間向けの画面を作ります。
:::
:::::

## 7. カード、モーダル、HTML / JS の軽い PoC

カードは、広い画面では列に並び、狭い画面ではカルーセルとして操作できます。自動送りはせず、前後ボタンと位置表示を使います。

:::::cards{label="この形式を使える場面" columns="3"}
:::card{title="SPEC.md の設計モック" label="推奨"}
仕様本文の中に、小さな PoC や画面モックを埋め込めます。
:::
:::card{title="レビュー用の比較" label="比較"}
複数の選択肢を、同じ幅のカードとして並べられます。
:::
:::card{title="学習用の説明" label="教材"}
図、数式、例、補足を一つの Markdown にまとめられます。
:::
:::::

:::modal{id="hmd1-modal" trigger="モーダルを開く" title="モーダルの表示例" size="md"}
モーダルは本文の流れを遮らず、詳細な補足や検証結果を必要なときだけ開きます。Escape キーや閉じるボタンで戻れます。
:::

`sandbox-html` は、任意 HTML をそのまま正本にするための記法ではありません。明示的な Run 操作で、限定された iframe 内の軽い HTML / JS PoC を実行します。

```sandbox-html {title="Markdown 内の HTML / JS PoC" description="ボタンを押すと iframe 内の表示だけが更新されます" height="220" scripts="true"}
<div>
  <button id="hmd-demo-button" type="button">カウントする</button>
  <output id="hmd-demo-output">0</output>
</div>
<script>
  const button = document.querySelector('#hmd-demo-button');
  const output = document.querySelector('#hmd-demo-output');
  button.addEventListener('click', () => {
    output.textContent = String(Number(output.textContent) + 1);
  });
</script>
```

通常の HTML レポートは、ライブラリから別の HTML レポートとして読み込めます。この Markdown 内では、任意 iframe の代わりに、許可された `sandbox-html` を使って実行境界を明示します。

## 8. 記法チェックリスト

| 記法 | このページの確認場所 | 表示されるもの |
| --- | --- | --- |
| CommonMark / GFM | 1 章 | 見出し、表、タスク、脚注、リンク |
| `::toc` | ページ冒頭 | 目次 |
| `label` / `text` | 2 章 | token ベースの装飾 |
| `callout` / `metrics` | 2 章 | 注意書きと指標 |
| `tabs` / `details` | 3 章 | タブと折りたたみ |
| math / Mermaid / SVG / plot | 4 章 | 数式、図、データ可視化 |
| audio + transcript | 5 章 | 音声と代替テキスト |
| `board` / `panes` | 6 章 | 2 次元配置と複数ペーン |
| `cards` / `modal` | 7 章 | カルーセルとダイアログ |
| `sandbox-html` | 7 章 | 明示実行する HTML / JS |

[^gfm-note]: HMD-1 では、独自 directive を増やしても CommonMark と GFM の基本語彙を置き換えません。既存の Markdown ツールで読めるテキストを正本として保ちます。
