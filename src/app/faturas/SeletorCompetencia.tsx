"use client";

import { useRouter, useSearchParams } from "next/navigation";

export default function SeletorCompetencia({ competencia }: { competencia: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function aoMudar(valor: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("competencia", valor);
    router.push(`/faturas?${params.toString()}`);
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
