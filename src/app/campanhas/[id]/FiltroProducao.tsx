"use client";

import { useEffect, useMemo, useState } from "react";
import { normalizarBusca } from "@/lib/campanhas/producaoStatus";

type OpcaoStatus = { valor: string; rotulo: string; total: number };
type LinhaFiltro = { nomeNormalizado: string; status: string; responsavel?: string };

// Valor do filtro de responsável para "sem responsável definido".
const SEM_RESPONSAVEL = "__sem__";
const bateResponsavel = (filtro: string, valor: string) => !filtro || (filtro === SEM_RESPONSAVEL ? !valor : valor === filtro);

// Pedido do Matheus, 07/10/2026: achar uma imobiliária específica no quadro
// "Produção gerada" e filtrar por quem abriu / não abriu o e-mail. Esconde as
// linhas JÁ renderizadas pelo servidor (tr[data-filtro-nome]) em vez de
// recarregar a página -- assim o que já foi digitado nos campos de produção
// das outras linhas não se perde. A linha de total não muda (soma tudo).
export function FiltroProducao({
  quadroId,
  linhas,
  opcoesStatus,
  opcoesResponsavel,
  rotuloBusca = "Buscar imobiliária",
  placeholderBusca = "Nome da imobiliária...",
  textoVazio = "Nenhuma imobiliária encontrada com esse filtro.",
}: {
  quadroId: string;
  linhas: LinhaFiltro[];
  opcoesStatus: OpcaoStatus[];
  // Opcional (campanha com metas, 22/10/2026): filtrar pelo responsável da O2.
  opcoesResponsavel?: OpcaoStatus[];
  rotuloBusca?: string;
  placeholderBusca?: string;
  textoVazio?: string;
}) {
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("");
  const [responsavel, setResponsavel] = useState("");

  const termo = normalizarBusca(busca);
  const visiveis = useMemo(
    () => linhas.filter(
        (l) => (!termo || l.nomeNormalizado.includes(termo)) && (!status || l.status === status) && bateResponsavel(responsavel, l.responsavel ?? "")
      ).length,
    [linhas, termo, status, responsavel]
  );

  useEffect(() => {
    const quadro = document.getElementById(quadroId);
    if (!quadro) return;
    // Qualquer elemento marcado (linhas de tabela e blocos recolhíveis).
    quadro.querySelectorAll<HTMLElement>("[data-filtro-nome]").forEach((linha) => {
      const bateNome = !termo || (linha.dataset.filtroNome ?? "").includes(termo);
      const bateStatus = !status || linha.dataset.filtroStatus === status;
      const bateResp = bateResponsavel(responsavel, linha.dataset.filtroResponsavel ?? "");
      linha.hidden = !(bateNome && bateStatus && bateResp);
    });
  }, [quadroId, termo, status, responsavel]);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-o2-navy/10 bg-quadro p-3">
        <div className="min-w-[200px] flex-1">
          <label className="mb-0.5 block text-xs text-gray-500">{rotuloBusca}</label>
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={placeholderBusca}
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-o2-coral focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-0.5 block text-xs text-gray-500">Status do e-mail</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-o2-coral focus:outline-none"
          >
            <option value="">Todos</option>
            {opcoesStatus.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo} ({o.total})
              </option>
            ))}
          </select>
        </div>
        {opcoesResponsavel && opcoesResponsavel.length > 0 && (
          <div>
            <label className="mb-0.5 block text-xs text-gray-500">Responsável O2</label>
            <select
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-o2-coral focus:outline-none"
            >
              <option value="">Todos</option>
              {opcoesResponsavel.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo} ({o.total})
                </option>
              ))}
            </select>
          </div>
        )}
        {(busca || status || responsavel) && (
          <button
            type="button"
            onClick={() => {
              setBusca("");
              setStatus("");
              setResponsavel("");
            }}
            className="pb-1.5 text-sm font-medium text-gray-500 hover:underline"
          >
            Limpar filtro
          </button>
        )}
        <span className="pb-1.5 text-xs text-gray-500">
          Mostrando {visiveis} de {linhas.length}
        </span>
      </div>
      {linhas.length > 0 && visiveis === 0 && (
        <p className="rounded-lg border border-yellow-300 bg-yellow-50 p-2 text-xs text-yellow-800">{textoVazio}</p>
      )}
    </div>
  );
}
