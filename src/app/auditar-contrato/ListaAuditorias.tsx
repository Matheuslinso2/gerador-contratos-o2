"use client";

import { useMemo, useState } from "react";
import RelatorioView from "./RelatorioView";
import type { RelatorioAuditoria } from "@/lib/auditorContrato";

type Auditoria = {
  id: string;
  nome_arquivo: string | null;
  status_geral: string;
  tipo_garantia_identificada: string | null;
  locador_identificado: string | null;
  locatario_identificado: string | null;
  endereco_identificado: string | null;
  relatorio: RelatorioAuditoria;
  created_at: string;
};

export default function ListaAuditorias({
  auditorias,
  destaque,
}: {
  auditorias: Auditoria[];
  destaque?: string;
}) {
  const [busca, setBusca] = useState("");

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return auditorias;
    return auditorias.filter((a) =>
      `${a.nome_arquivo ?? ""} ${a.status_geral} ${a.tipo_garantia_identificada ?? ""}`
        .toLowerCase()
        .includes(termo)
    );
  }, [auditorias, busca]);

  return (
    <div className="space-y-3">
      {auditorias.length > 3 && (
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome do arquivo, status ou garantia..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none"
        />
      )}

      {filtradas.map((a) => (
        <details
          key={a.id}
          open={a.id === destaque}
          className="rounded-xl border border-o2-navy/10 bg-white p-3"
        >
          <summary className="cursor-pointer font-medium text-o2-navy">
            {a.locador_identificado || "Locador não identificado"} × {a.locatario_identificado || "Locatário não identificado"} — {a.endereco_identificado || "Endereço não identificado"}
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-xs text-gray-500">
              {a.nome_arquivo || "Texto colado"} — auditado em {new Date(a.created_at).toLocaleString("pt-BR")}
            </p>
            <RelatorioView relatorio={a.relatorio} />
          </div>
        </details>
      ))}

      {!filtradas.length && auditorias.length > 0 && (
        <p className="text-sm text-gray-500">Nenhuma auditoria encontrada para essa busca.</p>
      )}
      {!auditorias.length && <p className="text-sm text-gray-500">Nenhuma auditoria realizada ainda.</p>}
    </div>
  );
}
