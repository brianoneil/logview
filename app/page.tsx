import { LogViewer } from "@/components/LogViewer";

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

  return (
    <main className="main">
      <LogViewer initialStreamClientId={initialStreamClientId} />
    </main>
  );
}
