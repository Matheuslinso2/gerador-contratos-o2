"use client";

import { useMemo, useState } from "react";
import RelatorioView from "../auditar-contrato/RelatorioView";
import type { RelatorioAuditoria } from "@/lib/auditorContrato";

type Contrato = {
  id: string;
  locador: string;
  locatario: string;
  endereco_imovel: string;
  texto_gerado: string;
  created_at: string;
  laudo_modo: string | null;
  laudo_arquivo_nome: string | null;
};

type Auditoria = {
  id: string;
  nome_arquivo: string | null;
  status_geral: string;
  tipo_garantia_identificada: string | null;
  relatorio: RelatorioAuditoria;
  texto_contrato: string | null;
  created_at: string;
};

type Item =
  | { tipo: "gerado"; data: Contrato }
  | { tipo: "auditado"; data: Auditoria };

const FILTROS = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "gerado", rotulo: "Gerados" },
  { valor: "auditado", rotulo: "Auditados" },
] as const;

export default function ListaContratosRealizados({
  contratos,
  auditorias,
}: {
  contratos: Contrato[];
  auditorias: Auditoria[];
}) {
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<"todos" | "gerado" | "auditado">("todos");

  const itens: Item[] = useMemo(() => {
    const gerados: Item[] = contratos.map((data) => ({ tipo: "gerado", data }));
    const auditados: Item[] = auditorias.map((data) => ({ tipo: "auditado", data }));
    return [...gerados, ...auditados].sort(
      (a, b) => new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime()
    );
  }, [contratos, auditorias]);

  const itensFiltrados = useMemo(() => {
    let resultado = itens;
    if (filtroTipo !== "todos") resultado = resultado.filter((i) => i.tipo === filtroTipo);

    const termo = busca.trim().toLowerCase();
    if (!termo) return resultado;

    return resultado.filter((i) => {
      if (i.tipo === "gerado") {
        return `${i.data.locador} ${i.data.locatario} ${i.data.endereco_imovel}`
          .toLowerCase()
          .includes(termo);
      }
      return `${i.data.nome_arquivo ?? ""} ${i.data.status_geral} ${i.data.tipo_garantia_identificada ?? ""} ${
        i.data.texto_contrato ?? ""
      }`
        .toLowerCase()
        .includes(termo);
    });
  }, [itens, busca, filtroTipo]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por CPF, nome, endereço..."
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none"
        />
        <div className="flex gap-1 rounded-lg border border-gray-200 p-1">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              type="button"
              onClick={() => setFiltroTipo(f.valor)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                filtroTipo === f.valor ? "bg-o2-navy text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {f.rotulo}
            </button>
          ))}
        </div>
      </div>

      {itensFiltrados.map((item) =>
        item.tipo === "gerado" ? (
          <details key={`g-${item.data.id}`} className="rounded-xl border border-o2-navy/10 bg-white p-3">
            <summary className="cursor-pointer font-medium text-o2-navy">
              <span className="mr-2 rounded-full bg-o2-coral/10 px-2 py-0.5 text-xs font-semibold text-o2-coral">
                Gerado
              </span>
              {item.data.locador} × {item.data.locatario} — {item.data.endereco_imovel}
            </summary>
            <div className="mt-2 flex flex-wrap gap-2">
              <a
                href={`/api/contratos/${item.data.id}/docx`}
                className="inline-block rounded-full bg-o2-coral px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
              >
                Baixar contrato em Word (.docx)
              </a>
              {item.data.laudo_modo === "arquivo_embutido" && (
                <a
                  href={`/api/contratos/${item.data.id}/pdf`}
                  className="inline-block rounded-full border border-o2-navy px-4 py-1.5 text-sm font-medium text-o2-navy transition hover:bg-o2-gray/40"
                >
                  Baixar contrato completo com laudo (PDF)
                </a>
              )}
              {(item.data.laudo_modo === "arquivo_separado" || item.data.laudo_modo === "arquivo_embutido") && (
                <a
                  href={`/api/contratos/${item.data.id}/laudo`}
                  className="inline-block rounded-full border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Baixar laudo de vistoria (original
                  {item.data.laudo_arquivo_nome ? `: ${item.data.laudo_arquivo_nome}` : ""})
                </a>
              )}
            </div>
            <pre className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{item.data.texto_gerado}</pre>
          </details>
        ) : (
          <details key={`a-${item.data.id}`} className="rounded-xl border border-o2-navy/10 bg-white p-3">
            <summary className="cursor-pointer font-medium text-o2-navy">
              <span className="mr-2 rounded-full bg-o2-navy/10 px-2 py-0.5 text-xs font-semibold text-o2-navy">
                Auditado
              </span>
              {item.data.nome_arquivo || "Texto colado"} —{" "}
              {new Date(item.data.created_at).toLocaleString("pt-BR")}
            </summary>
            <div className="mt-3">
              <RelatorioView relatorio={item.data.relatorio} />
            </div>
          </details>
        )
      )}

      {!itensFiltrados.length && itens.length > 0 && (
        <p className="text-sm text-gray-500">Nenhum resultado para essa busca.</p>
      )}
      {!itens.length && (
        <p className="text-sm text-gray-500">Nenhum contrato gerado ou auditado ainda.</p>
      )}
    </div>
  );
}
