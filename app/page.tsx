import { LogViewer } from "@/components/LogViewer";
import { parseChartWindowParam } from "@/lib/logviewPrefs";
import { Suspense } from "react";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const raw =
    typeof sp.clientId === "string"
      ? sp.clientId
      : typeof sp.client === "string"
        ? sp.client
        : "";
  const initialStreamClientId = raw;
  const initialFilter =
    typeof sp.q === "string"
      ? sp.q
      : typeof sp.filter === "string"
        ? sp.filter
        : "";
  const chartRaw =
    typeof sp.chart === "string" ? sp.chart : undefined;
  const initialChartWindowFromUrl = parseChartWindowParam(chartRaw);

  return (
    <main className="main">
      <Suspense fallback={<div className="log-viewer-suspense">Loading…</div>}>
        <LogViewer
          initialStreamClientId={initialStreamClientId}
          initialFilter={initialFilter}
          initialChartWindowFromUrl={initialChartWindowFromUrl}
        />
      </Suspense>
    </main>
  );
}
