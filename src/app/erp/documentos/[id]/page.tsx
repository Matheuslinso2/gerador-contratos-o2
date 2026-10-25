import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { formatarData, formatarReais } from "@/lib/sinistros/regras";
import RascunhoAutomatico from "@/components/RascunhoAutomatico";
import { ligarEndossoApolice } from "./actions";
import { buscarFichaDocumento, nomeTipoDocumento, SITUACOES, TIPOS_DOCUMENTO, TIPO_CORP, TIPO_CONTRATACAO, MODO_COBRANCA } from "@/lib/erp/documentos";

export const dynamic = "force-dynamic";

// ERP O2 — Fase 0: ficha do documento (só leitura), com as mesmas abas do
// "Controle de Documentos" do Corp: Documento · Produtores/Repasses · Parcelas
// e comissões · Anexos · Acompanhamento. Edição chega nas fases seguintes.

function Campo({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{rotulo}</div>
      <div className="text-sm text-gray-900">{valor ?? "—"}</div>
    </div>
  );
}

const AGENTE: Record<string, string> = { imob: "Imobiliária", parceiro: "Parceiro", pessoa: "Pessoa", canal: "Canal", marcador: "Marcador", o2: "O2 (venda direta)" };

export const metadata = { title: "Documento" };

const AVISO_VINCULO: Record<string, string> = {
  ok: "Endosso ligado à apólice.",
  dados: "Informe o Código O2 da apólice.",
  nao_endosso: "Este documento é uma apólice, não um endosso.",
  nao_achou: "Não achei apólice (ou fatura) com esse Código O2.",
  seguradora: "A apólice informada é de outra seguradora.",
  gravar: "Não consegui gravar; tente de novo.",
};

export default async function ErpDocumentoFichaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ vinculo?: string }> }) {
  const { id } = await params;
  const { vinculo } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const d = await buscarFichaDocumento(supabase, id);
  if (!d) redirect("/erp/documentos");

  // Decisão 2 do Matheus: equipe lê os dados do cliente, com registro de acesso.
  if (d.locatario_id && user?.email) {
    await supabase.from("erp_acesso_clientes_log").insert({ locatario_id: d.locatario_id, usuario_email: user.email, tela: "erp/documentos/ficha" });
  }

  const totalParcelas = d.parcelas.reduce((s, p) => s + p.valor, 0);
  const totalComissao = d.parcelas.reduce((s, p) => s + p.comissao_prevista, 0);

  return (
    <>
      <main className="mx-auto w-full max-w-[1100px] flex-1 space-y-6 p-8">
        <div className="space-y-2">
          <Link href="/erp/documentos" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-o2-navy hover:underline">
            ← Documentos
          </Link>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className={`rounded-md px-2.5 py-1 text-sm font-semibold uppercase tracking-wide ${nomeTipoDocumento(d.tipo, d.tipo_corp).cor}`}>{nomeTipoDocumento(d.tipo, d.tipo_corp).nome}</span>
            <h1 className="text-xl font-semibold text-o2-navy">
              Código O2 {d.nosso_numero} · {d.cliente ?? "cliente não ligado"}
            </h1>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">{SITUACOES[d.situacao] ?? d.situacao}</span>
            {d.revisao_pendente && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">pré-cadastro · revisão pendente</span>}
            {d.fora_regra_pbi && <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">fora da conta do Power BI</span>}
            {d.congelado && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-800">mês fechado</span>}
          </div>
          <p className="text-sm text-gray-500">
            {TIPOS_DOCUMENTO[d.tipo] ?? d.tipo} · {d.tipo_corp ? TIPO_CORP[d.tipo_corp] ?? d.tipo_corp : ""} · {d.seguradora} · {d.ramo} · {d.corretora}
            {d.nosso_numero_corp ? ` · nosso número no Corp ${d.nosso_numero_corp}` : " · nasceu no ERP"}
          </p>
        </div>

        <div className="rounded-xl border border-o2-navy/20 bg-blue-50/40 px-4 py-2 text-sm">
          <span className="text-[11px] uppercase tracking-wide text-gray-500">Cadeia da produção: </span>
          <span className={d.cadeia.canal ? "" : "text-gray-400"}>{d.cadeia.canal ?? "sem canal de gestão"}</span>
          <span className="text-gray-400"> → </span>
          <span className={d.cadeia.imobiliaria ? "" : "text-gray-400"}>
            {d.cadeia.imobiliaria ?? "sem imobiliária indicadora (venda direta)"}
            {d.cadeia.grupo ? <span className="text-gray-500"> (grupo {d.cadeia.grupo})</span> : null}
          </span>
          <span className="text-gray-400"> → </span>
          <span className={d.cadeia.cliente ? "font-medium" : "text-gray-400"}>{d.cadeia.cliente ?? "cliente não ligado"}</span>
          <span className="text-gray-500"> (segurado)</span>
        </div>

        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Documento</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="col-span-2 md:col-span-4">
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Imobiliária da produção</div>
              <div className="text-sm font-medium text-gray-800">
                {d.imobiliaria_id ? (
                  <Link href={`/erp/imobiliarias/${d.imobiliaria_id}`} className="text-o2-navy hover:underline">
                    {d.imobiliaria}
                  </Link>
                ) : (
                  <span className="text-gray-400">sem imobiliária ligada (venda direta ou a conferir)</span>
                )}
                {d.cadeia.grupo ? <span className="font-normal text-gray-500"> · grupo {d.cadeia.grupo}</span> : null}
              </div>
            </div>
            <Campo rotulo="Dt. proposta" valor={formatarData(d.dt_proposta)} />
            <Campo rotulo="Dt. emissão" valor={formatarData(d.dt_emissao)} />
            <Campo rotulo="Nº apólice" valor={d.numero_apolice ?? "0 (não emitida)"} />
            <Campo rotulo="Nº endosso / proposta" valor={`${d.numero_endosso ?? "0"} / ${d.numero_proposta ?? "—"}`} />
            <Campo rotulo="Vigência" valor={`${formatarData(d.vigencia_inicio)} a ${formatarData(d.vigencia_fim)}`} />
            <Campo rotulo="Competência" valor={formatarData(d.competencia)} />
            <Campo rotulo="Forma de pagamento" valor={d.forma_pagamento ?? "—"} />
            <Campo rotulo="Qtde de parcelas" valor={d.qtd_parcelas ?? "—"} />
            <Campo rotulo="Prêmio líquido" valor={formatarReais(d.premio_liquido)} />
            <Campo rotulo="Adicional / IOF" valor={`${formatarReais(d.premio_adicional)} / ${formatarReais(d.iof)}`} />
            <Campo rotulo="Prêmio total" valor={formatarReais(d.premio_total)} />
            <Campo rotulo="Comissão" valor={`${d.comissao_pct.toLocaleString("pt-BR")}% sobre ${d.comissao_base.replace("_", " ")} = ${formatarReais(d.comissao_valor)}`} />
            <Campo rotulo="Premiação" valor={formatarReais(d.premiacao_valor)} />
            <Campo rotulo="Canal de venda" valor={d.canal_venda ?? "—"} />
            <Campo rotulo="Tipo de contratação" valor={d.tipo_contratacao ? TIPO_CONTRATACAO[d.tipo_contratacao] ?? d.tipo_contratacao : "—"} />
            <Campo rotulo="Cobrança" valor={MODO_COBRANCA[d.modo_cobranca] ?? d.modo_cobranca} />
            <Campo rotulo="Cancelado em" valor={formatarData(d.cancelado_em)} />
            <Campo rotulo="Origem" valor={`${d.origem}${d.digitado_em ? ` · digitado ${formatarData(d.digitado_em)}` : ""}`} />
          </div>
          {d.familia.length > 1 && (
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs">
              <div className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">Família (corrente de renovações, como no Corp)</div>
              <ol className="space-y-0.5">
                {d.familia.map((f) => (
                  <li key={f.id} className={f.id === d.id ? "font-semibold text-o2-navy" : ""}>
                    {f.id === d.id ? "▶ " : "· "}
                    <Link href={`/erp/documentos/${f.id}`} className="hover:underline">
                      Código O2 {f.nosso_numero}
                    </Link>
                    {f.nosso_numero_corp ? ` (Corp ${f.nosso_numero_corp})` : ""} · {f.tipo_corp ? TIPO_CORP[f.tipo_corp] ?? f.tipo_corp : "—"} · {SITUACOES[f.situacao] ?? f.situacao} · {formatarData(f.vigencia_inicio)} a {formatarData(f.vigencia_fim)}
                    {f.numero_apolice ? ` · apólice ${f.numero_apolice}` : ""}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {d.familia.length <= 1 && (d.renovacao_de || d.renovado_por.length > 0) && (
            <p className="text-xs text-gray-600">
              {d.renovacao_de && (
                <>
                  Renovação do documento <Link className="underline" href={`/erp/documentos/${d.renovacao_de.id}`}>{d.renovacao_de.nosso_numero}</Link>.{" "}
                </>
              )}
              {d.renovado_por.map((r) => (
                <span key={r.id}>
                  Renovado pelo <Link className="underline" href={`/erp/documentos/${r.id}`}>{r.nosso_numero}</Link>.{" "}
                </span>
              ))}
            </p>
          )}
          {d.apolice_mae && (
            <p className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-gray-700">
              Endosso da apólice{" "}
              <Link className="font-semibold text-o2-navy underline" href={`/erp/documentos/${d.apolice_mae.id}`}>
                Código O2 {d.apolice_mae.nosso_numero}
              </Link>
              {d.apolice_mae.numero_apolice ? ` · nº ${d.apolice_mae.numero_apolice}` : ""} · vigência {formatarData(d.apolice_mae.vigencia_inicio)} a {formatarData(d.apolice_mae.vigencia_fim)}
              {d.imobiliaria ? ` · imobiliária ${d.imobiliaria}` : ""}
            </p>
          )}
          {d.tipo !== "A" && d.tipo !== "F" && (
            <form action={ligarEndossoApolice} className="flex flex-wrap items-center gap-2 rounded-lg border border-orange-100 bg-orange-50/60 p-3 text-xs">
              <RascunhoAutomatico sufixo={d.id} />
              <input type="hidden" name="id" value={d.id} />
              <span className="font-medium text-gray-700">{d.apolice_mae ? "Corrigir a apólice deste endosso:" : "Endosso sem apólice ligada. Código O2 da apólice:"}</span>
              <input name="codigo_o2" inputMode="numeric" placeholder="ex.: 200629" className="w-28 rounded border border-gray-300 px-2 py-1" />
              <button className="rounded bg-o2-navy px-3 py-1 text-white hover:bg-o2-indigo">Ligar</button>
              {vinculo && AVISO_VINCULO[vinculo] && <span className={vinculo === "ok" ? "text-green-700" : "text-red-700"}>{AVISO_VINCULO[vinculo]}</span>}
            </form>
          )}
          {d.endossos.length > 0 && (
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs">
              <div className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">
                Endossos desta apólice ({d.endossos.length}) · prêmio {formatarReais(d.endossos.reduce((s, e) => s + e.premio_liquido, 0))} · comissão{" "}
                {formatarReais(d.endossos.reduce((s, e) => s + e.comissao_valor, 0))}
              </div>
              <table className="w-full">
                <tbody className="divide-y divide-gray-200">
                  {d.endossos.map((e) => (
                    <tr key={e.id}>
                      <td className="py-1 pr-2">
                        <Link href={`/erp/documentos/${e.id}`} className="text-o2-navy hover:underline">
                          Código O2 {e.nosso_numero}
                        </Link>
                      </td>
                      <td className="py-1 pr-2">
                        {e.tipo} · {TIPOS_DOCUMENTO[e.tipo] ?? e.tipo}
                        {e.numero_endosso && e.numero_endosso !== "0" ? ` nº ${e.numero_endosso}` : ""}
                      </td>
                      <td className="py-1 pr-2 text-gray-500">{formatarData(e.vigencia_inicio ?? e.dt_emissao)}</td>
                      <td className={`py-1 pr-2 text-right ${e.premio_liquido < 0 ? "text-red-700" : ""}`}>{formatarReais(e.premio_liquido)}</td>
                      <td className={`py-1 text-right ${e.comissao_valor < 0 ? "text-red-700" : ""}`} title="Comissão do endosso (negativa = estorno descontado no extrato)">
                        {formatarReais(e.comissao_valor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {d.observacoes && <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-700">{d.observacoes}</p>}
        </section>

        {d.itens.length > 0 && (
          <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Imóvel, partes e coberturas</h2>
            {d.itens.map((it) => (
              <div key={it.id} className="space-y-2">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Campo rotulo="Imóvel" valor={[it.logradouro, it.numero, it.complemento].filter(Boolean).join(", ") || "—"} />
                  <Campo rotulo="Cidade / UF / CEP" valor={[it.cidade, it.uf, it.cep].filter(Boolean).join(" · ") || "—"} />
                  <Campo
                    rotulo="Tipo / plano / administração"
                    valor={[it.tipo_imovel, it.plano, it.administrado === true ? "administrado pela imob" : it.administrado === false ? "NÃO administrado (só intermediação)" : null].filter(Boolean).join(" · ") || "—"}
                  />
                  <Campo rotulo="Aluguel" valor={it.valor_aluguel === null ? "—" : formatarReais(it.valor_aluguel)} />
                </div>
                {it.partes.length > 0 && (
                  <p className="text-xs text-gray-700">
                    {it.partes.map((p) => `${p.papel} ${p.ordem}: ${p.nome ?? "—"}${p.documento_numero ? ` (${p.documento_numero})` : ""}`).join(" · ")}
                  </p>
                )}
                {it.coberturas.length > 0 && (
                  <p className="text-xs text-gray-700">
                    <span className="text-gray-500">Coberturas (verba mensal): </span>
                    {it.coberturas.map((c) => `${c.nome} ${c.importancia_segurada === null ? "" : formatarReais(c.importancia_segurada)}`).join(" · ")}
                  </p>
                )}
                {it.observacoes && <p className="text-[11px] text-gray-500">{it.observacoes}</p>}
              </div>
            ))}
          </section>
        )}

        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Produtores e repasse</h2>
          <table className="w-full text-xs">
            <thead className="text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="py-1 pr-3">Produtor no Corp</th>
                <th className="py-1 pr-3">Ficha (base única)</th>
                <th className="py-1 pr-3">Tipo</th>
                <th className="py-1 pr-3 text-right">Partic.</th>
                <th className="py-1 pr-3 text-right">Repasse negociado</th>
                <th className="py-1 pr-3 text-right">Esperado (ficha)</th>
                <th className="py-1 pr-3 text-right">Valor previsto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {d.produtores.map((p) => {
                const difere = p.repasse_pct_esperado !== null && Math.abs(p.repasse_pct_esperado - p.repasse_pct) >= 0.01;
                return (
                  <tr key={p.id}>
                    <td className="py-1.5 pr-3">
                      {p.produtor_corp_nome ?? "—"} {p.produtor_corp_codigo ? <span className="text-gray-400">({p.produtor_corp_codigo})</span> : null}
                      {p.principal && <span className="ml-1 rounded bg-o2-navy px-1 text-[10px] text-white">principal</span>}
                    </td>
                    <td className="py-1.5 pr-3">
                      {p.imobiliaria_id ? (
                        <Link href={`/admin/imobiliarias/${p.imobiliaria_id}`} className="hover:underline">
                          {p.imobiliaria}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3">{AGENTE[p.agente] ?? p.agente}</td>
                    <td className="py-1.5 pr-3 text-right">{p.pct_participacao.toLocaleString("pt-BR")}%</td>
                    <td className={`py-1.5 pr-3 text-right ${difere ? "font-semibold text-orange-700" : ""}`}>{p.repasse_pct.toLocaleString("pt-BR")}%</td>
                    <td className="py-1.5 pr-3 text-right text-gray-500">{p.repasse_pct_esperado === null ? "—" : `${p.repasse_pct_esperado.toLocaleString("pt-BR")}%`}</td>
                    <td className="py-1.5 pr-3 text-right">{formatarReais(p.repasse_valor_previsto)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-gray-500">
            Repasse negociado = o que o Corp registrou neste documento. Esperado = regra padrão da ficha da imobiliária (inferida do histórico; editável na ficha).
            Diferença em laranja.
          </p>
        </section>

        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Parcelas e comissões</h2>
          {d.parcelas.length === 0 ? (
            <p className="text-xs text-gray-500">Sem parcelas carregadas (histórico anterior a 2024 entra só com os totais).</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="py-1 pr-3">Nº</th>
                  <th className="py-1 pr-3">Vencimento</th>
                  <th className="py-1 pr-3 text-right">Valor da parcela</th>
                  <th className="py-1 pr-3">Quitação</th>
                  <th className="py-1 pr-3 text-right">Comissão prevista</th>
                  <th className="py-1 pr-3">Previsão receb.</th>
                  <th className="py-1 pr-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {d.parcelas.map((p) => (
                  <tr key={p.id}>
                    <td className="py-1 pr-3">{p.n}</td>
                    <td className="py-1 pr-3">{formatarData(p.vencimento)}</td>
                    <td className="py-1 pr-3 text-right">{formatarReais(p.valor)}</td>
                    <td className="py-1 pr-3">{p.quitada_em ? `${formatarData(p.quitada_em)} · ${formatarReais(p.valor_quitado)}` : <span className="text-gray-400">em aberto</span>}</td>
                    <td className="py-1 pr-3 text-right">{formatarReais(p.comissao_prevista)}</td>
                    <td className="py-1 pr-3">{formatarData(p.comissao_previsao)}</td>
                    <td className="py-1 pr-3">{p.comissao_status ?? "—"}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1 pr-3" colSpan={2}>
                    Total
                  </td>
                  <td className="py-1 pr-3 text-right">{formatarReais(totalParcelas)}</td>
                  <td />
                  <td className="py-1 pr-3 text-right">{formatarReais(totalComissao)}</td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          )}
          {d.parcelas.some((p) => p.origem === "estimada_corp") && (
            <p className="text-[11px] text-gray-500">
              Parcelas estimadas a partir do Corp (quantidade e prêmio total; vencimento = 30 dias + dia fixo da seguradora). A baixa real entra na Fase 2.
            </p>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Anexos (acervo de apólices)</h2>
          {d.anexos.length === 0 ? (
            <p className="text-xs text-gray-500">Nenhum PDF ligado a este documento no acervo ainda.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {d.anexos.map((a) => (
                <li key={a.id}>
                  📄 {a.arquivo_nome ?? "apólice"} <span className="text-gray-400">· {a.fonte} · apólice {a.numero_apolice ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {d.origens.map((o) => (
          <section key={o.id} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Origem no Bitrix</h2>
            <p className="text-xs text-gray-700">
              Card {o.item_id} · {o.titulo ?? "—"} · etapa {o.etapa_id ?? "—"} · criado {formatarData(o.card_criado_em)} · atualizado {formatarData(o.card_atualizado_em)}
              {o.url && (
                <>
                  {" "}
                  · <a href={o.url} target="_blank" rel="noreferrer" className="underline">abrir no Bitrix</a>
                </>
              )}
              <span className="text-gray-400"> · capturado {formatarData(o.capturado_em)} (uso interno; nada é escrito no card)</span>
            </p>
            {o.historico_etapas.length > 0 && (
              <div className="text-xs">
                <div className="text-[11px] uppercase tracking-wide text-gray-500">Trilha de etapas</div>
                <ul className="mt-1 space-y-0.5">
                  {o.historico_etapas.map((h, i) => (
                    <li key={i}>
                      {formatarData(h.quando)} · {h.etapa}
                      {h.semantica === "S" ? " ✓" : h.semantica === "F" ? " ✗" : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {o.comentarios.length > 0 ? (
              <div className="text-xs">
                <div className="text-[11px] uppercase tracking-wide text-gray-500">Comentários do card ({o.comentarios.length})</div>
                <ul className="mt-1 max-h-72 space-y-1 overflow-y-auto">
                  {o.comentarios.map((c, i) => (
                    <li key={i} className="rounded bg-gray-50 p-2">
                      <span className="text-gray-500">{formatarData(c.quando)}</span> · <span className="whitespace-pre-wrap">{c.texto}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-[11px] text-gray-500">Comentários do card ainda não capturados (entram nas próximas rodadas).</p>
            )}
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-600">Todos os campos preenchidos do card ({Object.keys(o.dados_legiveis).length})</summary>
              <table className="mt-2 w-full">
                <tbody className="divide-y divide-gray-100">
                  {Object.entries(o.dados_legiveis).map(([k, v]) => (
                    <tr key={k}>
                      <td className="py-0.5 pr-3 text-gray-500">{k}</td>
                      <td className="py-0.5">{Array.isArray(v) ? v.join(", ") : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>
        ))}

        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Acompanhamento</h2>
          {d.eventos.length === 0 ? (
            <p className="text-xs text-gray-500">Sem eventos registrados (emissão, envio ao cliente, entrega — chegam na Fase 4).</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {d.eventos.map((e) => (
                <li key={e.id}>
                  {formatarData(e.data)} · {e.tipo} {e.canal ? `· ${e.canal}` : ""} {e.destinatario ? `· ${e.destinatario}` : ""} {e.usuario_email ? `· ${e.usuario_email}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
