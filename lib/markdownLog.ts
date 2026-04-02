import { Marked } from "marked";
import DOMPurify from "isomorphic-dompurify";
import { tryParseStructuredJsonMessage } from "@/lib/parseLogJsonMessage";
import { stripAnsi } from "@/lib/stripAnsi";

/** Dedicated parser so we never mutate global `marked` used by `/usage`. */
const logMarked = new Marked({
  gfm: true,
  breaks: true,
});

/**
 * If the line is not structured JSON, returns whether stripped text looks like Markdown
 * (headers, lists, code fences, emphasis, links, blockquotes) to avoid false positives on plain logs.
 */
export function looksLikeMarkdownForLog(raw: string): boolean {
  if (tryParseStructuredJsonMessage(raw) !== null) return false;

  const plain = stripAnsi(raw).trim();
  if (plain.length < 4) return false;

  if (/^#{1,6}\s/m.test(plain)) return true;
  if (/^```/m.test(plain)) return true;
  if (/^\s*[-*+]\s+\S/m.test(plain)) return true;
  if (/^\s*\d+\.\s+\S/m.test(plain)) return true;
  if (/^>\s/m.test(plain)) return true;
  if (/\*\*[^*\n]{1,120}\*\*/.test(plain)) return true;
  if (/\[[^\]\n]{1,120}\]\([^)\n]{1,240}\)/.test(plain)) return true;
  if (/(^|\s)`[^`\n]{1,240}`(\s|$)/.test(plain)) return true;

  return false;
}

/** Render Markdown to HTML and sanitize for `dangerouslySetInnerHTML`. */
export function markdownLogToSafeHtml(src: string): string {
  const raw = logMarked.parse(src) as string;
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
}

/** Single-line plain preview from the raw markdown source (collapsed state). */
export function markdownLogSourcePreview(src: string, maxLen: number): string {
  const oneLine = stripAnsi(src).replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, Math.max(1, maxLen - 1))}…`;
}
