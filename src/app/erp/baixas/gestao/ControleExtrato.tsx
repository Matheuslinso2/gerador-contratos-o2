import RascunhoAutomatico from "@/components/RascunhoAutomatico";
import { brlCurto } from "./formato";
import { salvarNotaBaixa } from "./actions";
import type { SituacaoBanco } from "@/lib/erp/baixaAutomatica";
import type { DiaCaixa } from "@/lib/erp/caixaNibo";

// Faixa de controle de um extrato dentro do bloco: banco (Nibo), pendentes de identificação ("recebido, ainda sem parcela"),
// o que o ERP identifica e o Corp não, "seria baixado automaticamente" (modo teste) e anotação do motivo.
const BANCO_TXT: Record<SituacaoBanco, { t: string; cor: string }> = {
  bate: { t: "bate com o banco", cor: "bg-green-100 text-green-800" },
  diferente: { t: "banco difere do extrato", cor: "bg-orange-100 text-orange-800" },
  sem_banco: { t: "sem entrada no banco", cor: "bg-red-100 text-red-700" },
};

export default function ControleExtrato(p: {
  extratoId: string; seguradora_id: string; corretora_id: string; mes: string; ancora: string;
  banco: SituacaoBanco; bancoDia: DiaCaixa | null; aprovada: boolean; seria: boolean; faltas: string[];
  tot?: { qtdPendente: number; somaPendente: number; idadeMax: number | null; erpNaoCorp: number };
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-t-lg border border-b-0 border-gray-200 bg-gray-50 px-3 py-1.5 text-[11px]">
      <span className={`rounded-full px-2 py-0.5 ${BANCO_TXT[p.banco].cor}`}>{BANCO_TXT[p.banco].t}</span>
      {p.bancoDia && p.banco !== "bate" && <span className="text-gray-500">banco {brlCurto(p.bancoDia.banco)} × extratos do dia {brlCurto(p.bancoDia.extrato)}</span>}
      {p.tot && p.tot.qtdPendente > 0 && (
        <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700">
          {p.tot.qtdPendente} linha(s) recebida(s) sem parcela · {brlCurto(p.tot.somaPendente)}{p.tot.idadeMax != null ? ` · há ${p.tot.idadeMax} dia(s)` : ""}
        </span>
      )}
      {p.tot && p.tot.erpNaoCorp > 0 && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-800">o ERP identifica {brlCurto(p.tot.erpNaoCorp)} que o Corp não</span>}
      {!p.aprovada && p.seria && <span className="rounded bg-green-50 px-1.5 py-0.5 font-medium text-green-800">seria baixado automaticamente <span className="font-normal text-gray-500">(teste, desligado)</span></span>}
      {!p.aprovada && !p.seria && p.faltas.length > 0 && <span className="text-red-700">baixa à mão: {p.faltas.join("; ")}</span>}
      <details className="ml-auto">
        <summary className="cursor-pointer text-o2-navy underline">anotar motivo</summary>
        <form action={salvarNotaBaixa} className="mt-1 flex gap-1">
          <RascunhoAutomatico />
          <input type="hidden" name="seguradora_id" value={p.seguradora_id} />
          <input type="hidden" name="corretora_id" value={p.corretora_id} />
          <input type="hidden" name="extrato_id" value={p.extratoId} />
          <input type="hidden" name="mes" value={p.mes} />
          <input type="hidden" name="ancora" value={p.ancora} />
          <input name="texto" className="w-64 rounded border border-gray-300 px-1.5 py-0.5" placeholder="motivo da diferença neste extrato" />
          <button className="rounded bg-o2-navy px-2 py-0.5 text-white">ok</button>
        </form>
      </details>
    </div>
  );
}
