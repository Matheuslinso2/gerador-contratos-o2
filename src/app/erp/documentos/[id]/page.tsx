import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import AppHeader from "@/components/AppHeader";
import { formatarData, formatarReais } from "@/lib/sinistros/regras";
import { buscarFichaDocumento, SITUACOES, TIPOS_DOCUMENTO, TIPO_CORP } from "@/lib/erp/documentos";
import { signOut } from "../../../actions";

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

export default async function ErpDocumentoFichaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-[1100px] flex-1 space-y-6 p-8">
        <div className="space-y-2">
          <Link href="/erp/documentos" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-o2-navy hover:underline">
            ← Documentos
          </Link>
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="text-xl font-semibold text-o2-navy">
              {d.nosso_numero} · {d.cliente ?? "cliente não ligado"}
            </h1>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">{SITUACOES[d.situacao] ?? d.situacao}</span>
            {d.fora_regra_pbi && <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">fora da conta do Power BI</span>}
            {d.congelado && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-800">mês fechado</span>}
          </div>
          <p className="text-sm text-gray-500">
            {TIPOS_DOCUMENTO[d.tipo] ?? d.tipo} · {d.tipo_corp ? TIPO_CORP[d.tipo_corp] ?? d.tipo_corp : ""} · {d.seguradora} · {d.ramo} · {d.corretora}
            {d.nosso_numero_corp ? ` · Nosso Nº Corp ${d.nosso_numero_corp}` : ""}
          </p>
        </div>

        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Documento</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
            <Campo rotulo="Cancelado em" valor={formatarData(d.cancelado_em)} />
            <Campo rotulo="Origem" valor={`${d.origem}${d.digitado_em ? ` · digitado ${formatarData(d.digitado_em)}` : ""}`} />
          </div>
          {(d.renovacao_de || d.renovado_por.length > 0) && (
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
          {d.observacoes && <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-700">{d.observacoes}</p>}
        </section>

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
            <p className="text-xs text-gray-500">Nenhum PDF ligado a este Nosso Nº no acervo ainda.</p>
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
