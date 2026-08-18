---
explainer: true
id: markdown-html-hybrid-platform
summary: AIが編集しやすいMarkdownを正本にし、人間向けのHTML体験へ変換する基盤の調査とMVP設計。
published: "2026-08-18"
lang: ja
tags:
  - Markdown
  - HTML
  - GitHub Pages
  - AI
---

# Markdown と HTML のハイブリッドレポート基盤

## 結論

MarkdownとHTMLは、どちらか一方が常に優れている形式ではない。
Markdownは、短い正本、局所的なGit diff、エージェントへの入力、別ツールへの可搬性に強い。
HTMLは、セマンティックな文書構造、視覚的な情報密度、ネイティブ操作部品、SVG、音声、レスポンシブなレビュー画面に強い。

したがって、Markdownを正本として編集し、宣言的な独自記法だけをASTで検証してHTMLの部品へ変換する構成は実現可能であり、今回のMVPとして妥当である。
GitHub Pagesは静的なHTML・CSS・JavaScriptを配信できるため、ブラウザ側にパーサーを同梱すれば、サーバーやAPIなしで運用できる [S3][] [S4][]。
この判断の要約は[結論へ戻る](./20260818_markdown-html-hybrid-platform.md#結論)からも開ける。

:::callout{kind="important" title="この実装で守る境界"}
Markdownの正本と、ブラウザで生成するHTML表示を分ける。
ただし、任意HTMLや任意JavaScriptをMarkdownへ開放せず、許可されたdirectiveとfenceだけをセマンティックHTMLへ変換する。
:::

:::metrics{label="MarkdownとHTMLの入力サイズ例" columns="3"}
::metric[16,180]{label="HTML" unit="tokens" tone="neutral"}
::metric[3,150]{label="Markdown" unit="tokens" tone="positive"}
::metric[80.5%]{label="例示上の削減" unit="" tone="positive"}
:::

この数値はCloudflareが一つのページで示した例であり、Markdown一般の圧縮率ではない [S5][]。

## 1. MarkdownとHTMLは何が違うか

### 1.1 Markdownは「構造を残した短い正本」

CommonMarkは、Markdownを構造化文書を記述するためのプレーンテキスト形式として定義している [S1][]。
GFMはCommonMarkを基礎に、表、取り消し線、タスクリスト、自動リンクなどを仕様化する [S2][]。

この性質は、AIを含む編集者にとって次の意味を持つ。

- 表示用のタグやスタイルが本文へ混入しにくい。
- 変更の意図が行単位のdiffに現れやすい。
- GitHub、エディタ、レビューBot、別の変換器へ渡しやすい。
- 同じ本文を複数の出力形式へ再利用しやすい。

Anthropicの解説は、Markdownを可搬性と編集容易性に優れる形式として扱う一方、長い文書や複雑な視覚表現では制約になると説明している [S6][]。
ただし、その記事はHTMLの利点を強調する著者の実践報告であり、形式全体の実証的な優劣を示すベンチマークではない。

### 1.2 HTMLは「意味と表示を同じ配信物に持つ出力」

HTMLは、見出し、リンク、表、開閉部品などの意味をブラウザへ渡し、CSSとJavaScriptで人間向けのレビュー体験を作れる [S10][] [S11][]。
正しい要素を使うと、キーボード操作や支援技術が利用できる既定の意味も得られる [S10][]。

SVGはテキストベースで、CSS・DOM・JavaScriptと組み合わせて図解を表現できる [S15][]。
`<audio controls>`は、ブラウザ標準の再生操作と複数の音源を提供できる [S16][]。
`<details>`と`<summary>`は、独自の開閉JavaScriptを増やさずに折り畳みを提供する [S17][]。

| 観点 | Markdownの正本 | HTMLの表示 |
| --- | --- | --- |
| 編集 | 短く、局所的な変更をレビューしやすい | タグ・属性・スタイルが本文へ混ざりやすい |
| AI入力 | 高シグナルな本文を少ないトークンで渡しやすい | 表示都合の要素が入力へ混ざる |
| 表現 | 基本構造とGFMに集中する | 図、状態、空間配置、操作部品まで扱える |
| 配信 | 変換器があれば多くの環境で読める | ブラウザでそのまま表示できる |
| 安全性 | 記法を限定しやすい | 任意HTMLを許すとスクリプト境界が広がる |

## 2. 「AIに読みやすい」は単純な形式比較ではない

MarkdownがAIに向くという主張は、入力の短さ、構文の規則性、ノイズの少なさという条件付きで理解すべきである。
Anthropicは、エージェントのコンテキストは有限であり、高シグナルな情報を少ないトークンで渡すことを重視している [S24][]。
この観点では、HTMLの表示用属性や装飾を除いたMarkdownは有利になりやすい。

しかし、HTMLの構造がAIにとって常に不利とは限らない。
HtmlRAGは、HTMLの階層構造が取得知識の構造を保つ場合に、プレーンテキストより有用になりうると報告している [S9][]。
Markdown Awarenessを評価するMDEvalも、LLMのMarkdown出力を構造と読みやすさの観点から測るベンチマークであり、Markdownがあらゆるタスクで最良だと証明するものではない [S21][]。

ここから得られる実務上の原則は、「AIにはMarkdown、人間にはHTML」という二分法ではない。
編集・レビュー・再利用をMarkdownへ寄せ、読者が必要とする意味構造と操作性だけをHTMLへ投影することである。

## 3. HTMLの利点をMarkdownへ落とす設計

独自記法は、HTMLをそのまま埋め込むためではなく、意味のあるデータを宣言するために使う。
remarkのASTとプラグインモデル、`remark-directive`のgeneric directiveは、この境界を実装する先例になる [S12][] [S13][]。
MySTも、Markdownの可読性を残したまま、callout、タブ、図などのdirectiveを追加する設計を採用している [S14][]。

::::tabs{id="reader-author" label="読者と著者の視点"}
:::tab{id="reader" label="読者"}
読者は、見出し、コールアウト、指標、タブ、折り畳み、図、音声を一つのHTML画面で扱う。
キーボード、画面幅、ダークモード、読み上げを含むレビュー体験をCSSとDOMで提供する。
:::

:::tab{id="author" label="著者"}
著者は、front matter、GFM本文、少数の宣言的directive、SVGまたはaudio fenceだけを編集する。
生成HTMLを正本にせず、GitHub上でMarkdownの差分をレビューする。
:::

:::tab{id="agent" label="エージェント"}
エージェントは、構造が明示された短いMarkdownと、既知の記法の仕様を入力として扱う。
任意のJSやCSSを推測して書く必要がないため、変換結果の検証範囲を限定できる。
:::
::::

### 3.1 コールアウトと指標

コールアウトは、状態や注意点を色だけに閉じ込めず、kindとタイトルを可視テキストにする。
指標は、計算式を評価せず、表示用文字列を`<dl>`へ変換する。
これにより、視覚的なカードと、支援技術が読めるラベル・値の順序を両立する。

### 3.2 タブと折り畳み

タブは、本文の複数の見方を横に並べずに保持する。
出力側ではWAI-ARIAの`tablist`、`tab`、`tabpanel`を使い、選択状態をURLへ同期する。
折り畳みはネイティブの`details`を使い、開閉のための独自状態を減らす。

### 3.3 SVGと音声

SVG fenceは、ルート`svg`、`viewBox`、図のタイトルと説明を必須にする。
許可要素・属性を少数に限定し、script、style、foreignObject、image、use、SMIL、外部参照を拒否する。
図だけに結論を閉じ込めず、本文にも意味を記載する。

```svg {title="MarkdownからHTMLへの変換" description="MarkdownをASTとして検証し、許可されたHTML部品へ変換する流れ"}
<svg viewBox="0 0 640 160">
  <rect x="16" y="40" width="160" height="72" rx="14" fill="var(--surface)" stroke="var(--separator)" />
  <text x="96" y="82" text-anchor="middle" fill="var(--label)">Markdown</text>
  <path d="M184 76 H280" stroke="var(--accent)" stroke-width="4" />
  <rect x="288" y="40" width="160" height="72" rx="14" fill="var(--surface)" stroke="var(--separator)" />
  <text x="368" y="82" text-anchor="middle" fill="var(--label)">検証済みAST</text>
  <path d="M456 76 H552" stroke="var(--accent)" stroke-width="4" />
  <rect x="560" y="40" width="64" height="72" rx="14" fill="var(--surface)" stroke="var(--accent)" />
  <text x="592" y="82" text-anchor="middle" fill="var(--label)">HTML</text>
</svg>
```

audio fenceは、既存Explainer Sitesの`title`、`caption`、複数の`src`、`label`というキーを引き継ぐ。
autoplayは使わず、ネイティブcontrols、章名、ダウンロードリンク、直後の全文transcriptを出力する。

```audio
title: ハイブリッド基盤の設計要点
caption: Markdown正本とHTML表示の役割分担を聞く
src: ./assets/markdown-explainer-demo.mp3
label: 調査結果と設計判断
```

:::details{summary="音声transcript" open="false"}
この音声は、Markdownを正本として保ちながら、ブラウザ側で検証済みのHTML部品へ変換する考え方を説明する。
:::

## 4. GitHub Pagesで実現できるか

実現できる。
GitHub Pagesは静的サイトを公開するサービスであり、リポジトリのルートまたは`docs`、Actions artifactなどを公開元にできる [S3][] [S4][]。
`.nojekyll`を含むartifactへ、`index.html`、同梱JavaScript、CSS、manifest、公開対象Markdown、参照アセットを配置すればよい。

今回のMVPは、次の一方向のデータフローに固定する。

1. Git管理下のMarkdownに`explainer: true`を付ける。
2. ビルドがMarkdownを走査し、front matter、directive、fence、URL、参照アセットを検証する。
3. ビルドが決定的な`manifest.json`と`content/`を作る。
4. GitHub Pagesの`index.html`がmanifestからレポートを選ぶ。
5. ブラウザがMarkdownを取得し、同じパーサーでASTから安全なHTMLへ変換する。

レポート本文をレポート別HTMLへ事前生成しないことが重要である。
正本をMarkdownに残し、ビルドとブラウザが同じparser・allowlist・URLポリシーを共有することで、編集しやすさと表示の豊かさを一つのソースから再現する。

## 5. セキュリティと品質の境界

ブラウザでMarkdownをHTMLへ変換する場合、Markdown parserはHTML sanitizerではない。
Markedのドキュメントも、解析後のHTMLを別途サニタイズする必要があると明記している [S18][]。
DOMPurifyはDOM上のHTML、MathML、SVGをサニタイズする代表的な実装だが、今回のMVPでは任意HTMLを受け付けず、ASTから許可済みHASTを生成する [S19][]。

このMVPが拒否するものは次のとおりである。

- raw HTML、MDX、JSX、任意JavaScript、任意CSS、未知directive。
- `javascript:`、`data:`、protocol-relative URL、外部の画像・音声。
- report rootの外に出る相対パス、存在しないアセット。
- SVGのscript、style、foreignObject、image、use、SMIL、外部参照。
- Mermaidなど、実行時ライブラリを必要とする未定義のfence。

GitHub Pages側にはレスポンスヘッダーを設定できないため、HTML shellに同一originだけを許可するCSP metaを置く。
WCAGはテキストだけでなく、画像、音声、動的コンテンツ、AIインターフェースも対象にする [S20][]。
そのため、サニタイズだけでなく、キーボード操作、focus ring、SVGの説明、音声transcript、ダークモード、reduced motionを受入条件へ含める。

## 6. 実装したMVP

このリポジトリには、`applications/markdown-explainer/`として静的SPAを追加した。
公開対象は既存の六つのreport rootから`explainer: true`を持つMarkdownだけを再帰走査する。
manifestには本文のSHA-256 revisionを含め、ブラウザは取得した本文のrevisionを検証してからDOMへ挿入する。

実装した独自記法は、callout、metrics、tabs、details、SVG fence、audio fenceである。
標準GFMの表は横スクロール可能なregionへ包み、見出しfragment、レポート選択、戻る・進む、タブURL、テーマ切り替えをJavaScriptで扱う。
パーサーはbuildとbrowserで共有し、raw HTMLを表示へフォールバックしない。

:::callout{kind="tip" title="MVPの判断"}
VueやReactを必須にせず、semantic HTML、CSS、最小限のDOMイベント処理で実装した。
GitHub Pagesに置くための依存関係はlockfileで固定し、CDNを使わない。
:::

## 7. 残る制約と次の判断

この設計は、自由形式のdashboardを作るDSLではない。
Chart.js、D3、Mermaid、数式、iframe、video、外部widget、データfetch、認証、検索、PWAはMVPの対象外とした。
表現力を増やすほど、独自記法の仕様、サニタイズ、アクセシビリティ、差分レビュー、AI入力の契約が同時に重くなるためである。

独立した反論は、HTMLのsource readability、diffability、securityの問題を指摘し、Markdownと既知のHTMLテンプレートの組み合わせを提案している [S7][]。
Hacker Newsの議論にも、Markdownをsource of truthにして既知のHTMLテンプレートへ変換する方向と、ソースを共同編集する価値への言及がある [S8][]。
このMVPは、その中間案として「Markdownの編集面」と「HTMLの表示面」を分けるが、許可された語彙を増やしすぎない。

本調査からの実務上の判断は、既存のExplainer Sitesを置き換えることではない。
既存viewerはそのまま維持し、pilot reportだけにfront matterを追加し、新しいPages artifactで直接リンク、モバイル、キーボード、音声、XSS corpusを確認してから公開集合を増やすことである。

## 参考資料

[S1] CommonMark. “CommonMark Spec.”

[S2] GitHub. “GitHub Flavored Markdown Spec.”

[S3] GitHub Docs. “What is GitHub Pages?”

[S4] GitHub Docs. “Configuring a publishing source for your GitHub Pages site.”

[S5] Cloudflare. “Markdown for Agents.”

[S6] Anthropic. “Using Claude Code: The unreasonable effectiveness of HTML.”

[S7] Kurtis Redux. “The unreasonable ineffectiveness of HTML.”

[S8] Hacker News. “Discussion item 48072400.”

[S9] Xia et al. “HtmlRAG: HTML is Better Than Plain Text for Modeling Retrieved Knowledge in RAG Systems.” arXiv:2411.02959.

[S10] MDN Web Docs. “HTML: A good basis for accessibility.”

[S11] WHATWG. “HTML Living Standard.”

[S12] remark. “Markdown processor powered by plugins.”

[S13] remark-directive. “remark plugin to support directives.”

[S14] MyST Markdown. “MyST Markdown Guide.”

[S15] MDN Web Docs. “SVG: Scalable Vector Graphics.”

[S16] MDN Web Docs. “`<audio>`: The Embed Audio element.”

[S17] MDN Web Docs. “`<details>`: The Details disclosure element.”

[S18] Marked. “Marked Documentation.”

[S19] cure53. “DOMPurify.”

[S20] W3C WAI. “Web Content Accessibility Guidelines (WCAG) Overview.”

[S21] MDEval authors. “MDEval: Evaluating LLMs on Markdown Awareness.” arXiv:2501.15000.

[S22] MDX. “remark-mdx.”

[S23] GitHub Docs. “Creating a GitHub Pages site.”

[S24] Anthropic. “Effective context engineering for AI agents.”

[S1]: https://spec.commonmark.org/current/
[S2]: https://github.github.com/gfm/
[S3]: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
[S4]: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
[S5]: https://blog.cloudflare.com/markdown-for-agents/
[S6]: https://claude.com/blog/using-claude-code-the-unreasonable-effectiveness-of-html
[S7]: https://kurtis-redux.medium.com/the-unreasonable-ineffectiveness-of-html-5bd01ae1e879
[S8]: https://news.ycombinator.com/item?id=48072400
[S9]: https://arxiv.org/abs/2411.02959
[S10]: https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Accessibility/HTML
[S11]: https://html.spec.whatwg.org/
[S12]: https://remark.js.org/
[S13]: https://github.com/remarkjs/remark-directive
[S14]: https://mystmd.org/guide/quickstart-myst-markdown
[S15]: https://developer.mozilla.org/en-US/docs/Web/SVG
[S16]: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/audio
[S17]: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details
[S18]: https://marked.js.org/
[S19]: https://github.com/cure53/DOMPurify
[S20]: https://www.w3.org/WAI/standards-guidelines/wcag/
[S21]: https://arxiv.org/html/2501.15000v2
[S22]: https://mdxjs.com/packages/remark-mdx/
[S23]: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
[S24]: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
