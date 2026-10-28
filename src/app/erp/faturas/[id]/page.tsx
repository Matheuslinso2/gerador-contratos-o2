import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarData, formatarReais } from "@/lib/sinistros/regras";
import { fichaFatura, TOLERANCIA_FATURA, type LinhaFatura } from "@/lib/erp/faturaTela";
import RascunhoAutomatico from "@/components/RascunhoAutomatico";
import { registrarMovimentacao } from "./actions";
import BotaoVerDocumento from "../../BotaoVerDocumento";

const MOTIVOS = ["Entrega de chaves", "Fim de contrato", "Cancelamento a pedido", "Sinistro", "Litígio", "Troca de administradora", "Renovação em outra fatura", "Erro da seguradora", "Outro"];

export const dynamic = "force-dynamic";
export const metadata = { title: "Fatura" };

// Tela de UMA fatura (fase B, Matheus 26/10): navegação mês a mês, resumo (mês anterior + entradas − saídas = este mês),
// boleto × soma das linhas × comissão no extrato, e as abas Entradas · Saídas · Todas as linhas.
const mesBr = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

function Tabela({ linhas }: { linhas: LinhaFatura[] }) {
  return (
    <table className="w-full text-xs">
      <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
        <tr>
          <th className="px-3 py-1.5">Abrir</th>
          <th className="px-3 py-1.5">Nº da apólice</th>
          <th className="px-3 py-1.5">Código O2 do documento</th>
          <th className="px-3 py-1.5">Cliente</th>
          <th className="px-3 py-1.5">Parcela</th>
          <th className="px-3 py-1.5 text-right">Cobrado na fatura</th>
          <th className="px-3 py-1.5 text-right">Comissão no extrato</th>
          <th className="px-3 py-1.5">Situação</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {linhas.map((l) => (
          <tr key={l.id}>
            <td className="px-3 py-1"><BotaoVerDocumento id={l.documento_id} /></td>
            <td className="px-3 py-1">
              {l.ramo_nome ? <span className="text-gray-400">{l.ramo_nome} </span> : null}
              {l.apolice}
              {l.endosso ? <span className="text-amber-700"> · endosso {l.endosso}</span> : null}
            </td>
            <td className="px-3 py-1">
              {l.documento_id ? (
                <Link href={`/erp/documentos/${l.documento_id}`} className="text-o2-navy hover:underline">
                  {l.codigo_o2}
                </Link>
              ) : (
                <span className="text-red-700">não está no ERP</span>
              )}
            </td>
            <td className="px-3 py-1">{l.cliente ?? "—"}</td>
            <td className="px-3 py-1">{l.parcela_n ? `${l.parcela_n}${l.parcelas_total ? `/${l.parcelas_total}` : ""}` : "—"}</td>
            <td className={`px-3 py-1 text-right ${l.valor < 0 ? "text-red-700" : ""}`}>{formatarReais(l.valor)}</td>
            <td className="px-3 py-1 text-right">{l.comissao_extrato === null ? <span className="text-gray-400">—</span> : formatarReais(l.comissao_extrato)}</td>
            <td className="px-3 py-1">{l.situacao_doc ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function ErpFaturaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mes?: string }> }) {
  const { id } = await params;
  const { mes: mesParam } = await searchParams;
  const supabase = await createClient();
  const d = await fichaFatura(supabase, id, mesParam);
  if (!d) redirect("/erp/faturas");
  const { fatura, meses, mes, anterior, linhas, entradas, saidas } = d;
  const imob = (fatura.imobiliaria as unknown as { nome: string } | null)?.nome ?? "—";
  const idx = mes ? meses.findIndex((m) => m.id === mes.id) : -1;
  const dif = mes && mes.valor_boleto !== null ? mes.valor_boleto - mes.valor_itens : null;
  const comissaoTotal = linhas.reduce((s, l) => s + (l.comissao_extrato ?? 0), 0);
  const semDoc = linhas.filter((l) => !l.documento_id).length;
  const semExplicacao = saidas.filter((s) => !s.explicacao).length;

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-5 p-8">
      <div className="space-y-1">
        <Link href="/erp/faturas" className="text-sm text-gray-500 hover:text-o2-navy hover:underline">
          ← Faturas
        </Link>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold text-o2-navy">
            Fatura · {imob} · {fatura.seguradora} <span className="text-base font-normal text-gray-500">{fatura.chave}</span>
          </h1>
          {mes && (
            <div className="flex items-center gap-2 text-sm">
              {idx > 0 ? (
                <Link href={`/erp/faturas/${id}?mes=${meses[idx - 1].competencia}`} className="rounded-full border border-gray-300 px-2 py-0.5 hover:border-o2-navy">
                  ◀ {mesBr(meses[idx - 1].competencia)}
                </Link>
              ) : null}
              <span className="rounded-full bg-o2-navy px-3 py-0.5 font-semibold text-white">{mesBr(mes.competencia)}</span>
              {idx < meses.length - 1 ? (
                <Link href={`/erp/faturas/${id}?mes=${meses[idx + 1].competencia}`} className="rounded-full border border-gray-300 px-2 py-0.5 hover:border-o2-navy">
                  {mesBr(meses[idx + 1].competencia)} ▶
                </Link>
              ) : null}
            </div>
          )}
        </div>
        <p className="text-sm text-gray-600">
          {fatura.corretora ?? "corretora a confirmar"} · {"ramo_nome" in fatura && fatura.ramo_nome ? <>{fatura.ramo_nome}</> : <>produto ainda não identificado</>}
          {mes?.vencimento ? ` · vencimento ${formatarData(mes.vencimento)}` : ""}
        </p>
      </div>

      {mes && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          {[
            ["Mês anterior", anterior ? String(anterior.qtd_itens) : "—"],
            ["+ Entradas", String(entradas.length)],
            ["− Saídas", String(saidas.length)],
            ["= Este mês", String(mes.qtd_itens)],
            ["Boleto da seguradora", mes.valor_boleto === null ? "—" : formatarReais(mes.valor_boleto)],
            ["Soma das linhas", formatarReais(mes.valor_itens)],
            ["Comissão no extrato", comissaoTotal ? formatarReais(comissaoTotal) : "—"],
          ].map(([r, v]) => (
            <div key={r} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">{r}</div>
              <div className="text-lg font-semibold text-o2-navy">{v}</div>
            </div>
          ))}
        </section>
      )}
      {mes && (
        <div className="flex flex-wrap gap-2 text-xs">
          {dif === null ? (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">sem boleto deste mês</span>
          ) : Math.abs(dif) <= TOLERANCIA_FATURA ? (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-800">boleto bate com as linhas</span>
          ) : (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800">boleto difere das linhas em {formatarReais(dif)}</span>
          )}
          {semDoc > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-800">{semDoc} linha(s) com apólice que não está no ERP</span>}
          {semExplicacao > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">{semExplicacao} saída(s) sem explicação</span>}
        </div>
      )}

      <details open={entradas.length > 0 && entradas.length <= 30} className="rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer px-4 py-2 text-sm font-semibold text-o2-navy">Entradas ({entradas.length})</summary>
        {entradas.length > 0 && <Tabela linhas={entradas} />}
      </details>

      <details open={saidas.length > 0} className="rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer px-4 py-2 text-sm font-semibold text-o2-navy">
          Saídas ({saidas.length}){semExplicacao ? <span className="ml-2 text-xs font-normal text-amber-700">{semExplicacao} sem explicação: a tratativa por e-mail da imobiliária, o card de renovação ou o endosso precisam dizer o motivo</span> : null}
        </summary>
        {saidas.length > 0 && (
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-1.5">Nº da apólice</th>
                <th className="px-3 py-1.5">Código O2 do documento</th>
                <th className="px-3 py-1.5">Cliente</th>
                <th className="px-3 py-1.5 text-right">Valor no mês anterior</th>
                <th className="px-3 py-1.5">Por que saiu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {saidas.map((s) => (
                <tr key={s.apolice}>
                  <td className="px-3 py-1">{s.apolice}</td>
                  <td className="px-3 py-1">
                    {s.documento_id ? (
                      <Link href={`/erp/documentos/${s.documento_id}`} className="text-o2-navy hover:underline">
                        {s.codigo_o2}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-1">{s.cliente ?? "—"}</td>
                  <td className="px-3 py-1 text-right">{formatarReais(s.valor_anterior)}</td>
                  <td className="px-3 py-1">
                    {s.registrado ? (
                      <span title={[s.registrado.observacao, s.registrado.referencia].filter(Boolean).join(" · ")}>
                        {s.registrado.motivo} <span className="text-gray-400">· {s.registrado.usuario_email?.split("@")[0]} {formatarData(s.registrado.criado_em)}</span>
                      </span>
                    ) : s.explicacao ? (
                      s.explicacao
                    ) : (
                      <form action={registrarMovimentacao} className="flex flex-wrap items-center gap-1">
                        <RascunhoAutomatico sufixo={`${id}-${mes?.competencia}-${s.apolice}`} />
                        <input type="hidden" name="fatura_id" value={id} />
                        <input type="hidden" name="competencia" value={mes?.competencia ?? ""} />
                        <input type="hidden" name="movimento" value="saida" />
                        <input type="hidden" name="apolice" value={s.apolice} />
                        <input type="hidden" name="documento_id" value={s.documento_id ?? ""} />
                        <select name="motivo" required defaultValue="" className="rounded border border-amber-300 px-1 py-0.5">
                          <option value="" disabled>sem explicação — motivo…</option>
                          {MOTIVOS.map((m) => (
                            <option key={m}>{m}</option>
                          ))}
                        </select>
                        <input name="referencia" placeholder="assunto do e-mail / nº do card" className="w-44 rounded border border-gray-300 px-1 py-0.5" />
                        <button className="rounded bg-o2-navy px-2 py-0.5 text-white">Registrar</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>

      <details className="rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer px-4 py-2 text-sm font-semibold text-o2-navy">Todas as linhas do mês ({linhas.length})</summary>
        <Tabela linhas={linhas} />
      </details>
    </main>
  );
}
