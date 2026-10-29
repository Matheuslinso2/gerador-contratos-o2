"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Menu lateral de Baixas: a conferência do mês (tela atual) e a gestão das baixas por extrato/seguradora.
const ITENS = [
  { href: "/erp/baixas", rotulo: "Conferência do mês", sub: "quadros, gráfico e detalhe", exato: true },
  { href: "/erp/baixas/gestao", rotulo: "Gestão das baixas", sub: "extratos por seguradora e empresa", exato: false },
];

export default function BaixasLateral() {
  const caminho = usePathname();
  return (
    <nav className="flex gap-2 lg:w-48 lg:flex-none lg:flex-col print:hidden" aria-label="Baixas">
      {ITENS.map((i) => {
        const ativo = i.exato ? caminho === i.href : caminho.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            className={`rounded-lg border px-3 py-2 text-sm ${ativo ? "border-o2-navy bg-o2-navy text-white" : "border-gray-200 bg-white text-gray-700 hover:border-o2-navy/40"}`}
          >
            <span className="block font-semibold">{i.rotulo}</span>
            <span className={`block text-[11px] ${ativo ? "text-white/70" : "text-gray-500"}`}>{i.sub}</span>
          </Link>
        );
      })}
    </nav>
  );
}
