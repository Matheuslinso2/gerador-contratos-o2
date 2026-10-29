import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import EmailsDoDocumento from "./EmailsDoDocumento";
import CabecalhoDocumento from "../CabecalhoDocumento";
import { dataDoRepasse, repasseEhFixo, repassePorParcela } from "@/lib/erp/repasseParcelas";
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

// Aba Anexos do Corp (27/10/2026): arquivos trazidos pelo robô (scripts/robo-corp/anexos.ts),
// na mesma ordem e com o mesmo nome do Corp. Bucket privado: o servidor (já conferido que é
// da equipe O2) gera link assinado de 10 min para cada arquivo e para o recorte do tipo.
async function anexosDoCorp(nossoNumero: string) {
  const sb = createServiceClient();
  const { data } = await sb
    .from("corp_anexos")
    .select("ordem, nome, bytes, storage_path, visto_em, corp_anexos_tipos(tipo, imagem_path)")
    .eq("nosso_numero", nossoNumero)
    .order("ordem");
  const linhas = (data ?? []) as unknown as { ordem: number; nome: string; bytes: number | null; storage_path: string; visto_em: string; corp_anexos_tipos: { tipo: string | null; imagem_path: string } | null }[];
  if (!linhas.length) return [];
  const caminhos = [...new Set([...linhas.map((l) => l.storage_path), ...linhas.filter((l) => !l.corp_anexos_tipos?.tipo && l.corp_anexos_tipos).map((l) => l.corp_anexos_tipos!.imagem_path)])];
  const { data: assinados } = await sb.storage.from("corp-anexos").createSignedUrls(caminhos, 600);
  const url = new Map((assinados ?? []).map((a) => [a.path, a.signedUrl]));
  return linhas.map((l) => ({
    ordem: l.ordem,
    nome: l.nome,
    bytes: l.bytes,
    vistoEm: l.visto_em,
    tipo: l.corp_anexos_tipos?.tipo ?? null,
    tipoImagem: l.corp_anexos_tipos ? url.get(l.corp_anexos_tipos.imagem_path) ?? null : null,
    url: url.get(l.storage_path) ?? null,
  }));
}

const AVISO_VINCULO: Record<string, string> = {
  ok: "Endosso ligado à apólice.",
  dados: "Informe o Código O2 do documento da apólice.",
  nao_endosso: "Este documento é uma apólice, não um endosso.",
  nao_achou: "Não achei apólice (ou fatura) com esse Código O2 do documento.",
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

  // Parcelas que a própria seguradora avisou como não pagas (e-mails/relatórios de inadimplência): sem pagamento do cliente não há comissão nem repasse.
  const { data: inadBruta } = await supabase
    .from("erp_parcelas_inadimplencia")
    .select("parcela_n, vencimento_original, valor, data_comunicado, previsao_cancelamento")
    .eq("documento_id", id)
    .eq("situacao", "aberta")
    .order("vencimento_original");
  const avisadas = (inadBruta ?? []) as { parcela_n: number; vencimento_original: string; valor: number | string | null; data_comunicado: string; previsao_cancelamento: string | null }[];
  const avisoPorParcela = new Map(avisadas.filter((a) => a.parcela_n > 0).map((a) => [a.parcela_n, a]));
  const totalAvisado = avisadas.reduce((t, a) => t + Number(a.valor ?? 0), 0);
  const anexosCorp = d.nosso_numero_corp ? await anexosDoCorp(String(d.nosso_numero_corp)) : [];
  const totalParcelas = d.parcelas.reduce((s, p) => s + p.valor, 0);
  const totalComissao = d.parcelas.reduce((s, p) => s + p.comissao_prevista, 0);
  // demonstrativo: repasse previsto por parcela (parcelas iguais; fixo = 1 vez na 1ª parcela) e baixa real da grade do Corp
  const repasses = repassePorParcela(d.produtores, d.parcelas.length);
  const totalRepasse = Math.round(repasses.reduce((s, v) => s + v, 0) * 100) / 100;
  const temFixo = d.produtores.some(repasseEhFixo);
  const corpPorParcela = new Map<number, { recebida: number; pendente: number }>();
  for (const c of d.comissoes_corp) {
    if (c.parcela_n === null) continue;
    const x = corpPorParcela.get(c.parcela_n) ?? { recebida: 0, pendente: 0 };
    if (c.situacao === "recebida") x.recebida += 1; else x.pendente += 1;
    corpPorParcela.set(c.parcela_n, x);
  }
  // Repasse: PREVISÃO pela parcela (previsão de recebimento da comissão); CONFIRMAÇÃO só quando a comissão da parcela foi realmente recebida,
  // e então vale a data real do recebimento (dia 15 do mês seguinte a ele), não o vencimento. Parcela não paga pelo cliente nunca confirma.
  const recebidaEmPorParcela = new Map<number, string>();
  for (const c of d.comissoes_corp) {
    if (c.parcela_n === null || c.situacao !== "recebida" || !(c.valor > 0) || !c.data) continue;
    const ant = recebidaEmPorParcela.get(c.parcela_n);
    if (!ant || c.data > ant) recebidaEmPorParcela.set(c.parcela_n, c.data);
  }
  const recebidoCorp = d.comissoes_corp.filter((c) => c.situacao === "recebida").reduce((s, c) => s + c.valor, 0);
  const aReceberCorp = d.comissoes_corp.filter((c) => c.situacao !== "recebida").reduce((s, c) => s + c.valor, 0);
  // cabeçalho padrão (Matheus 28/10): titular = proprietário na Fiança; segurado/cliente nos demais produtos
  const fianca = d.produto === "fianca";
  const partesItens = d.itens.flatMap((i) => i.partes);
  const proprietarioItem = partesItens.find((p) => p.papel === "proprietario")?.nome ?? null;
  const inquilinoItem = partesItens.find((p) => p.papel === "locatario" || p.papel === "garantido")?.nome ?? null;
  const item1 = d.itens[0];
  const imovel = item1 ? [[item1.logradouro, item1.numero].filter(Boolean).join(", "), item1.complemento, [item1.cidade, item1.uf].filter(Boolean).join("/"), item1.cep ? "CEP " + item1.cep : null].filter(Boolean).join(" · ") || null : null;
  const imovelFinal = imovel ?? d.local_risco;
  const cabecalho = {
    tipo: d.tipo,
    tipo_corp: d.tipo_corp,
    situacao: d.situacao,
    modo_cobranca: d.modo_cobranca,
    nosso_numero: d.nosso_numero,
    nosso_numero_corp: d.nosso_numero_corp,
    numero_apolice: d.numero_apolice,
    titular: fianca ? d.partes_apolice.find((p) => p.papel === "segurado")?.nome ?? proprietarioItem : d.cliente,
    titularPapel: fianca ? "Proprietário (segurado e locador)" : "Segurado",
    produto_nome: d.produto_nome,
    seguradora_nome: d.seguradora_nome,
    vigencia_inicio: d.vigencia_inicio,
    vigencia_fim: d.vigencia_fim,
    inquilino: fianca ? d.partes_apolice.find((p) => p.papel === "garantido")?.nome ?? inquilinoItem ?? d.cliente : null,
    imovel: imovelFinal,
    extras: [
      ...(avisadas.length ? [{ texto: `${avisadas.length} parcela(s) em aberto na seguradora${totalAvisado > 0 ? " · " + formatarReais(totalAvisado) : ""}`, cor: "bg-red-100 text-red-800" }] : []),
      ...(d.revisao_pendente ? [{ texto: "pré-cadastro · revisão pendente", cor: "bg-orange-100 text-orange-800" }] : []),
      ...(d.fora_regra_pbi ? [{ texto: "fora da conta do Power BI", cor: "bg-yellow-100 text-yellow-800" }] : []),
      ...(d.congelado ? [{ texto: "mês fechado", cor: "bg-blue-50 text-blue-800" }] : []),
    ],
  };

  return (
    <>
      <main className="mx-auto w-full max-w-[1100px] flex-1 space-y-6 p-8">
        <div className="space-y-2">
          <Link href="/erp/documentos" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-o2-navy hover:underline">
            ← Documentos
          </Link>
          <CabecalhoDocumento c={cabecalho} />
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
          <span className="text-gray-500"> ({d.partes_apolice.length ? "cliente no Corp" : "segurado"})</span>
        </div>

        {/* botão "E-mails (n)": só equipe O2 (a página já confere acima); some quando não há e-mail nem PDF ligado ao documento */}
        <EmailsDoDocumento documentoId={d.id} codigoO2={String(d.nosso_numero)} />

        <nav className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
          <span className="text-[11px] uppercase tracking-wide text-gray-500">Anexos e vínculos:</span>
          <a href="#anexos-corp" className="rounded-full border border-gray-300 px-3 py-1 hover:bg-gray-50">Aba Anexos do Corp ({anexosCorp.length})</a>
          <a href="#anexos-acervo" className="rounded-full border border-gray-300 px-3 py-1 hover:bg-gray-50">Acervo de apólices ({d.anexos.length})</a>
          <a href="#origem-bitrix" className="rounded-full border border-gray-300 px-3 py-1 hover:bg-gray-50">Card do Bitrix ({d.origens.length})</a>
        </nav>

        {d.partes_apolice.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm">
            <div className="text-[11px] uppercase tracking-wide text-gray-500">Partes da apólice (lidas no PDF)</div>
            <div className="mt-1 grid gap-x-6 gap-y-1 md:grid-cols-2">
              {d.partes_apolice.map((p, i) => (
                <div key={`${p.papel}-${i}`}>
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">{p.papel === "segurado" ? "Segurado = locador = proprietário" : "Garantido = locatário"}: </span>
                  <span className="font-medium text-gray-800">{p.nome ?? "—"}</span>
                  {p.cpf ? <span className="text-gray-500"> · {p.cpf.length === 14 ? p.cpf.replace(/^(d{2})(d{3})(d{3})(d{4})(d{2})$/, "$1.$2.$3/$4-$5") : p.cpf.replace(/^(d{3})(d{3})(d{3})(d{2})$/, "$1.$2.$3-$4")}</span> : null}
                </div>
              ))}
            </div>
          </div>
        )}

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
            <Campo rotulo="Nº da apólice" valor={d.numero_apolice ?? "0 (não emitida)"} />
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
                      Código O2 do documento {f.nosso_numero}
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
                Código O2 do documento {d.apolice_mae.nosso_numero}
              </Link>
              {d.apolice_mae.numero_apolice ? ` · nº ${d.apolice_mae.numero_apolice}` : ""} · vigência {formatarData(d.apolice_mae.vigencia_inicio)} a {formatarData(d.apolice_mae.vigencia_fim)}
              {d.imobiliaria ? ` · imobiliária ${d.imobiliaria}` : ""}
            </p>
          )}
          {d.tipo !== "A" && d.tipo !== "F" && (
            <form action={ligarEndossoApolice} className="flex flex-wrap items-center gap-2 rounded-lg border border-orange-100 bg-orange-50/60 p-3 text-xs">
              <RascunhoAutomatico sufixo={d.id} />
              <input type="hidden" name="id" value={d.id} />
              <span className="font-medium text-gray-700">{d.apolice_mae ? "Corrigir a apólice deste endosso:" : "Endosso sem apólice ligada. Código O2 do documento da apólice:"}</span>
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
                          Código O2 do documento {e.nosso_numero}
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
          {d.parcelas.length > 0 && (
            <div className="grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-3 md:grid-cols-4">
              <Campo rotulo="Comissão já recebida (Corp)" valor={formatarReais(recebidoCorp)} />
              <Campo rotulo="Comissão a receber (Corp)" valor={d.comissoes_corp.length ? formatarReais(aReceberCorp) : "sem baixa do Corp"} />
              <Campo rotulo="Repasse previsto" valor={`${formatarReais(totalRepasse)}${temFixo ? " (inclui fixo)" : ""}`} />
              <Campo rotulo="Repasse já pago" valor="em breve (Nibo)" />
            </div>
          )}
          {avisadas.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
              <p className="font-semibold">A {d.seguradora_nome ?? "seguradora"} avisou que estas parcelas não foram pagas pelo cliente</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {avisadas.map((a, i) => (
                  <li key={i}>
                    Parcela {a.parcela_n > 0 ? a.parcela_n : "(número não informado)"} · vencimento {formatarData(a.vencimento_original)}
                    {a.valor !== null ? ` · ${formatarReais(Number(a.valor))}` : ""} · avisada em {formatarData(a.data_comunicado)}
                    {a.previsao_cancelamento ? ` · cancelamento previsto em ${formatarData(a.previsao_cancelamento)}` : ""}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-red-800">Sem pagamento do cliente não há comissão; o repasse só acontece depois que a comissão for recebida (competência do recebimento real).</p>
            </div>
          )}
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
                  <th className="py-1 pr-3 text-right">Repasse previsto</th>
                  <th className="py-1 pr-3">Previsão receb.</th>
                  <th className="py-1 pr-3">Repasse (previsto / confirmado)</th>
                  <th className="py-1 pr-3">Comissão no Corp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {d.parcelas.map((p, i) => (
                  <tr key={p.id}>
                    <td className="py-1 pr-3">
                      {p.n}
                      {avisoPorParcela.has(p.n) && <span className="ml-1 rounded bg-red-100 px-1 text-[10px] font-medium text-red-800" title="Avisada como não paga pela seguradora">em aberto na seguradora</span>}
                    </td>
                    <td className="py-1 pr-3">{formatarData(p.vencimento)}</td>
                    <td className="py-1 pr-3 text-right">{formatarReais(p.valor)}</td>
                    <td className="py-1 pr-3">{p.quitada_em ? `${formatarData(p.quitada_em)} · ${formatarReais(p.valor_quitado)}` : <span className="text-gray-400">em aberto</span>}</td>
                    <td className="py-1 pr-3 text-right">{formatarReais(p.comissao_prevista)}</td>
                    <td className="py-1 pr-3 text-right">{repasses[i] > 0 ? formatarReais(repasses[i]) : <span className="text-gray-300">—</span>}</td>
                    <td className="py-1 pr-3">{formatarData(p.comissao_previsao)}</td>
                    <td className="py-1 pr-3">{(() => {
                      if (!(repasses[i] > 0)) return <span className="text-gray-300">—</span>;
                      const real = recebidaEmPorParcela.get(p.n);
                      if (real && dataDoRepasse(real)) return <span className="font-medium text-green-700" title={"Comissão recebida em " + formatarData(real)}>confirmado · {formatarData(dataDoRepasse(real))}</span>;
                      const prev = dataDoRepasse(p.comissao_previsao);
                      if (!prev) return <span className="text-gray-300">—</span>;
                      return <span className="text-gray-500" title="Previsão: só se confirma quando a comissão for recebida">previsto · {formatarData(prev)}</span>;
                    })()}</td>
                    <td className="py-1 pr-3">{(() => { const c = corpPorParcela.get(p.n); return c ? (c.recebida > 0 && c.pendente === 0 ? "recebida" : "a receber") : <span className="text-gray-400">{p.comissao_status ?? "—"}</span>; })()}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1 pr-3" colSpan={2}>
                    Total
                  </td>
                  <td className="py-1 pr-3 text-right">{formatarReais(totalParcelas)}</td>
                  <td />
                  <td className="py-1 pr-3 text-right">{formatarReais(totalComissao)}</td>
                  <td className="py-1 pr-3 text-right">{formatarReais(totalRepasse)}</td>
                  <td colSpan={3} />
                </tr>
              </tbody>
            </table>
          )}
          {d.parcelas.length > 0 && (
            <p className="text-[11px] text-gray-500">
              Repasse: prêmio líquido × % de repasse × % de participação, em parcelas iguais (também no esgotamento); o repasse fixo é pago uma única vez, na 1ª parcela.
              Pago no dia 15 do mês seguinte ao do recebimento da comissão, antes do desconto de 18% do relatório de repasse. Comissão no Corp = grade de comissões do Corp (baixa real).
            </p>
          )}
          {d.parcelas_endossos.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                Parcelas dos endossos desta apólice — cobradas em paralelo às da apólice
              </div>
              <table className="w-full">
                <thead className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                  <tr><th className="py-1 pr-3">Endosso</th><th className="py-1 pr-3">Parcela</th><th className="py-1 pr-3">Vencimento</th><th className="py-1 pr-3 text-right">Valor</th><th className="py-1 pr-3">Quitação</th></tr>
                </thead>
                <tbody className="divide-y divide-amber-100">
                  {d.parcelas_endossos.map((p) => {
                    const e = d.endossos.find((x) => x.id === p.documento_id);
                    return (
                      <tr key={`${p.documento_id}-${p.n}`}>
                        <td className="py-1 pr-3"><Link href={`/erp/documentos/${p.documento_id}`} className="text-o2-navy hover:underline">Código O2 {e?.nosso_numero ?? "—"}</Link></td>
                        <td className="py-1 pr-3">{p.n}</td>
                        <td className="py-1 pr-3">{formatarData(p.vencimento)}</td>
                        <td className={`py-1 pr-3 text-right ${p.valor < 0 ? "text-red-700" : ""}`}>{formatarReais(p.valor)}</td>
                        <td className="py-1 pr-3">{p.quitada_em ? `${formatarData(p.quitada_em)} · ${formatarReais(p.valor_quitado)}` : <span className="text-gray-400">em aberto</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {d.apolice_mae && d.tipo === "C" && d.parcelas.length === 0 && (
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              Parcelas a informar: este endosso de cobrança ainda não tem parcelas. Elas nascem quando o card trouxer o valor do endosso, o nº de parcelas e o 1º vencimento.
              {" "}Apólice-mãe: <Link href={`/erp/documentos/${d.apolice_mae.id}`} className="font-medium underline">Código O2 {d.apolice_mae.nosso_numero}</Link>.
            </p>
          )}
          {d.parcelas.some((p) => p.origem === "estimada_corp") && (
            <p className="text-[11px] text-gray-500">
              Parcelas estimadas a partir do Corp (quantidade e prêmio total; vencimento = 30 dias + dia fixo da seguradora). A baixa real entra na Fase 2.
            </p>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 id="anexos-corp" className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Anexos (como no Corp)</h2>
          {!d.nosso_numero_corp ? (
            <p className="text-xs text-gray-500">Documento nascido no ERP: não tem aba Anexos no Corp.</p>
          ) : anexosCorp.length === 0 ? (
            <p className="text-xs text-gray-500">O robô ainda não trouxe a aba Anexos deste documento do Corp (ou ela está vazia).</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="w-8 py-1">#</th>
                  <th className="py-1">Arquivo</th>
                  <th className="py-1">Tipo</th>
                  <th className="py-1 text-right">Tamanho</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {anexosCorp.map((a) => (
                  <tr key={a.ordem}>
                    <td className="py-1.5 text-gray-400">{a.ordem}</td>
                    <td className="py-1.5 text-gray-900">{a.nome}</td>
                    <td className="py-1.5">
                      {a.tipo ?? (a.tipoImagem ? <img src={a.tipoImagem} alt="tipo como no Corp" className="h-[18px]" /> : "—")}
                    </td>
                    <td className="py-1.5 text-right text-gray-500">{a.bytes ? `${Math.max(1, Math.round(a.bytes / 1024))} KB` : "—"}</td>
                    <td className="py-1.5 text-right">
                      {a.url && (
                        <a href={a.url} target="_blank" rel="noreferrer" className="font-semibold text-o2-navy underline">
                          Abrir
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {anexosCorp.length > 0 && <p className="text-[11px] text-gray-400">Cópia da aba Anexos do Corp, trazida pelo robô em {formatarData(anexosCorp[0].vistoEm)}.</p>}
        </section>

        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 id="anexos-acervo" className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Anexos (acervo de apólices)</h2>
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
            <h2 id="origem-bitrix" className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Origem no Bitrix</h2>
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
            {(() => {
              // linha do tempo única do card (Matheus 29/10): etapas, comentários e eventos do documento, do mais antigo ao mais novo
              type Marco = { quando: string; tipo: "card" | "etapa" | "comentario" | "evento"; texto: string; destaque?: "ok" | "falha" };
              const marcos: Marco[] = [];
              if (o.card_criado_em) marcos.push({ quando: o.card_criado_em, tipo: "card", texto: "Card criado no Bitrix" });
              for (const h of o.historico_etapas) marcos.push({ quando: h.quando, tipo: "etapa", texto: h.etapa, destaque: h.semantica === "S" ? "ok" : h.semantica === "F" ? "falha" : undefined });
              for (const c of o.comentarios) marcos.push({ quando: c.quando, tipo: "comentario", texto: c.texto });
              for (const e of d.eventos) marcos.push({ quando: e.data, tipo: "evento", texto: `${e.tipo.replace(/_/g, " ")}${e.canal ? ` · ${e.canal}` : ""}${e.usuario_email ? ` · ${e.usuario_email}` : ""}` });
              marcos.sort((a, b) => String(a.quando).localeCompare(String(b.quando)));
              const bolinha = { card: "bg-gray-400", etapa: "bg-o2-navy", comentario: "bg-amber-500", evento: "bg-green-600" } as const;
              const exportar = marcos.map((m) => `${formatarData(m.quando)} · ${m.texto.replace(/\s+/g, " ")}`).join("\n");
              // datas-chave do card (reunião 29/10): criação, solicitação, negociação e efetivação
              const etapasOrd = [...o.historico_etapas].sort((a, b) => String(a.quando).localeCompare(String(b.quando)));
              const solicitacaoCampo = Object.entries(o.dados_legiveis).find(([k]) => /recebimento|solicita/i.test(k))?.[1];
              const negociacao = etapasOrd.find((h) => /negocia/i.test(h.etapa))?.quando ?? null;
              const efetivacao = etapasOrd.find((h) => h.semantica === "S")?.quando ?? d.dt_proposta ?? null;
              const solicitacao = etapasOrd[0]?.quando ?? (typeof solicitacaoCampo === "string" ? solicitacaoCampo : null);
              const datasChave: [string, string | null][] = [["Criação do card", o.card_criado_em], ["Solicitação", solicitacao], ["Negociação", negociacao], ["Efetivação", efetivacao]];
              return (
                <>
                <div className="grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-3 text-xs md:grid-cols-4">
                  {datasChave.map(([r, v]) => (
                    <div key={r}>
                      <div className="text-[11px] uppercase tracking-wide text-gray-500">{r}</div>
                      <div className="font-medium text-gray-800">{v ? formatarData(v) : "—"}</div>
                    </div>
                  ))}
                </div>
                <details className="rounded-lg border border-gray-200 text-xs" open={false}>
                  <summary className="cursor-pointer px-3 py-2 font-medium text-o2-navy">
                    Histórico do card — linha do tempo ({marcos.length} marcos: {o.historico_etapas.length} etapas, {o.comentarios.length} comentários, {d.eventos.length} eventos)
                  </summary>
                  <div className="space-y-2 border-t border-gray-100 p-3">
                    {o.comentarios_capturados_em === null && <p className="text-[11px] text-gray-500">Comentários do card ainda não capturados (entram nas próximas rodadas).</p>}
                    <ol className="relative max-h-96 space-y-2 overflow-y-auto border-l border-gray-200 pl-4">
                      {marcos.map((m, i) => (
                        <li key={i} className="relative">
                          <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${bolinha[m.tipo]}`} />
                          <span className="text-gray-500">{formatarData(m.quando)}</span>{" "}
                          {m.tipo === "comentario" ? <span className="whitespace-pre-wrap rounded bg-amber-50 px-1.5 py-0.5">{m.texto}</span> : <span className={m.destaque === "ok" ? "font-semibold text-green-700" : m.destaque === "falha" ? "font-semibold text-red-700" : m.tipo === "etapa" ? "font-medium" : ""}>{m.texto}{m.destaque === "ok" ? " ✓" : m.destaque === "falha" ? " ✗" : ""}</span>}
                        </li>
                      ))}
                    </ol>
                    <a href={"data:text/plain;charset=utf-8," + encodeURIComponent("Histórico do card " + o.item_id + " · " + (o.titulo ?? "") + "\n\n" + exportar)} download={`historico-card-${o.item_id}.txt`} className="inline-block rounded border border-gray-300 px-2 py-1 text-[11px] hover:bg-gray-50">Baixar tudo (.txt)</a>
                  </div>
                </details>
                </>
              );
            })()}
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
