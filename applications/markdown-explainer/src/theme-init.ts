const THEME_KEY = "markdown-explainer-theme";
const root = document.documentElement;

try {
  const stored = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = stored === "dark" || (!stored && prefersDark) ? "dark" : "light";
} catch {
  (window as Window & { __markdownExplainerThemeError?: string }).__markdownExplainerThemeError =
    "テーマ設定を読み込めません。ブラウザのlocalStorageを有効にしてください。";
}
