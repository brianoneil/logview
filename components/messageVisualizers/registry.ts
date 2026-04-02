import { ansiFallbackMessageVisualizer } from "@/components/messageVisualizers/ansiFallbackVisualizer";
import { jsonMessageVisualizer } from "@/components/messageVisualizers/jsonMessageVisualizer";
import { markdownMessageVisualizer } from "@/components/messageVisualizers/markdownMessageVisualizer";
import type {
  MessageVisualizer,
  MessageVisualizerProps,
} from "@/components/messageVisualizers/types";

const builtinVisualizers: MessageVisualizer[] = [
  jsonMessageVisualizer,
  markdownMessageVisualizer,
  ansiFallbackMessageVisualizer,
].sort((a, b) => a.priority - b.priority);

let customVisualizers: MessageVisualizer[] = [];

function mergedSorted(): MessageVisualizer[] {
  return [...customVisualizers, ...builtinVisualizers].sort(
    (a, b) => a.priority - b.priority,
  );
}

/**
 * Register or replace a visualizer by `id`. Custom entries participate in the same
 * priority sort as built-ins (lower `priority` runs first).
 */
export function registerMessageVisualizer(visualizer: MessageVisualizer): void {
  customVisualizers = [
    ...customVisualizers.filter((v) => v.id !== visualizer.id),
    visualizer,
  ];
}

export function findMessageVisualizer(
  props: MessageVisualizerProps,
): MessageVisualizer {
  const chain = mergedSorted();
  const found = chain.find((v) => v.canVisualize(props));
  return found ?? ansiFallbackMessageVisualizer;
}
