"use client";

import Link from "next/link";
import RelatorioView from "./RelatorioView";
import type { RelatorioAuditoria } from "@/lib/auditorContrato";

type ImobiliariaRef = { nome: string } | { nome: string }[] | null;

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
  imobiliarias?: ImobiliariaRef;
};

function nomeImobiliaria(ref: ImobiliariaRef | undefined): string | null {
  const obj = Array.isArray(ref) ? ref[0] : ref;
  return obj?.nome ?? null;
}

export default function ListaAuditorias({
  auditorias,
  destaque,
  mostrarImobiliaria = false,
  total,
  limite,
  passo,
  busca,
}: {
  auditorias: Auditoria[];
  destaque?: string;
  mostrarImobiliaria?: boolean;
  total: number;
  limite: number;
  passo: number;
  busca: string;
}) {
  // A busca e a paginação são feitas no servidor (página.tsx): a lista só traz
  // as mais recentes de cada vez, em vez do histórico inteiro.
  const filtradas = auditorias;
  const linkVerMais = `?${new URLSearchParams({ ...(busca ? { busca } : {}), limite: String(limite + passo) }).toString()}`;

  return (
    <div className="space-y-3">
      {(total > 3 || busca) && (
        <form method="get" className="flex gap-2">
          <input
            name="busca"
            defaultValue={busca}
            placeholder="Buscar por arquivo, locador, locatário, endereço, status ou garantia..."
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none"
          />
          <button type="submit" className="rounded-lg bg-o2-navy px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">
            Buscar
          </button>
          {busca && (
            <Link href="?" className="self-center text-xs text-gray-500 underline">
              limpar
            </Link>
          )}
        </form>
      )}

      {filtradas.map((a) => (
        <details
          key={a.id}
          open={a.id === destaque}
          className="rounded-xl border border-o2-navy/10 bg-quadro p-3"
        >
          <summary className="cursor-pointer font-medium text-o2-navy">
            {mostrarImobiliaria && nomeImobiliaria(a.imobiliarias) && (
              <span className="mr-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                {nomeImobiliaria(a.imobiliarias)}
              </span>
            )}
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

      {total > filtradas.length && (
        <div className="flex items-center justify-between gap-3 pt-1 text-sm text-gray-600">
          <span>
            Mostrando {filtradas.length} de {total}
          </span>
          <Link href={linkVerMais} className="rounded-full border border-o2-navy px-4 py-1.5 font-medium text-o2-navy transition hover:bg-gray-50">
            Ver mais {passo}
          </Link>
        </div>
      )}
      {!filtradas.length && busca && <p className="text-sm text-gray-500">Nenhuma auditoria encontrada para essa busca.</p>}
      {!filtradas.length && !busca && <p className="text-sm text-gray-500">Nenhuma auditoria realizada ainda.</p>}
    </div>
  );
}
