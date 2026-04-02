"use client";

import type { MessageVisualizer } from "@/components/messageVisualizers/types";
import {
  oneLineJsonPreview,
  prettyPrintJson,
  tryParseStructuredJsonMessage,
} from "@/lib/parseLogJsonMessage";
import { useMemo, useState } from "react";

const PREVIEW_MAX_LEN = 160;

function JsonMessageInner({ message }: { message: string }) {
  const parsed = useMemo(
    () => tryParseStructuredJsonMessage(message),
    [message],
  );
  const [expanded, setExpanded] = useState(false);

  if (parsed === null) {
    throw new Error("jsonMessageVisualizer: render without JSON (registry order bug)");
  }

  const pretty = prettyPrintJson(parsed);
  const preview = oneLineJsonPreview(parsed, PREVIEW_MAX_LEN);

  return (
    <td className="log-viewer__message log-viewer__mono log-viewer__message--json">
      <div className="log-viewer__json-wrap">
        <div className="log-viewer__json-toolbar">
          <span className="log-viewer__json-badge">JSON</span>
          <button
            type="button"
            className="log-viewer__json-toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={
              expanded ? "Collapse formatted JSON" : "Expand formatted JSON"
            }
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
        {expanded ? (
          <pre className="log-viewer__json-pre">{pretty}</pre>
        ) : (
          <span className="log-viewer__json-preview">{preview}</span>
        )}
      </div>
    </td>
  );
}

export const jsonMessageVisualizer: MessageVisualizer = {
  id: "structured-json",
  priority: 10,
  canVisualize: ({ message }) => tryParseStructuredJsonMessage(message) !== null,
  render: ({ message }) => <JsonMessageInner message={message} />,
};
