"use client";

import type { LogEntry } from "@/lib/types";
import { AnsiUp } from "ansi_up";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
  } catch {
    return iso;
  }
}

function rowMatchesFilter(entry: LogEntry, q: string) {
  if (q === "") return true;
  const needle = q.toLowerCase();
  const hay = [
    entry.message,
    entry.level,
    entry.id,
    entry.ts,
    entry.clientId ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(needle);
}

export interface LogViewerProps {
  initialStreamClientId?: string;
}

export function LogViewer({ initialStreamClientId = "" }: LogViewerProps) {
  const ansiUp = useMemo(() => new AnsiUp(), []);
  const [rows, setRows] = useState<LogEntry[]>([]);
  const [textFilter, setTextFilter] = useState("");
  const [streamClientDraft, setStreamClientDraft] = useState(
    initialStreamClientId,
  );
  const [appliedStreamClientId, setAppliedStreamClientId] = useState(
    initialStreamClientId,
  );
  const [sseStatus, setSseStatus] = useState<"connecting" | "open" | "error">(
    "connecting",
  );

  /**
   * After "Clear local logs", SSE reconnects (browser/proxy) re-subscribe and the
   * server replays its buffer — without a cutoff those rows would reappear.
   * Reset when the stream subscription changes so a new filter still gets replay.
   */
  const lastClearMsRef = useRef<number | null>(null);

  const appendEntries = useCallback((entries: LogEntry[]) => {
    const cutoff = lastClearMsRef.current;
    const filtered =
      cutoff !== null
        ? entries.filter((e) => {
            const t = Date.parse(e.ts);
            return !Number.isNaN(t) && t >= cutoff;
          })
        : entries;
    if (filtered.length === 0) return;
    setRows((prev) => [...prev, ...filtered].slice(-5_000));
  }, []);

  useEffect(() => {
    lastClearMsRef.current = null;
    setRows([]);

    const path =
      typeof window !== "undefined"
        ? `${window.location.origin}/api/stream`
        : "/api/stream";
    const url = new URL(path);
    if (appliedStreamClientId.trim() !== "") {
      url.searchParams.set("clientId", appliedStreamClientId.trim());
    }

    setSseStatus("connecting");
    const source = new EventSource(url.toString());

    const syncStatusFromReadyState = () => {
      if (source.readyState === EventSource.OPEN) setSseStatus("open");
    };

    const onMessage = (ev: MessageEvent<string>) => {
      try {
        const entry = JSON.parse(ev.data) as LogEntry;
        appendEntries([entry]);
      } catch (e) {
        console.error("Bad SSE payload:", e);
      }
    };

    const onOpen = () => setSseStatus("open");
    const onError = () => {
      if (source.readyState === EventSource.CLOSED) {
        setSseStatus("error");
      }
    };

    source.addEventListener("message", onMessage);
    source.addEventListener("open", onOpen);
    source.addEventListener("error", onError);
    queueMicrotask(syncStatusFromReadyState);

    return () => {
      source.removeEventListener("message", onMessage);
      source.removeEventListener("open", onOpen);
      source.removeEventListener("error", onError);
      source.close();
    };
  }, [appliedStreamClientId, appendEntries]);

  const filtered = useMemo(
    () => rows.filter((r) => rowMatchesFilter(r, textFilter)),
    [rows, textFilter],
  );

  const applyStreamFilter = () => {
    setAppliedStreamClientId(streamClientDraft.trim());
  };

  const clearLocalLogs = () => {
    lastClearMsRef.current = Date.now();
    setRows([]);
  };

  return (
    <div className="log-viewer">
      <header className="log-viewer__header">
        <div>
          <h1 className="log-viewer__title">Logview</h1>
          <p className="log-viewer__subtitle">
            Ephemeral ingest via{" "}
            <code className="log-viewer__code">POST /api/ingest</code> or{" "}
            <code className="log-viewer__code">GET /api/ingest</code>. Live tail
            over SSE.
          </p>
        </div>
        <div
          className="log-viewer__status"
          data-state={sseStatus}
          aria-live="polite"
        >
          {sseStatus === "open" && <span>Stream connected</span>}
          {sseStatus === "connecting" && <span>Connecting…</span>}
          {sseStatus === "error" && (
            <span>Stream disconnected — refresh the page</span>
          )}
        </div>
      </header>

      <div className="log-viewer__toolbar">
        <div className="log-viewer__field log-viewer__field--row log-viewer__filter-row">
          <label className="log-viewer__field log-viewer__field--grow">
            <span className="log-viewer__label">Filter (client-side)</span>
            <input
              className="log-viewer__input"
              type="search"
              placeholder="Filter visible rows as you type…"
              value={textFilter}
              onChange={(e) => setTextFilter(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button
            type="button"
            className="log-viewer__button log-viewer__button--secondary"
            onClick={clearLocalLogs}
            disabled={rows.length === 0}
            title="Clear rows in this tab only (does not affect the server buffer)"
          >
            Clear local logs
          </button>
        </div>
        <div className="log-viewer__field log-viewer__field--row">
          <label className="log-viewer__field log-viewer__field--grow">
            <span className="log-viewer__label">
              Stream: client ID (server-side)
            </span>
            <input
              className="log-viewer__input"
              type="text"
              placeholder="Empty = all clients"
              value={streamClientDraft}
              onChange={(e) => setStreamClientDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyStreamFilter();
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button
            type="button"
            className="log-viewer__button"
            onClick={applyStreamFilter}
          >
            Apply
          </button>
        </div>
      </div>

      <div className="log-viewer__table-wrap" role="region" aria-label="Log lines">
        <table className="log-viewer__table">
          <thead>
            <tr>
              <th scope="col" className="log-viewer__col-time">
                Time
              </th>
              <th scope="col" className="log-viewer__col-level">
                Level
              </th>
              <th scope="col" className="log-viewer__col-client">
                Client
              </th>
              <th scope="col">Message</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="log-viewer__empty">
                  {rows.length === 0
                    ? "Waiting for logs…"
                    : `No rows match “${textFilter}”.`}
                </td>
              </tr>
            ) : (
              filtered.map((entry) => (
                <tr
                  key={entry.id}
                  className="log-viewer__row"
                  data-level={String(entry.level).toLowerCase()}
                >
                  <td className="log-viewer__mono log-viewer__col-time">
                    {formatTime(entry.ts)}
                  </td>
                  <td className="log-viewer__level">{entry.level}</td>
                  <td className="log-viewer__mono log-viewer__col-client">
                    {entry.clientId ?? "—"}
                  </td>
                  <td
                    className="log-viewer__message log-viewer__mono"
                    dangerouslySetInnerHTML={{
                      __html: ansiUp.ansi_to_html(entry.message),
                    }}
                  />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
