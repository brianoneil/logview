"use client";

import type { LogEntry } from "@/lib/types";
import { AnsiUp } from "ansi_up";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const SCROLL_TOP_THRESHOLD_PX = 8;

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
  const [newWhileScrolledCount, setNewWhileScrolledCount] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** Captured synchronously before each prepend so useLayoutEffect can fix scroll. */
  const scrollSnapRef = useRef<{
    atTop: boolean;
    scrollTop: number;
    scrollHeight: number;
  } | null>(null);

  const appendEntries = useCallback((entries: LogEntry[]) => {
    if (entries.length === 0) return;
    const el = scrollRef.current;
    if (el) {
      const atTop = el.scrollTop <= SCROLL_TOP_THRESHOLD_PX;
      scrollSnapRef.current = {
        atTop,
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
      };
      if (!atTop) {
        setNewWhileScrolledCount((c) => c + entries.length);
      }
    } else {
      scrollSnapRef.current = null;
    }
    setRows((prev) => [...entries, ...prev].slice(0, 5_000));
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const snap = scrollSnapRef.current;
    if (!el || !snap) return;
    if (snap.atTop) {
      el.scrollTop = 0;
    } else {
      const delta = el.scrollHeight - snap.scrollHeight;
      el.scrollTop = snap.scrollTop + delta;
    }
    scrollSnapRef.current = null;
  }, [rows]);

  useEffect(() => {
    setRows([]);
    setNewWhileScrolledCount(0);
    queueMicrotask(() => {
      scrollRef.current?.scrollTo({ top: 0 });
    });

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

  const onScrollAreaScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop <= SCROLL_TOP_THRESHOLD_PX) {
      setNewWhileScrolledCount(0);
    }
  }, []);

  const scrollToLatest = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    setNewWhileScrolledCount(0);
  }, []);

  const filtered = useMemo(
    () => rows.filter((r) => rowMatchesFilter(r, textFilter)),
    [rows, textFilter],
  );

  const applyStreamFilter = () => {
    setAppliedStreamClientId(streamClientDraft.trim());
  };

  const clearLocalLogs = () => {
    setRows([]);
    setNewWhileScrolledCount(0);
    queueMicrotask(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = 0;
    });
  };

  const filterActive = textFilter.trim() !== "";
  const countLabel = filterActive
    ? `${filtered.length.toLocaleString()} visible · ${rows.length.toLocaleString()} total`
    : `${rows.length.toLocaleString()} rows`;

  return (
    <div className="log-viewer">
      <header className="log-viewer__header">
        <div>
          <div className="log-viewer__title-row">
            <h1 className="log-viewer__title">Logview</h1>
            <span className="log-viewer__count" aria-live="polite">
              {countLabel}
            </span>
          </div>
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
            title="Clear rows shown in this tab only"
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

      <div className="log-viewer__table-outer">
        <div
          ref={scrollRef}
          className="log-viewer__table-wrap"
          role="region"
          aria-label="Log lines"
          onScroll={onScrollAreaScroll}
        >
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
        {newWhileScrolledCount > 0 && (
          <div className="log-viewer__new-pill-wrap">
            <button
              type="button"
              className="log-viewer__new-pill"
              onClick={scrollToLatest}
            >
              New messages
              {newWhileScrolledCount > 1
                ? ` (${newWhileScrolledCount.toLocaleString()})`
                : ""}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
