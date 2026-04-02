import { getLogBroker } from "@/lib/log-broker";
import type { LogEntry } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/stream — SSE of log entries (live only; no history on connect).
 * Optional: ?clientId=foo to only receive logs for that client.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("clientId");
  const clientIdFilter =
    raw === null || raw === "" ? null : raw;

  const encoder = new TextEncoder();
  const broker = getLogBroker();

  let unsubscribe: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // SSE comment: flush headers/body immediately so clients leave CONNECTING
      // before the next live log event.
      controller.enqueue(encoder.encode(": logview stream\n\n"));

      const safeSend = (entry: LogEntry) => {
        const payload = `data: ${JSON.stringify(entry)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      unsubscribe = broker.subscribe(clientIdFilter, safeSend);

      request.signal.addEventListener("abort", () => {
        try {
          unsubscribe();
          controller.close();
        } catch {
          // stream may already be closed
        }
      });
    },
    cancel() {
      unsubscribe();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
