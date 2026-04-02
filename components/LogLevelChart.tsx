"use client";

import { DEFAULT_CHART_WINDOW_SECONDS } from "@/lib/logviewPrefs";
import type { LogEntry } from "@/lib/types";
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const LEVEL_KEYS = ["error", "warn", "info", "debug", "other"] as const;
export type LevelChartKey = (typeof LEVEL_KEYS)[number];

const LEVEL_LABEL: Record<LevelChartKey, string> = {
  error: "error",
  warn: "warn",
  info: "info",
  debug: "debug",
  other: "other",
};

const LEVEL_COLORS: Record<LevelChartKey, string> = {
  error: "#ff8a8a",
  warn: "#e8d07a",
  info: "#8ccfff",
  debug: "#9aa3b8",
  other: "#b898e6",
};

/** Map ingest level strings to chart buckets (unknown → other). */
export function normalizeLogLevelKey(level: string): LevelChartKey {
  const x = String(level).trim().toLowerCase();
  if (
    x === "error" ||
    x === "warn" ||
    x === "info" ||
    x === "debug"
  ) {
    return x;
  }
  return "other";
}

export type LogLevelChartHandle = {
  record: (entry: LogEntry) => void;
};

type LogLevelChartProps = {
  /** Default rolling window in seconds (each second is one bucket). */
  defaultWindowSeconds?: number;
  /** When set, window length is controlled by the parent (e.g. persisted prefs). */
  windowSeconds?: number;
  onWindowSecondsChange?: (seconds: number) => void;
};

const W = 220;
const H = 72;
const PAD = { l: 4, r: 4, t: 6, b: 18 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;

/**
 * One bucket per whole calendar second (newest second = rightmost).
 * Counts stay stable until the second rolls over — avoids “dancing” from sliding window math.
 */
function buildBucketsByWholeSeconds(
  events: readonly { ts: number; level: LevelChartKey }[],
  now: number,
  bucketCount: number,
): { buckets: number[][]; totals: number[]; maxCount: number } {
  const currentSecond = Math.floor(now / 1000);
  const oldestSecond = currentSecond - (bucketCount - 1);
  const buckets: number[][] = Array.from({ length: bucketCount }, () =>
    LEVEL_KEYS.map(() => 0),
  );

  for (const e of events) {
    const es = Math.floor(e.ts / 1000);
    if (es < oldestSecond || es > currentSecond) continue;
    const idx = es - oldestSecond;
    if (idx < 0 || idx >= bucketCount) continue;
    const li = LEVEL_KEYS.indexOf(e.level);
    const k = li >= 0 ? li : LEVEL_KEYS.length - 1;
    buckets[idx][k] += 1;
  }

  const totals = LEVEL_KEYS.map((_, ki) =>
    buckets.reduce((s, row) => s + row[ki], 0),
  );
  let maxCount = 1;
  for (const row of buckets) {
    for (const c of row) {
      if (c > maxCount) maxCount = c;
    }
  }

  return { buckets, totals, maxCount };
}

const DEFAULT_VISIBLE: Record<LevelChartKey, boolean> = {
  error: true,
  warn: true,
  info: true,
  debug: true,
  other: true,
};

export const LogLevelChart = forwardRef<LogLevelChartHandle, LogLevelChartProps>(
  function LogLevelChart(
    {
      defaultWindowSeconds = DEFAULT_CHART_WINDOW_SECONDS,
      windowSeconds: controlledWindow,
      onWindowSecondsChange,
    },
    ref,
  ) {
    const [internalWindow, setInternalWindow] = useState(defaultWindowSeconds);
    const windowSeconds =
      controlledWindow !== undefined ? controlledWindow : internalWindow;
    const bucketCount = windowSeconds;
    const [levelVisible, setLevelVisible] =
      useState<Record<LevelChartKey, boolean>>(DEFAULT_VISIBLE);

    const eventsRef = useRef<{ ts: number; level: LevelChartKey }[]>([]);
    /** Bumps when new logs arrive or the wall-clock second changes (bucket boundaries). */
    const [dataVersion, setDataVersion] = useState(0);
    const lastAlignedSecondRef = useRef(Math.floor(Date.now() / 1000));
    /** Newest calendar second represented by the last committed SVG paths (rightmost bucket). */
    const pathDataSecondRef = useRef(Math.floor(Date.now() / 1000));

    const bumpData = useCallback(() => {
      setDataVersion((v) => v + 1);
    }, []);

    const toggleLevel = useCallback((key: LevelChartKey) => {
      setLevelVisible((prev) => ({ ...prev, [key]: !prev[key] }));
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        record(entry: LogEntry) {
          const level = normalizeLogLevelKey(entry.level);
          eventsRef.current.push({ ts: Date.now(), level });
          const oldest =
            Math.floor(Date.now() / 1000) - windowSeconds - 2;
          eventsRef.current = eventsRef.current.filter(
            (e) => Math.floor(e.ts / 1000) >= oldest,
          );
          bumpData();
        },
      }),
      [bumpData, windowSeconds],
    );

    // Re-aggregate only when the calendar second changes (bucket roll), not every frame.
    useEffect(() => {
      const id = window.setInterval(() => {
        const s = Math.floor(Date.now() / 1000);
        if (s !== lastAlignedSecondRef.current) {
          lastAlignedSecondRef.current = s;
          bumpData();
        }
      }, 250);
      return () => window.clearInterval(id);
    }, [bumpData]);

    const clipPathId = useId().replace(/:/g, "_");
    const seriesGroupRef = useRef<SVGGElement | null>(null);

    const cellW =
      bucketCount <= 1 ? PLOT_W : PLOT_W / (bucketCount - 1);

    /**
     * When the clock enters a new second, `now % 1000` snaps to ~0. If React has not yet
     * committed paths for that second, applying that translate with OLD paths jumps right.
     * While paths are stale, keep translate at -cellW (same as end of previous second).
     */
    const applyStripTransform = useCallback(
      (now: number) => {
        const g = seriesGroupRef.current;
        if (!g) return;
        const currentSecond = Math.floor(now / 1000);
        if (currentSecond > pathDataSecondRef.current) {
          g.setAttribute("transform", `translate(${(-cellW).toFixed(2)},0)`);
          return;
        }
        const t = (now % 1000) / 1000;
        g.setAttribute(
          "transform",
          `translate(${(-t * cellW).toFixed(2)},0)`,
        );
      },
      [cellW],
    );

    // After paths commit, the newest bucket matches `floor(now/1000)`; sync ref + transform.
    useLayoutEffect(() => {
      const now = Date.now();
      pathDataSecondRef.current = Math.floor(now / 1000);
      applyStripTransform(now);
    }, [dataVersion, bucketCount, applyStripTransform]);

    // Smooth sub-second drift between React commits (no state per frame).
    useEffect(() => {
      let rafId = 0;
      let stopped = false;
      const tick = () => {
        if (stopped) return;
        applyStripTransform(Date.now());
        rafId = window.requestAnimationFrame(tick);
      };
      rafId = window.requestAnimationFrame(tick);
      return () => {
        stopped = true;
        window.cancelAnimationFrame(rafId);
      };
    }, [applyStripTransform]);

    const { polylines } = useMemo(() => {
      const now = Date.now();
      const events = eventsRef.current;
      const { buckets } = buildBucketsByWholeSeconds(
        events,
        now,
        bucketCount,
      );

      let mc = 1;
      for (const row of buckets) {
        for (let li = 0; li < LEVEL_KEYS.length; li++) {
          if (!levelVisible[LEVEL_KEYS[li]]) continue;
          const c = row[li];
          if (c > mc) mc = c;
        }
      }

      const polylines: { key: LevelChartKey; d: string; color: string }[] = [];
      const n = bucketCount;
      const xAt = (i: number) =>
        n <= 1
          ? PAD.l + PLOT_W / 2
          : PAD.l + (i / (n - 1)) * PLOT_W;

      for (let li = 0; li < LEVEL_KEYS.length; li++) {
        const key = LEVEL_KEYS[li];
        const parts: string[] = [];
        for (let i = 0; i < n; i++) {
          const c = buckets[i][li];
          const x = xAt(i);
          const y = PAD.t + PLOT_H - (c / mc) * PLOT_H;
          parts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
        }
        polylines.push({
          key,
          d: parts.join(" "),
          color: LEVEL_COLORS[key],
        });
      }

      return { polylines };
      // dataVersion: new logs or new calendar second; eventsRef is mutated in record()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dataVersion, bucketCount, levelVisible]);

    return (
      <div className="log-level-chart" aria-label="Log levels over time">
        <div className="log-level-chart__head">
          <span className="log-level-chart__title">Levels</span>
          <label className="log-level-chart__window">
            <span className="visually-hidden">Window length</span>
            <select
              value={windowSeconds}
              onChange={(e) => {
                const v = Number.parseInt(e.target.value, 10);
                onWindowSecondsChange?.(v);
                if (controlledWindow === undefined) setInternalWindow(v);
                bumpData();
              }}
              title="Rolling window for the chart"
            >
              <option value={5}>5s</option>
              <option value={10}>10s</option>
              <option value={15}>15s</option>
              <option value={30}>30s</option>
            </select>
          </label>
        </div>
        <svg
          className="log-level-chart__svg"
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          role="img"
          aria-hidden
        >
          <defs>
            <clipPath id={clipPathId}>
              <rect x={PAD.l} y={PAD.t} width={PLOT_W} height={PLOT_H} />
            </clipPath>
          </defs>
          <rect
            x={PAD.l}
            y={PAD.t}
            width={PLOT_W}
            height={PLOT_H}
            fill="rgba(255,255,255,0.03)"
            rx={4}
          />
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <line
              key={t}
              x1={PAD.l}
              x2={PAD.l + PLOT_W}
              y1={PAD.t + t * PLOT_H}
              y2={PAD.t + t * PLOT_H}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
            />
          ))}
          <g clipPath={`url(#${clipPathId})`}>
            <g ref={seriesGroupRef}>
              {polylines.map(({ key, d, color }) => (
                <path
                  key={key}
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.6}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={levelVisible[key] ? 0.92 : 0}
                  pointerEvents="none"
                />
              ))}
            </g>
          </g>
        </svg>
        <div
          className="log-level-chart__legend"
          role="group"
          aria-label="Toggle series visibility"
        >
          {LEVEL_KEYS.map((k) => {
            const on = levelVisible[k];
            return (
              <button
                key={k}
                type="button"
                className="log-level-chart__legend-toggle"
                data-on={on ? "true" : "false"}
                onClick={() => toggleLevel(k)}
                aria-pressed={on}
                aria-label={
                  on
                    ? `Hide ${LEVEL_LABEL[k]} series`
                    : `Show ${LEVEL_LABEL[k]} series`
                }
              >
                <span
                  className="log-level-chart__swatch"
                  style={{ background: LEVEL_COLORS[k] }}
                  aria-hidden
                />
                <span className="log-level-chart__legend-label">
                  {LEVEL_LABEL[k]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="log-level-chart__hint log-level-chart__hint--muted">
          Last {bucketCount}s · receive time · click a level to show or hide its line
        </div>
      </div>
    );
  },
);
