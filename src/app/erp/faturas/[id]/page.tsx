import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarData, formatarReais } from "@/lib/sinistros/regras";
import { fichaFatura, TOLERANCIA_FATURA, type LinhaFatura } from "@/lib/erp/faturaTela";
import RascunhoAutomatico from "@/components/RascunhoAutomatico";
import { registrarMovimentacao } from "./actions";
import BotaoVerDocumento from "../../BotaoVerDocumento";
import InfoLegenda from "@/components/InfoLegenda";
import PaginaErp from "../../PaginaErp";

const MOTIVOS = ["Entrega de chaves", "Fim de contrato", "Cancelamento a pedido", "Sinistro", "Litígio", "Troca de administradora", "Renovação em outra fatura", "Erro da seguradora", "Outro"];

export const dynamic = "force-dynamic";
export const metadata = { title: "Fatura" };

// Tela de UMA fatura (fase B, Matheus 26/10): navegação mês a mês, resumo (mês anterior + entradas − saídas = este mês),
// boleto × soma das linhas × comissão no extrato, e as abas Entradas · Saídas · Todas as linhas.
const mesBr = (c: string) => `${c.slice(5, 7)}/${c.slice(0, 4)}`;

function Tabela({ linhas }: { linhas: LinhaFatura[] }) {
  return (
    <table className="w-full text-xs">
      <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
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
  const { fatura, meses, mes, anterior, linhas, entradas, saidas, quitadasVigentes } = d;
  const imob = (fatura.imobiliaria as unknown as { nome: string } | null)?.nome ?? "—";
  const idx = mes ? meses.findIndex((m) => m.id === mes.id) : -1;
  const dif = mes && mes.valor_boleto !== null ? mes.valor_boleto - mes.valor_itens : null;
  const comissaoTotal = linhas.reduce((s, l) => s + (l.comissao_extrato ?? 0), 0);
  const semDoc = linhas.filter((l) => !l.documento_id).length;
  const semExplicacao = saidas.filter((s) => !s.explicacao).length;

  return (
    <PaginaErp>
      <div className="space-y-1">
        <Link href="/erp/faturas" className="text-sm text-gray-500 hover:text-o2-navy hover:underline">
          ← Faturas
        </Link>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold text-o2-navy">
            Fatura · {imob} · {fatura.seguradora} <span className="text-base font-normal text-gray-500">{fatura.chave}</span>
            <InfoLegenda titulo="Tela da fatura">
              Uma única fatura: o conjunto de apólices que a seguradora cobra da imobiliária num boleto (a fatura não tem apólice própria). Os botões com os meses navegam pelos meses carregados dos arquivos da seguradora. O resumo compara o mês com o mês anterior; abaixo ficam as entradas, as saídas e todas as linhas do mês.
            </InfoLegenda>
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
          {mes?.numero_fatura ? ` · Nº da fatura ${mes.numero_fatura}` : ""}
        </p>
      </div>

      {mes && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          {[
            ["Mês anterior", anterior ? String(anterior.qtd_itens) : "—", "Quantidade de apólices na fatura do mês anterior carregado, conforme o arquivo da seguradora. Mostra “—” quando não há mês anterior."],
            ["+ Entradas", String(entradas.length), "Quantas linhas deste mês têm um Nº da apólice que não estava na fatura do mês anterior. Sem mês anterior carregado, todas contam como entrada."],
            ["− Saídas", String(saidas.length), "Quantas apólices estavam na fatura do mês anterior e não aparecem neste mês. A lista de saídas abaixo diz o motivo de cada uma."],
            ["= Este mês", String(mes.qtd_itens), "Quantidade de apólices na fatura deste mês, conforme o arquivo da seguradora. É a contagem do arquivo, não uma conta feita a partir das caixas ao lado."],
            ["Boleto da seguradora", mes.valor_boleto === null ? "—" : formatarReais(mes.valor_boleto), "Valor do boleto da fatura deste mês, lido do arquivo da seguradora. Mostra “—” quando o arquivo não trouxe o valor."],
            ["Soma das linhas", formatarReais(mes.valor_itens), "Soma do valor cobrado de cada apólice na fatura deste mês. Deve bater com o boleto; a tolerância é de R$ 1,00."],
            ["Comissão no extrato", comissaoTotal ? formatarReais(comissaoTotal) : "—", "Soma da comissão que o extrato da seguradora trouxe para as apólices e parcelas das linhas deste mês. Só entram as linhas ligadas a um documento do ERP; mostra “—” quando não há comissão no extrato."],
          ].map(([r, v, info]) => (
            <div key={r} className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">
                {r}
                <InfoLegenda titulo={r}>{info}</InfoLegenda>
              </div>
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
          <InfoLegenda titulo="Conferência do mês">
            Resumo das conferências do mês. Boleto: “bate” quando o boleto e a soma das linhas diferem em até R$ 1,00; fora disso mostra a diferença; “sem boleto” quando o arquivo não trouxe o valor. Linhas com apólice que não está no ERP: o Nº da apólice da fatura não foi encontrado entre os documentos. Saídas sem explicação: apólices que saíram da fatura sem motivo conhecido nem registrado.
          </InfoLegenda>
        </div>
      )}

      <details open={entradas.length > 0 && entradas.length <= 30} className="rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer px-4 py-2 text-sm font-semibold text-o2-navy">
          Entradas ({entradas.length})
          <InfoLegenda titulo="Entradas">
            Linhas deste mês cujo Nº da apólice não estava na fatura do mês anterior. Nº da apólice: o da seguradora, com o endosso quando houver. Código O2 do documento: o documento correspondente no ERP (“não está no ERP” quando não foi encontrado). Parcela: número da parcela e total. Cobrado na fatura: valor da linha. Comissão no extrato: comissão que o extrato da seguradora trouxe para o mesmo documento e parcela (“—” quando não há). Situação: situação do documento no ERP.
          </InfoLegenda>
        </summary>
        {entradas.length > 0 && <Tabela linhas={entradas} />}
      </details>

      <details open={saidas.length > 0} className="rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer px-4 py-2 text-sm font-semibold text-o2-navy">
          Saídas ({saidas.length}){semExplicacao ? <span className="ml-2 text-xs font-normal text-amber-700">{semExplicacao} saíram com parcela em aberto sem sinistro nem endosso de cancelamento: investigar e registrar o motivo</span> : null}
          <InfoLegenda titulo="Saídas">
            Apólices que estavam na fatura do mês anterior e não estão neste mês. Regra: um documento só sai da fatura quitado (última parcela cobrada), com sinistro ou com endosso de cancelamento. O ERP explica sozinho quando acha um desses motivos (e também vigência encerrada, apólice cancelada ou mudança para outra forma de pagamento). Fora disso, a saída é pendência: saiu com parcela em aberto sem sinistro nem cancelamento; a equipe investiga e registra o motivo e a referência (assunto do e-mail ou número do card). Valor no mês anterior: o que a apólice pagava na fatura anterior.
          </InfoLegenda>
        </summary>
        {saidas.length > 0 && (
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
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
                          <option value="" disabled>parcela em aberto — motivo…</option>
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
        <summary className="cursor-pointer px-4 py-2 text-sm font-semibold text-o2-navy">
          Quitadas e ainda vigentes ({quitadasVigentes.length})
          <InfoLegenda titulo="Quitadas e ainda vigentes">
            Documentos que já passaram por esta fatura, estão quitados (última parcela já cobrada na fatura ou todas as parcelas com baixa no ERP) e não geram mais cobrança neste mês, mas continuam vigentes depois do fim do mês (sem cancelamento). Documento que saiu da fatura sem estar quitado aparece em Saídas. Servem para acompanhar a carteira até a renovação. Última cobrança: o último mês em que o documento apareceu na fatura e a parcela cobrada. Parcelas pagas: parcelas do documento com baixa no ERP sobre o total de parcelas. Fim da vigência: quando o documento precisa estar renovado. Ordenado pelo fim da vigência mais próximo.
          </InfoLegenda>
        </summary>
        {quitadasVigentes.length > 0 && (
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-1.5">Abrir</th>
                <th className="px-3 py-1.5">Nº da apólice</th>
                <th className="px-3 py-1.5">Código O2 do documento</th>
                <th className="px-3 py-1.5">Cliente</th>
                <th className="px-3 py-1.5">Última cobrança</th>
                <th className="px-3 py-1.5">Parcelas pagas</th>
                <th className="px-3 py-1.5">Fim da vigência</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {quitadasVigentes.map((q) => (
                <tr key={q.documento_id}>
                  <td className="px-3 py-1"><BotaoVerDocumento id={q.documento_id} /></td>
                  <td className="px-3 py-1">{q.apolice}</td>
                  <td className="px-3 py-1">
                    <Link href={`/erp/documentos/${q.documento_id}`} className="text-o2-navy hover:underline">{q.codigo_o2}</Link>
                  </td>
                  <td className="px-3 py-1">{q.cliente ?? "—"}</td>
                  <td className="px-3 py-1">{mesBr(q.ultima_competencia)}{q.ultima_parcela ? <span className="text-gray-400"> · parcela {q.ultima_parcela}</span> : null}</td>
                  <td className="px-3 py-1">{q.parcelas_total ? `${q.parcelas_pagas}/${q.parcelas_total}` : "—"}</td>
                  <td className="px-3 py-1">{q.vigencia_fim ? formatarData(q.vigencia_fim) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>

      <details className="rounded-xl border border-gray-200 bg-white">
        <summary className="cursor-pointer px-4 py-2 text-sm font-semibold text-o2-navy">
          Todas as linhas do mês ({linhas.length})
          <InfoLegenda titulo="Todas as linhas do mês">
            Todas as linhas da fatura neste mês, conforme o arquivo da seguradora, com as mesmas colunas de Entradas: Nº da apólice, Código O2 do documento, cliente, parcela, valor cobrado, comissão no extrato e situação do documento. A soma da coluna Cobrado na fatura é a Soma das linhas do resumo.
          </InfoLegenda>
        </summary>
        <Tabela linhas={linhas} />
      </details>
    </PaginaErp>
  );
}
