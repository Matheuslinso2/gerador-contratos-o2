"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { salvarMetaParticipante } from "./actions";
import { COR_FAROL, ROTULO_FAROL, type LinhaDesempenho } from "@/lib/campanhas/desempenho";
import { COR_STATUS_ENVIO, ROTULO_STATUS_ENVIO, normalizarBusca, type ResumoStatusEnvio } from "@/lib/campanhas/producaoStatus";
import type { UltimosContatos } from "@/lib/campanhas/contatosTipos";
import ContatoImobiliaria from "./ContatoImobiliaria";
import { EmailsEnviados } from "../../EmailsEnviados";

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const umaCasa = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const paraCampo = (n: number | null) => (n === null || n === undefined || n === 0 ? "" : String(n).replace(".", ","));

export const nomeResponsavel = (email: string) => {
  const parte = email.split("@")[0].split(/[._-]/)[0];
  return parte.charAt(0).toUpperCase() + parte.slice(1);
};

// Uma linha do quadro de metas e produção da campanha: números automáticos +
// responsável da O2, meta, custo da premiação e observação editáveis.
export default function LinhaMeta({
  campanhaId,
  linha,
  moeda,
  statusEnvio,
  responsaveis,
  contatos,
}: {
  campanhaId: string;
  linha: LinhaDesempenho;
  moeda: boolean;
  statusEnvio: ResumoStatusEnvio | null;
  responsaveis: string[];
  contatos: UltimosContatos | null;
}) {
  const router = useRouter();
  const [meta, setMeta] = useState(paraCampo(linha.meta));
  const [custo, setCusto] = useState(paraCampo(linha.custoPremiacao));
  const [obs, setObs] = useState(linha.observacao ?? "");
  const [resp, setResp] = useState(linha.responsavelEmail ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, setPendente] = useState(false);
  const alterado =
    meta !== paraCampo(linha.meta) || custo !== paraCampo(linha.custoPremiacao) || obs !== (linha.observacao ?? "") || resp !== (linha.responsavelEmail ?? "");
  const fmt = (n: number | null) => (n === null ? "—" : moeda ? brl.format(n) : umaCasa.format(n));
  const opcoes = [...new Set([...responsaveis, ...(linha.responsavelEmail ? [linha.responsavelEmail] : [])])].sort();

  async function salvar() {
    setErro(null);
    setPendente(true);
    try {
      await salvarMetaParticipante(
        campanhaId,
        linha.grupoId ? { tipo: "grupo", id: linha.grupoId } : { tipo: "imobiliaria", id: linha.imobiliariaId as string },
        { meta, custo, observacao: obs, responsavel: resp }
      );
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui salvar.");
    } finally {
      setPendente(false);
    }
  }

  const campo = "w-20 rounded border border-gray-300 px-2 py-1 text-right text-sm tabular-nums focus:border-o2-coral focus:outline-none";

  return (
    <tr className="border-b align-top last:border-0" data-filtro-nome={normalizarBusca(`${linha.nome} ${linha.unidades.join(" ")}`)} data-filtro-status={statusEnvio?.chave ?? "aguardando"} data-filtro-responsavel={linha.responsavelEmail ?? ""}>
      <td className="p-2">
        <div className="max-w-[260px] font-semibold text-o2-navy">{linha.nome}</div>
        {linha.tipo === "grupo" && <div className="text-xs text-gray-500">{linha.unidades.length} unidade(s): {linha.unidades.join(", ")}</div>}
        {statusEnvio && statusEnvio.emails.length > 0 && (
          <details className="mt-0.5">
            <summary className="cursor-pointer text-[11px] text-gray-500">
              {statusEnvio.totalEmails} e-mail(s) da campanha · {statusEnvio.emailsAbertos} aberto(s)
            </summary>
            <EmailsEnviados emails={statusEnvio.emails} />
          </details>
        )}
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
      <td className="p-2">
        {statusEnvio ? (
          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${COR_STATUS_ENVIO[statusEnvio.chave]}`}>{ROTULO_STATUS_ENVIO[statusEnvio.chave]}</span>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>
      <td className="p-2">
        <ContatoImobiliaria
          campanhaId={campanhaId}
          contatos={contatos}
          unidades={linha.unidadeIds.map((id, i) => ({ id, nome: linha.unidades[i] ?? linha.nome }))}
          responsaveis={responsaveis}
        />
      </td>
      <td className="p-2">
        <select value={resp} onChange={(e) => setResp(e.target.value)} className="w-28 rounded border border-gray-300 px-1 py-1 text-xs focus:border-o2-coral focus:outline-none">
          <option value="">—</option>
          {opcoes.map((e) => (
            <option key={e} value={e} title={e}>
              {nomeResponsavel(e)}
            </option>
          ))}
        </select>
      </td>
      <td className="p-2 text-right tabular-nums text-gray-500">{fmt(linha.base)}</td>
      <td className="p-2 text-right">
        <input value={meta} onChange={(e) => setMeta(e.target.value)} inputMode="decimal" placeholder="—" className={campo} />
      </td>
      <td className="p-2 text-right font-semibold tabular-nums text-o2-navy">{fmt(linha.realizado)}</td>
      <td className="p-2 text-right tabular-nums">
        {linha.percentual === null ? (
          "—"
        ) : (
          <div className="min-w-[56px]">
            <div className="font-semibold">{inteiro.format(linha.percentual)}%</div>
            <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
              <div className={`h-full rounded-full ${linha.percentual >= 100 ? "bg-green-600" : "bg-o2-coral"}`} style={{ width: `${Math.min(100, Math.max(2, linha.percentual))}%` }} />
            </div>
          </div>
        )}
      </td>
      <td className="p-2 text-right tabular-nums">{fmt(linha.faltam)}</td>
      <td className="p-2 text-right tabular-nums">{linha.ritmoSemana === null ? "—" : fmt(linha.ritmoSemana)}</td>
      <td className="p-2 text-right tabular-nums">{fmt(linha.projecao)}</td>
      <td className="p-2">
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${COR_FAROL[linha.farol]}`}>{ROTULO_FAROL[linha.farol]}</span>
      </td>
      <td className="p-2 text-right tabular-nums">{inteiro.format(linha.funil.emAndamento)}</td>
      <td className="whitespace-nowrap p-2 text-right tabular-nums">
        {inteiro.format(linha.corp.documentos)} · {brl.format(linha.corp.premio)}
      </td>
      <td className="p-2 text-right tabular-nums">{brl.format(linha.corp.comissao)}</td>
      <td className="p-2 text-right tabular-nums">{brl.format(linha.corp.repasse)}</td>
      <td className="p-2 text-right">
        <input value={custo} onChange={(e) => setCusto(e.target.value)} inputMode="decimal" placeholder="0" className={campo} />
      </td>
      <td className={`p-2 text-right font-semibold tabular-nums ${linha.resultado < 0 ? "text-red-700" : "text-o2-navy"}`}>{brl.format(linha.resultado)}</td>
      <td className="p-2" data-export-ignore="true">
        <button type="button" onClick={salvar} disabled={!alterado || pendente} className="rounded-full bg-o2-coral px-3 py-1 text-xs font-medium text-white disabled:opacity-40">
          {pendente ? "…" : "Salvar"}
        </button>
      </td>
    </tr>
  );
}
