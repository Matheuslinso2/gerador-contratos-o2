"use client";

import { useRouter, useSearchParams } from "next/navigation";

export default function SeletorCompetencia({
  competencia,
  basePath = "/faturas",
}: {
  competencia: string;
  /** Pra onde navegar ao trocar o mês -- default é a tela principal de
   * Faturas, mas o fechamento (mesmo campo) precisa ficar na própria
   * URL dele em vez de voltar pra lista. */
  basePath?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function aoMudar(valor: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("competencia", valor);
    router.push(`${basePath}?${params.toString()}`);
  }

  return (
    <input
      type="month"
      value={competencia}
      onChange={(e) => aoMudar(e.target.value)}
      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-o2-coral focus:outline-none"
    />
  );
}
