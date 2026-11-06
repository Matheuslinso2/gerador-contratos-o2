"use client";

import { useState, useTransition } from "react";
import { autorizarCriacaoCards } from "./actions";
import type { PedidoCard, ResultadoCard } from "@/lib/erp/renovacaoCriarCards";

// Botão de autorização de criação de cards (Ramos Elementares). Pede confirmação, mostra o que foi criado e o que foi ignorado (duplicidade, cancelada, já renovada).
export default function BotaoAutorizarCriacao({ bloco, de, ate, cards, itens }: { bloco: "fianca" | "cap" | "auto" | "re_lotes" | "re_demais"; de: string; ate: string; cards: PedidoCard[]; itens: number }) {
  const [pendente, iniciar] = useTransition();
  const [resultados, setResultados] = useState<ResultadoCard[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function executar(simular: boolean) {
    if (!simular && !window.confirm(`Criar ${cards.length} card(s) no Bitrix (funil Renovações, etapa Entrada e conferência), com ${itens} apólice(s)?\n\nO sistema confere duplicidade, cancelamento e renovação já emitida antes de cada card.`)) return;
    setErro(null);
    iniciar(async () => {
      const r = await autorizarCriacaoCards({ bloco, de, ate, cards, simular });
      if (r.ok) setResultados(r.resultados); else { setResultados(null); setErro(r.erro); }
    });
  }

  const criados = resultados?.filter((r) => r.resultado === "criado").length ?? 0;
  const simulados = resultados?.filter((r) => r.resultado === "simulado").length ?? 0;
  const ignorados = resultados?.filter((r) => r.resultado === "ignorado").length ?? 0;
  const erros = resultados?.filter((r) => r.resultado === "erro").length ?? 0;

  return (
    <div className="space-y-2 text-right">
      <div className="flex justify-end gap-2">
        <button type="button" disabled={pendente || !cards.length} onClick={() => executar(true)} className="rounded-lg border border-o2-navy px-3 py-2 text-sm font-semibold text-o2-navy hover:bg-white disabled:cursor-not-allowed disabled:opacity-50">
          Conferir antes
        </button>
        <button type="button" disabled={pendente || !cards.length} onClick={() => executar(false)} className="rounded-lg bg-o2-navy px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
          {pendente ? "Processando…" : `Autorizar criação dos ${cards.length} card(s) novo(s)`}
        </button>
      </div>
      <p className="ml-auto max-w-[360px] text-xs text-gray-500">Cria no Bitrix só quando você clicar. Cada card é conferido (duplicidade, cancelamento, renovação já emitida) e registrado com seu e-mail.</p>
      {erro && <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-left text-xs text-red-800">{erro}</p>}
      {resultados && (
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-left text-xs">
          <p className="font-semibold text-gray-900">
            {simulados > 0 ? `Conferência: ${simulados} card(s) prontos para criar` : `${criados} card(s) criado(s)`} · {ignorados} ignorado(s) · {erros} com erro
          </p>
          <ul className="mt-1 max-h-60 space-y-0.5 overflow-y-auto">
            {resultados.map((r, i) => (
              <li key={i} className={r.resultado === "erro" ? "text-red-700" : r.resultado === "ignorado" ? "text-amber-700" : "text-gray-700"}>
                <strong>{r.resultado === "criado" ? "Criado" : r.resultado === "simulado" ? "Pronto" : r.resultado === "ignorado" ? "Ignorado" : "Erro"}</strong> · {r.titulo} ({r.itens} item(ns)){r.bitrixId ? ` · card #${r.bitrixId}` : ""}{r.detalhe ? ` — ${r.detalhe}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
