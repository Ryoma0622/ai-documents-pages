export const REPORT_ROOTS = [
  "article-summaries",
  "news",
  "note",
  "reading",
  "researches",
  "self-articles",
] as const;

export type ReportRoot = (typeof REPORT_ROOTS)[number];

export type ReportFrontmatter = {
  explainer: true;
  id: string;
  summary: string;
  published: string;
  lang: string;
  tags: string[];
};

export type ManifestReport = Omit<ReportFrontmatter, "explainer"> & {
  title: string;
  group: ReportRoot;
  source: string;
  revision: string;
};

export type Manifest = {
  schemaVersion: 1;
  reports: ManifestReport[];
};

export type ReportMapEntry = Pick<ManifestReport, "id" | "source">;

export type ParseOptions = {
  sourceUrl: string;
  reports?: Map<string, ReportMapEntry>;
  validateLinks?: boolean;
};

export type ParsedReport = {
  frontmatter: ReportFrontmatter;
  title: string;
  html: string;
  headings: string[];
  assets: string[];
  sourceUrl: string;
};
