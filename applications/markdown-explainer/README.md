# Markdown Explainer

Markdownを正本としてGitで管理し、GitHub Pagesの静的SPAで人間向けのHTMLレポートへ変換するMVPです。

## ローカル検証

```bash
npm ci
npm run check
```

`npm run check` は、共通パーサーの単体テスト、Pages artifactのビルド、Chromiumの準備、`/ai-documents-pages/` project subpathでのPlaywright検証を一度に実行します。
`public/` と`dist/`は生成物であり、Git管理へ追加しません。

## 公開対象

既存のreport rootにあるMarkdownへ、次のfront matterを付けると公開対象になります。

```yaml
---
explainer: true
id: example-report
summary: ライブラリ一覧に表示する短い説明。
published: "2026-08-18"
lang: ja
tags: []
---
```

未指定または`explainer: false`のMarkdownは、artifactへコピーされません。

## 拡張記法

- `:::callout{kind="warning" title="..."}` — 状態を伝えるコールアウト
- `:::metrics{label="..." columns="2"}` と`::metric[...]` — 指標グループ
- `::::tabs{id="..." label="..."}` と`:::tab[...]` — URLと同期するタブ
- `:::details{summary="..." open="false"}` — ネイティブ折り畳み
- `::::board{label="..." columns="2"}` と`:::panel[...]` — 座標付きの2次元レイアウト
- `svg` fence — allowlist済みSVG。`title`、`description`、`viewBox`を必須とする
- `mermaid` fence — Mermaidのフロー・シーケンス等。`title`、`description`を指定し、ビルド時に構文検証する
- `plot` fence — JSON Linesの`x`／`y`をbar・line・scatterのSVGへ変換する
- `$...$`／`$$...$$` — KaTeX-supported TeXをMathMLへ変換する数式
- `audio` fence — `title`、`caption`、`src`、`label`。直後にtranscript用`details`を置く

CommonMarkとGFM（表、タスクリスト、脚注、自動リンク、打ち消し線、reference-style link等）は標準記法として扱います。
任意のraw HTML、任意JavaScript、外部画像・音声、危険なSVGは受け付けません。raw HTMLは受動的なインライン要素に限ります。
詳しい契約は[SPEC.md](./SPEC.md)を参照してください。
