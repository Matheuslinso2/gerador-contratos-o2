import { redirect } from "next/navigation";

// A aba "Imobiliária 360" é a própria /producao (21/10/2026): este endereço
// antigo só redireciona, mantendo imobiliária/grupo e período.
export default async function Imobiliaria360Antiga({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
  redirect(`/producao${q.size ? `?${q.toString()}` : ""}`);
}
