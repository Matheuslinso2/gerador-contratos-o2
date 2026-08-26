"use client";

import { useRouter } from "next/navigation";

export default function SeletorCompetencia({ competencia }: { competencia: string }) {
  const router = useRouter();

  function aoMudar(valor: string) {
    if (!valor) return;
    router.push(`/painel-comercial?competencia=${valor}`);
  }

  return (
    <input
      type="month"
      value={competencia}
      onChange={(e) => aoMudar(e.target.value)}
      className="rounded-lg border border-white/20 bg-transparent px-3 py-1.5 text-sm text-white focus:border-white/60 focus:outline-none"
    />
  );
}
