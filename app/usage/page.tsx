import Link from "next/link";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { marked } from "marked";

export const metadata = {
  title: "Ingest API · Logview",
  description: "How to send logs to Logview (HTTP ingest)",
};

/** Avoid stale prerendered HTML; always read USAGE.md from disk (small file). */
export const dynamic = "force-dynamic";

marked.setOptions({
  gfm: true,
  breaks: false,
});

export default async function UsagePage() {
  const filePath = path.join(process.cwd(), "USAGE.md");
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (e) {
    console.error("USAGE.md read failed:", e);
    content = "# Error\n\nCould not load `USAGE.md`.";
  }

  const html = marked.parse(content) as string;

  return (
    <main className="usage-doc">
      <nav className="usage-doc__nav" aria-label="Breadcrumb">
        <Link href="/">← Logview</Link>
      </nav>
      <article
        className="usage-doc__article"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </main>
  );
}
