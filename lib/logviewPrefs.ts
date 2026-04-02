/** localStorage keys — versioned namespace */
export const LOGVIEW_STORAGE = {
  filter: "logview.v1.filter",
  clientDraft: "logview.v1.clientDraft",
  appliedClient: "logview.v1.appliedClient",
  chartWindowSec: "logview.v1.chartWindowSec",
} as const;

/** Allowed level-chart rolling windows (must match LogLevelChart options). */
export const CHART_WINDOW_OPTIONS = [5, 10, 15, 30] as const;
export type ChartWindowSeconds = (typeof CHART_WINDOW_OPTIONS)[number];

/** Default rolling window for the level chart (URL/storage omit `chart` when set to this). */
export const DEFAULT_CHART_WINDOW_SECONDS: ChartWindowSeconds = 30;

export function parseChartWindowParam(
  raw: string | undefined,
): ChartWindowSeconds | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return undefined;
  return (CHART_WINDOW_OPTIONS as readonly number[]).includes(n)
    ? (n as ChartWindowSeconds)
    : undefined;
}

export function resolveChartWindowSeconds(
  fromUrl: ChartWindowSeconds | undefined,
  fromStorage: string | null,
): ChartWindowSeconds {
  if (fromUrl !== undefined) return fromUrl;
  const n = fromStorage != null ? Number.parseInt(fromStorage, 10) : NaN;
  if (
    Number.isFinite(n) &&
    (CHART_WINDOW_OPTIONS as readonly number[]).includes(n)
  ) {
    return n as ChartWindowSeconds;
  }
  return DEFAULT_CHART_WINDOW_SECONDS;
}
