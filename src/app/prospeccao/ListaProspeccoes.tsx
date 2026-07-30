"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type Item = {
  id: string;
  nome_imobiliaria: string;
  cnpj_imobiliaria: string | null;
  criado_por_email: string | null;
  created_at: string;
};

export default function ListaProspeccoes({ relatorios }: { relatorios: Item[] }) {
  const [busca, setBusca] = useState("");

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return relatorios;
    return relatorios.filter((r) =>
      `${r.nome_imobiliaria} ${r.cnpj_imobiliaria ?? ""}`.toLowerCase().includes(termo)
    );
  }, [relatorios, busca]);

  return (
    <div className="space-y-3">
      {relatorios.length > 3 && (
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome ou CNPJ..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none"
        />
      )}

      {filtrados.map((r) => (
        <Link
          key={r.id}
          href={`/prospeccao/${r.id}`}
          className="block rounded-xl border border-o2-navy/10 bg-white p-3 transition hover:shadow-md"
        >
          <p className="font-medium text-o2-navy">{r.nome_imobiliaria}</p>
          <p className="text-xs text-gray-500">
            {r.cnpj_imobiliaria && <>{r.cnpj_imobiliaria} · </>}
            preparado em {new Date(r.created_at).toLocaleString("pt-BR")}
            {r.criado_por_email && <> por {r.criado_por_email}</>}
          </p>
        </Link>
      ))}

      {!filtrados.length && relatorios.length > 0 && (
        <p className="text-sm text-gray-500">Nenhum relatório encontrado para essa busca.</p>
      )}
      {!relatorios.length && <p className="text-sm text-gray-500">Nenhum relatório preparado ainda.</p>}
    </div>
  );
}
