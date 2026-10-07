"use client";

import { useEffect, useMemo, useState } from "react";
import { normalizarBusca } from "@/lib/campanhas/producaoStatus";

type OpcaoStatus = { valor: string; rotulo: string; total: number };
type LinhaFiltro = { nomeNormalizado: string; status: string };

// Pedido do Matheus, 07/10/2026: achar uma imobiliária específica no quadro
// "Produção gerada" e filtrar por quem abriu / não abriu o e-mail. Esconde as
// linhas JÁ renderizadas pelo servidor (tr[data-filtro-nome]) em vez de
// recarregar a página -- assim o que já foi digitado nos campos de produção
// das outras linhas não se perde. A linha de total não muda (soma tudo).
export function FiltroProducao({
  quadroId,
  linhas,
  opcoesStatus,
}: {
  quadroId: string;
  linhas: LinhaFiltro[];
  opcoesStatus: OpcaoStatus[];
}) {
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("");

  const termo = normalizarBusca(busca);
  const visiveis = useMemo(
    () => linhas.filter((l) => (!termo || l.nomeNormalizado.includes(termo)) && (!status || l.status === status)).length,
    [linhas, termo, status]
  );

  useEffect(() => {
    const quadro = document.getElementById(quadroId);
    if (!quadro) return;
    quadro.querySelectorAll<HTMLElement>("tr[data-filtro-nome]").forEach((linha) => {
      const bateNome = !termo || (linha.dataset.filtroNome ?? "").includes(termo);
      const bateStatus = !status || linha.dataset.filtroStatus === status;
      linha.hidden = !(bateNome && bateStatus);
    });
  }, [quadroId, termo, status]);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-o2-navy/10 bg-quadro p-3">
        <div className="min-w-[200px] flex-1">
          <label className="mb-0.5 block text-xs text-gray-500">Buscar imobiliária</label>
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome da imobiliária..."
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
        {(busca || status) && (
          <button
            type="button"
            onClick={() => {
              setBusca("");
              setStatus("");
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
        <p className="rounded-lg border border-yellow-300 bg-yellow-50 p-2 text-xs text-yellow-800">Nenhuma imobiliária encontrada com esse filtro.</p>
      )}
    </div>
  );
}
