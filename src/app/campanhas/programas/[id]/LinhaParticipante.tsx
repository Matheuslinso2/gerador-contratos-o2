"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { atualizarParticipante, removerParticipante } from "../actions";
import { COR_FAROL, ROTULO_FAROL, type LinhaDesempenho } from "@/lib/campanhas/programas";

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const umaCasa = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const paraCampo = (n: number | null) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

// Uma linha da tabela de participantes: números calculados + meta, custo da
// premiação e observação editáveis (salva na hora, recalcula a tela).
export default function LinhaParticipante({ linha, moeda }: { linha: LinhaDesempenho; moeda: boolean }) {
  const router = useRouter();
  const [meta, setMeta] = useState(paraCampo(linha.meta));
  const [custo, setCusto] = useState(paraCampo(linha.custoPremiacao || null));
  const [obs, setObs] = useState(linha.observacao ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, setPendente] = useState(false);
  const alterado = meta !== paraCampo(linha.meta) || custo !== paraCampo(linha.custoPremiacao || null) || obs !== (linha.observacao ?? "");
  const fmt = (n: number | null) => (n === null ? "—" : moeda ? brl.format(n) : umaCasa.format(n));

  async function salvar() {
    setErro(null);
    setPendente(true);
    try {
      await atualizarParticipante(linha.participanteId, { meta, custo, observacao: obs });
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui salvar.");
    } finally {
      setPendente(false);
    }
  }

  function remover() {
    if (!confirm(`Tirar "${linha.nome}" do programa? A meta e as anotações dela serão apagadas.`)) return;
    setPendente(true);
    removerParticipante(linha.participanteId)
      .then(() => router.refresh())
      .catch((e) => setErro(e instanceof Error ? e.message : "Não consegui tirar."))
      .finally(() => setPendente(false));
  }

  const campo = "w-24 rounded border border-gray-300 px-2 py-1 text-right text-sm tabular-nums focus:border-o2-coral focus:outline-none";

  return (
    <tr className="border-b align-top last:border-0">
      <td className="py-2 pr-3">
        <div className="font-medium text-o2-navy">{linha.nome}</div>
        {linha.tipo === "grupo" && <div className="text-xs text-gray-500">{linha.unidades.length} unidade(s): {linha.unidades.join(", ")}</div>}
        {linha.alertas.map((a) => (
          <div key={a.texto} className="text-xs font-medium text-red-700">
            🔔 {a.texto}
          </div>
        ))}
        {linha.avisos.map((a) => (
          <div key={a} className="text-xs text-amber-700">
            ⚠ {a}
          </div>
        ))}
        <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação da parceria" className="mt-1 w-56 rounded border border-gray-200 px-2 py-1 text-xs focus:border-o2-coral focus:outline-none" />
        {erro && <div className="mt-1 text-xs text-red-700">{erro}</div>}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums text-gray-500">{fmt(linha.base)}</td>
      <td className="py-2 pr-3 text-right">
        <input value={meta} onChange={(e) => setMeta(e.target.value)} inputMode="decimal" placeholder="—" className={campo} />
      </td>
      <td className="py-2 pr-3 text-right font-semibold tabular-nums text-o2-navy">{fmt(linha.realizado)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{linha.percentual === null ? "—" : `${inteiro.format(linha.percentual)}%`}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{fmt(linha.faltam)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{linha.ritmoSemana === null ? "—" : fmt(linha.ritmoSemana)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{fmt(linha.projecao)}</td>
      <td className="py-2 pr-3">
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${COR_FAROL[linha.farol]}`}>{ROTULO_FAROL[linha.farol]}</span>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{inteiro.format(linha.funil.emAndamento)}</td>
      <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
        {inteiro.format(linha.corp.documentos)} · {brl.format(linha.corp.premio)}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{brl.format(linha.corp.comissao)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{brl.format(linha.corp.repasse)}</td>
      <td className="py-2 pr-3 text-right">
        <input value={custo} onChange={(e) => setCusto(e.target.value)} inputMode="decimal" placeholder="0" className={campo} />
      </td>
      <td className={`py-2 pr-3 text-right font-semibold tabular-nums ${linha.resultado < 0 ? "text-red-700" : "text-o2-navy"}`}>{brl.format(linha.resultado)}</td>
      <td className="py-2 whitespace-nowrap">
        <button type="button" onClick={salvar} disabled={!alterado || pendente} className="rounded-full bg-o2-coral px-3 py-1 text-xs font-medium text-white disabled:opacity-40">
          {pendente ? "…" : "Salvar"}
        </button>
        <button type="button" onClick={remover} disabled={pendente} className="ml-2 text-xs text-gray-500 underline">
          tirar
        </button>
      </td>
    </tr>
  );
}
