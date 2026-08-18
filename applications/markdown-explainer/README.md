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
- `svg` fence — allowlist済みSVG。`title`、`description`、`viewBox`を必須とする
- `audio` fence — `title`、`caption`、`src`、`label`。直後にtranscript用`details`を置く

raw HTML、任意JavaScript、Mermaid、外部画像・音声、危険なSVGは受け付けません。
詳しい契約は[SPEC.md](./SPEC.md)を参照してください。
