# ai-documents-pages

Markdown Explainerの自己完結型PoCです。

## ローカル実行

```bash
cd applications/markdown-explainer
npm ci
npm run dev
```

`researches/2026/20260818_markdown-html-hybrid-platform.md` が、独自記法を含むサンプルレポートです。`*.html` もレポートとして自動発見され、ライブラリから通常の HTML 文書として表示できます。
Markdown または HTML を編集して `main` へ push すると、GitHub Actions が静的 SPA をビルドし、GitHub Pages へデプロイします。

## GitHub Pages

Pagesの公開元は`GitHub Actions`に設定してください。
GitHub Pagesは公開サイトなので、公開対象のMarkdownや素材に秘密情報を含めないでください。
