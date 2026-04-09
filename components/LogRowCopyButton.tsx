"use client";

import type { LogEntry } from "@/lib/types";
import { formatLogEntryForClipboard } from "@/lib/formatLogLineForClipboard";
import { useCallback, useState } from "react";

type CopyState = "idle" | "copied" | "error";

export function LogRowCopyButton({ entry }: { entry: LogEntry }) {
  const [state, setState] = useState<CopyState>("idle");

  const onClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(formatLogEntryForClipboard(entry));
      setState("copied");
    } catch (e) {
      console.error("Logview: clipboard copy failed", e);
      setState("error");
    }
  }, [entry]);

  const onBlur = useCallback(() => {
    setState("idle");
  }, []);

  const title =
    state === "copied"
      ? "Copied to clipboard"
      : state === "error"
        ? "Copy failed — check permissions"
        : "Copy formatted line to clipboard";

  return (
    <button
      type="button"
      className={
        state === "copied"
          ? "log-viewer__copy-btn log-viewer__copy-btn--copied"
          : state === "error"
            ? "log-viewer__copy-btn log-viewer__copy-btn--error"
            : "log-viewer__copy-btn"
      }
      onClick={onClick}
      onBlur={onBlur}
      title={title}
      aria-label={title}
    >
      <svg
        className="log-viewer__copy-icon"
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <path
          fill="currentColor"
          d="M4.5 1.75a1 1 0 0 1 1-1h5.25A2.25 2.25 0 0 1 13 3v6.25a1 1 0 0 1-1 1H10.5v1a1 1 0 0 1-1 1H3a2 2 0 0 1-2-2V4.75a1 1 0 0 1 1-1h2.5v-2Zm1 1.5V5h5.75A.75.75 0 0 0 12 4.25V3a.75.75 0 0 0-.75-.75H5.5Zm-3 1V11c0 .55.45 1 1 1h6.5a.25.25 0 0 0 .25-.25v-.5H5.5a1 1 0 0 1-1-1V4.25Z"
        />
      </svg>
    </button>
  );
}
