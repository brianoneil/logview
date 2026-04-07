"use client";

import type { LogEntry } from "@/lib/types";
import {
  LogLevelChart,
  type LogLevelChartHandle,
} from "@/components/LogLevelChart";
import { LogRowCopyButton } from "@/components/LogRowCopyButton";
import { LogMessageCell } from "@/components/LogMessageCell";
import {
  DEFAULT_CHART_WINDOW_SECONDS,
  LOGVIEW_STORAGE,
  resolveChartWindowSeconds,
  type ChartWindowSeconds,
} from "@/lib/logviewPrefs";
import { AnsiUp } from "ansi_up";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** ScrollTop at or below this counts as “following” the newest lines (top of the list). */
const SCROLL_TOP_THRESHOLD_PX = 8;

function isFollowingTail(el: HTMLDivElement | null) {
  if (!el) return true;
  return el.scrollTop <= SCROLL_TOP_THRESHOLD_PX;
}

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
  /** From `?q=` — client-side row filter. */
  initialFilter?: string;
  /** From `?chart=` when present; otherwise storage may hydrate on mount. */
  initialChartWindowFromUrl?: ChartWindowSeconds;
}

export function LogViewer({
  initialStreamClientId = "",
  initialFilter = "",
  initialChartWindowFromUrl,
}: LogViewerProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const ansiUp = useMemo(() => new AnsiUp(), []);
  const [rows, setRows] = useState<LogEntry[]>([]);
  const [textFilter, setTextFilter] = useState(initialFilter);
  const [streamClientDraft, setStreamClientDraft] = useState(
    initialStreamClientId,
  );
  const [appliedStreamClientId, setAppliedStreamClientId] = useState(
    initialStreamClientId,
  );
  const [chartWindowSeconds, setChartWindowSeconds] =
    useState<ChartWindowSeconds>(
      () => initialChartWindowFromUrl ?? DEFAULT_CHART_WINDOW_SECONDS,
    );
  /** After localStorage hydration so URL writes do not race initial restore. */
  const [prefsHydrated, setPrefsHydrated] = useState(false);
  const [sseStatus, setSseStatus] = useState<"connecting" | "open" | "error">(
    "connecting",
  );
  const [newWhileScrolledCount, setNewWhileScrolledCount] = useState(0);
  /**
   * Source of truth for SSE (sync); state alone can lag behind appendEntries.
   * When there is no overflow, scrollTop stays 0 — we still need explicit paused/live.
   */
  const tailModeRef = useRef<"live" | "paused">("live");
  const [tailMode, setTailMode] = useState<"live" | "paused">("live");
  /** When true, next layout after prepend should pin scroll to newest (top). */
  const pinToTopAfterPrependRef = useRef(false);
  /** Lines in the prepend batch when pin was requested (for race recovery). */
  const pendingPinEntryCountRef = useRef(0);
  /**
   * Captured before prepend when paused: restore scroll so prepended rows don't shift the viewport.
   */
  const scrollSnapRef = useRef<{
    scrollTop: number;
    scrollHeight: number;
  } | null>(null);
  /** Captured before prepend when live (for race: user scrolls away before paint). */
  const livePrependSnapRef = useRef<{
    scrollTop: number;
    scrollHeight: number;
  } | null>(null);
  /**
   * Pause was clicked while the list did not overflow; scrollTop stays 0 so we must not
   * treat scrollTop ≤ threshold as "resume live" until Jump or user scrolls away and back.
   */
  const explicitPausedNoOverflowRef = useRef(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const levelChartRef = useRef<LogLevelChartHandle | null>(null);

  const replaceQuery = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const p = new URLSearchParams(
        typeof window !== "undefined"
          ? window.location.search
          : searchParams.toString(),
      );
      mutate(p);
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  /** Restore from localStorage when the URL does not specify a value (URL wins on first paint from SSR). */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (!sp.has("q")) {
      const s = localStorage.getItem(LOGVIEW_STORAGE.filter);
      if (s != null) setTextFilter(s);
    }
    const hasClient = sp.has("clientId") || sp.has("client");
    if (!hasClient) {
      const d = localStorage.getItem(LOGVIEW_STORAGE.clientDraft);
      const a = localStorage.getItem(LOGVIEW_STORAGE.appliedClient);
      if (d != null) setStreamClientDraft(d);
      if (a != null) setAppliedStreamClientId(a);
    }
    if (!sp.has("chart")) {
      const w = resolveChartWindowSeconds(
        undefined,
        localStorage.getItem(LOGVIEW_STORAGE.chartWindowSec),
      );
      setChartWindowSeconds(w);
    }
    setPrefsHydrated(true);
  }, []);

  useEffect(() => {
    if (!prefsHydrated) return;
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(LOGVIEW_STORAGE.filter, textFilter);
      } catch {
        /* ignore quota / private mode */
      }
      replaceQuery((p) => {
        if (textFilter.trim() === "") p.delete("q");
        else p.set("q", textFilter);
      });
    }, 350);
    return () => window.clearTimeout(t);
  }, [textFilter, prefsHydrated, replaceQuery]);

  useEffect(() => {
    if (!prefsHydrated) return;
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(LOGVIEW_STORAGE.clientDraft, streamClientDraft);
      } catch {
        /* ignore */
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [streamClientDraft, prefsHydrated]);

  const onChartWindowChange = useCallback(
    (sec: number) => {
      const s = sec as ChartWindowSeconds;
      setChartWindowSeconds(s);
      try {
        localStorage.setItem(LOGVIEW_STORAGE.chartWindowSec, String(s));
      } catch {
        /* ignore */
      }
      replaceQuery((p) => {
        if (s === DEFAULT_CHART_WINDOW_SECONDS) p.delete("chart");
        else p.set("chart", String(s));
      });
    },
    [replaceQuery],
  );

  /** After storage hydrate, mirror applied client / non-default chart into the URL for shareable links. */
  useEffect(() => {
    if (!prefsHydrated || typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    let changed = false;
    const hasClient = p.has("clientId") || p.has("client");
    const cid = appliedStreamClientId.trim();
    if (!hasClient && cid !== "") {
      p.set("clientId", cid);
      changed = true;
    }
    if (!p.has("chart") && chartWindowSeconds !== DEFAULT_CHART_WINDOW_SECONDS) {
      p.set("chart", String(chartWindowSeconds));
      changed = true;
    }
    if (changed) {
      router.replace(
        `${pathname}?${p.toString()}`,
        { scroll: false },
      );
    }
  }, [
    prefsHydrated,
    appliedStreamClientId,
    chartWindowSeconds,
    pathname,
    router,
  ]);

  const setTailModeBoth = useCallback((next: "live" | "paused") => {
    tailModeRef.current = next;
    setTailMode(next);
  }, []);

  const appendEntries = useCallback((entries: LogEntry[]) => {
    if (entries.length === 0) return;
    const el = scrollRef.current;
    const snapBefore =
      el !== null
        ? { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight }
        : null;

    const following = tailModeRef.current === "live";

    if (following) {
      pinToTopAfterPrependRef.current = true;
      pendingPinEntryCountRef.current = entries.length;
      livePrependSnapRef.current = snapBefore;
      scrollSnapRef.current = null;
    } else {
      pinToTopAfterPrependRef.current = false;
      pendingPinEntryCountRef.current = 0;
      livePrependSnapRef.current = null;
      scrollSnapRef.current = snapBefore;
      setNewWhileScrolledCount((c) => c + entries.length);
    }

    setRows((prev) => [...entries, ...prev].slice(0, 5_000));

    for (const entry of entries) {
      levelChartRef.current?.record(entry);
    }
  }, []);

  // After row changes: pin to newest when live, or preserve scroll position when paused.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    if (rows.length === 0) {
      scrollSnapRef.current = null;
      livePrependSnapRef.current = null;
      pinToTopAfterPrependRef.current = false;
      pendingPinEntryCountRef.current = 0;
      return;
    }

    if (pinToTopAfterPrependRef.current) {
      // User may have scrolled away before paint; do not yank them back to top.
      if (!isFollowingTail(el)) {
        const n = pendingPinEntryCountRef.current;
        pinToTopAfterPrependRef.current = false;
        pendingPinEntryCountRef.current = 0;
        const snap = livePrependSnapRef.current;
        livePrependSnapRef.current = null;
        if (snap) {
          const delta = el.scrollHeight - snap.scrollHeight;
          el.scrollTop = snap.scrollTop + delta;
        }
        setTailModeBoth("paused");
        if (n > 0) {
          setNewWhileScrolledCount((c) => c + n);
        }
        return;
      }
      el.scrollTop = 0;
      pinToTopAfterPrependRef.current = false;
      pendingPinEntryCountRef.current = 0;
      livePrependSnapRef.current = null;
      setTailModeBoth("live");
      return;
    }

    const snap = scrollSnapRef.current;
    if (snap) {
      const delta = el.scrollHeight - snap.scrollHeight;
      el.scrollTop = snap.scrollTop + delta;
      scrollSnapRef.current = null;
    }
  }, [rows, setTailModeBoth]);

  useEffect(() => {
    setRows([]);
    setNewWhileScrolledCount(0);
    queueMicrotask(() => {
      const el = scrollRef.current;
      if (el) {
        el.scrollTo({ top: 0 });
        explicitPausedNoOverflowRef.current = false;
        setTailModeBoth("live");
      }
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
  }, [appliedStreamClientId, appendEntries, setTailModeBoth]);

  const onScrollAreaScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop > SCROLL_TOP_THRESHOLD_PX) {
      explicitPausedNoOverflowRef.current = false;
      setTailModeBoth("paused");
    } else {
      if (explicitPausedNoOverflowRef.current) return;
      setTailModeBoth("live");
      setNewWhileScrolledCount(0);
    }
  }, [setTailModeBoth]);

  /** Programmatic “pause”: leave the follow zone when possible; otherwise explicit paused mode. */
  const pauseFollowing = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const canScroll = el.scrollHeight > el.clientHeight + 1;
    if (canScroll) {
      explicitPausedNoOverflowRef.current = false;
      el.scrollTop = SCROLL_TOP_THRESHOLD_PX + 1;
    } else {
      explicitPausedNoOverflowRef.current = true;
    }
    setTailModeBoth("paused");
  }, [setTailModeBoth]);

  const scrollToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    explicitPausedNoOverflowRef.current = false;
    el.scrollTo({ top: 0 });
    setTailModeBoth("live");
    setNewWhileScrolledCount(0);
  }, [setTailModeBoth]);

  const filtered = useMemo(
    () => rows.filter((r) => rowMatchesFilter(r, textFilter)),
    [rows, textFilter],
  );

  const applyStreamFilter = useCallback(() => {
    const next = streamClientDraft.trim();
    setAppliedStreamClientId(next);
    try {
      localStorage.setItem(LOGVIEW_STORAGE.clientDraft, streamClientDraft);
      localStorage.setItem(LOGVIEW_STORAGE.appliedClient, next);
    } catch {
      /* ignore */
    }
    replaceQuery((p) => {
      p.delete("client");
      if (next === "") p.delete("clientId");
      else p.set("clientId", next);
    });
  }, [streamClientDraft, replaceQuery]);

  const clearLocalLogs = () => {
    setRows([]);
    setNewWhileScrolledCount(0);
    queueMicrotask(() => {
      const el = scrollRef.current;
      if (el) {
        el.scrollTop = 0;
        explicitPausedNoOverflowRef.current = false;
        setTailModeBoth("live");
      }
    });
  };

  const filterActive = textFilter.trim() !== "";

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* still leave */
    }
    window.location.href = "/login";
  }, []);

  return (
    <div className="log-viewer" suppressHydrationWarning>
      {/* Password-manager extensions (e.g. Proton Pass) may inject attributes on form-like regions before hydration. */}
      <header className="log-viewer__top" suppressHydrationWarning>
        <div className="log-viewer__controls-left">
          <div className="log-viewer__brand-row">
            <h1 className="log-viewer__title">Logview</h1>
            <p className="log-viewer__subtitle">
              <Link href="/usage" className="log-viewer__doc-link">
                Ingest API — POST &amp; GET
              </Link>
              <span> · Ephemeral live tail over SSE.</span>
            </p>
            <button
              type="button"
              className="log-viewer__sign-out"
              onClick={signOut}
              title="End session and return to sign-in"
            >
              Sign out
            </button>
          </div>
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
        <div className="log-viewer__header-right">
          <div className="log-viewer__header-right-chart-row">
            <div className="log-viewer__header-stream">
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
              <div className="log-viewer__tail" aria-live="polite">
                <span
                  className="log-viewer__tail-mode"
                  data-mode={tailMode}
                  aria-label={
                    tailMode === "live"
                      ? "Live tail, following newest logs"
                      : "Live tail off, paused"
                  }
                  title={
                    tailMode === "live"
                      ? "Following newest logs"
                      : "Paused — not following newest"
                  }
                >
                  ● Live
                </span>
                {tailMode === "live" ? (
                  <button
                    type="button"
                    className="log-viewer__tail-icon-btn"
                    onClick={pauseFollowing}
                    title="Pause — stop following new lines (same as scrolling down)"
                    aria-label="Pause live tail"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="currentColor"
                      aria-hidden
                    >
                      <rect x="2" y="1" width="3.5" height="12" rx="1" />
                      <rect x="8.5" y="1" width="3.5" height="12" rx="1" />
                    </svg>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="log-viewer__tail-icon-btn"
                    onClick={scrollToLatest}
                    title="Resume live tail — scroll to newest"
                    aria-label="Resume live tail"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 14 14"
                      fill="currentColor"
                      aria-hidden
                    >
                      <path d="M3 2.5 L12 7 L3 11.5 Z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            <LogLevelChart
              ref={levelChartRef}
              defaultWindowSeconds={DEFAULT_CHART_WINDOW_SECONDS}
              windowSeconds={chartWindowSeconds}
              onWindowSecondsChange={onChartWindowChange}
            />
          </div>
          <div className="log-viewer__header-count-wrap">
            <span
              className="log-viewer__count-pill"
              aria-live="polite"
              aria-label={
                filterActive
                  ? `${filtered.length.toLocaleString()} visible of ${rows.length.toLocaleString()} buffered lines`
                  : `${rows.length.toLocaleString()} buffered lines`
              }
            >
              {filterActive ? (
                <>
                  <span className="log-viewer__count-pill__num">
                    {filtered.length.toLocaleString()}
                  </span>
                  <span className="log-viewer__count-pill__sep" aria-hidden>
                    ·
                  </span>
                  <span className="log-viewer__count-pill__num log-viewer__count-pill__num--muted">
                    {rows.length.toLocaleString()}
                  </span>
                </>
              ) : (
                <span className="log-viewer__count-pill__num">
                  {rows.length.toLocaleString()}
                </span>
              )}
            </span>
          </div>
        </div>
      </header>

      <div className="log-viewer__table-outer">
        <div
          ref={scrollRef}
          className="log-viewer__table-wrap"
          role="region"
          aria-label="Log lines"
          onScroll={onScrollAreaScroll}
        >
          {tailMode === "paused" && newWhileScrolledCount > 0 ? (
            <div className="log-viewer__new-float" aria-live="polite">
              <button
                type="button"
                className="log-viewer__new-pill"
                onClick={scrollToLatest}
                title="Go to newest messages and resume live tail"
                aria-label={`${newWhileScrolledCount.toLocaleString()} new messages, go to newest`}
              >
                <span className="log-viewer__new-pill__arrow" aria-hidden>
                  ↑
                </span>
                <span className="log-viewer__new-pill__count">
                  {newWhileScrolledCount.toLocaleString()}
                </span>
                <span className="log-viewer__new-pill__label">New messages</span>
              </button>
            </div>
          ) : null}
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
                    <span className="log-viewer__time-cell">
                      <span className="log-viewer__time-text">
                        {formatTime(entry.ts)}
                      </span>
                      <span className="log-viewer__copy-floating">
                        <LogRowCopyButton entry={entry} />
                      </span>
                    </span>
                  </td>
                  <td className="log-viewer__level">{entry.level}</td>
                  <td className="log-viewer__mono log-viewer__col-client">
                    {entry.clientId ?? "—"}
                  </td>
                  <LogMessageCell
                    message={entry.message}
                    ansiUp={ansiUp}
                  />
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
