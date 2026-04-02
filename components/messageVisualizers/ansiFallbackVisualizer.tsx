"use client";

import type { MessageVisualizer } from "@/components/messageVisualizers/types";

export const ansiFallbackMessageVisualizer: MessageVisualizer = {
  id: "ansi-fallback",
  priority: 100,
  canVisualize: () => true,
  render: ({ message, ansiUp }) => (
    <td
      className="log-viewer__message log-viewer__mono"
      dangerouslySetInnerHTML={{
        __html: ansiUp.ansi_to_html(message),
      }}
    />
  ),
};
