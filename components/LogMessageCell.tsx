"use client";

import { findMessageVisualizer } from "@/components/messageVisualizers/registry";
import type { LogMessageCellProps } from "@/components/messageVisualizers/types";

export type { LogMessageCellProps } from "@/components/messageVisualizers/types";

export function LogMessageCell({ message, ansiUp }: LogMessageCellProps) {
  const visualizer = findMessageVisualizer({ message, ansiUp });
  return visualizer.render({ message, ansiUp });
}
