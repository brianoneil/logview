"use client";

import type { MessageVisualizer } from "@/components/messageVisualizers/types";
import {
  looksLikeMarkdownForLog,
  markdownLogSourcePreview,
  markdownLogToSafeHtml,
} from "@/lib/markdownLog";
import { useMemo, useState } from "react";

const PREVIEW_MAX_LEN = 160;

function MarkdownMessageInner({ message }: { message: string }) {
  const [expanded, setExpanded] = useState(false);
  const safeHtml = useMemo(() => markdownLogToSafeHtml(message), [message]);
  const preview = useMemo(
    () => markdownLogSourcePreview(message, PREVIEW_MAX_LEN),
    [message],
  );

  return (
    <td className="log-viewer__message log-viewer__md-cell">
      <div className="log-viewer__md-wrap">
        <div className="log-viewer__md-toolbar">
          <span className="log-viewer__md-badge">MD</span>
          <button
            type="button"
            className="log-viewer__md-toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={
              expanded ? "Collapse rendered Markdown" : "Expand rendered Markdown"
            }
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
        {expanded ? (
          <div
            className="log-viewer__md-body"
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
        ) : (
          <span className="log-viewer__md-preview">{preview}</span>
        )}
      </div>
    </td>
  );
}

export const markdownMessageVisualizer: MessageVisualizer = {
  id: "markdown",
  priority: 20,
  canVisualize: ({ message }) => looksLikeMarkdownForLog(message),
  render: ({ message }) => <MarkdownMessageInner message={message} />,
};
