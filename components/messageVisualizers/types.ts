import type { AnsiUp } from "ansi_up";
import type { ReactElement } from "react";

export type MessageVisualizerProps = {
  message: string;
  ansiUp: AnsiUp;
};

/** Alias for table cell inputs (same shape as `MessageVisualizerProps`). */
export type LogMessageCellProps = MessageVisualizerProps;

/**
 * Higher-specificity matchers should use a lower `priority` value (evaluated first).
 * Fallback visualizer uses a high priority and `canVisualize: () => true`.
 */
export interface MessageVisualizer {
  id: string;
  priority: number;
  canVisualize(props: MessageVisualizerProps): boolean;
  render(props: MessageVisualizerProps): ReactElement;
}
