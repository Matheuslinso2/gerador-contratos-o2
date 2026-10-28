import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import PageHeader from "@/components/PageHeader";
import { IconReport } from "@/components/icons";
import { formatarData, formatarReais } from "@/lib/sinistros/regras";
import { lerFiltros } from "@/lib/erp/filtros";
import FiltrosErp from "../FiltrosErp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Renovação" };

// ERP O2 — Renovação (Matheus 28/10/2026). PRÉVIA DE CRIAÇÃO DE CARDS: todas as apólices vigentes que vencem no período, já organizadas como serão os
// cards, em 5 blocos que seguem os funis (SPA) de destino: Seguro Fiança (SPA 1042) · Capitalização (SPA 1048) · Automóvel (SPA 1050) ·
// Ramos Elementares com lotes (SPA 1046: incêndio imobiliário, 1 card por imobiliária + seguradora, Segimob em lote separado como o robô de renovações RE) ·
// Ramos Elementares, demais produtos (SPA 1046: 1 card por apólice). O Matheus autoriza a criação bloco a bloco. NESTA FASE a tela é SÓ LEITURA:
// a autorização ainda não está ligada ao Bitrix e nada é criado.
type Doc = {
  documento_id: string; nosso_numero: number; numero_apolice: string | null; produto: string; ramo: string; seguradora: string | null;
  imobiliaria_id: string | null; imobiliaria: string | null; cliente_id: string | null; cliente: string | null; cliente_incompleto: boolean | null;
  vigencia_inicio: string | null; vigencia_fim: string; premio_liquido: number | null; comissao_pct: number | null; forma: string | null;
  destino: string; tipo_card: "lote" | "individual"; chave_card: string; status_renovacao: string | null; anexos: number;
};
type Extra = { corp: number | null; abrev: string; canais: string[] };
type BlocoId = "fianca" | "cap" | "auto" | "re_lotes" | "re_demais";
type Card = { chave: string; tipo: "lote" | "individual"; titulo: string; docs: Doc[]; fim: string; premio: number; comissaoMin: number | null; segimob: boolean; canais: string[] };

const BLOCOS: { id: BlocoId; titulo: string; funil: string; regra: string }[] = [
  { id: "fianca", titulo: "Renovações de Seguro Fiança", funil: "SPA 1042 · Renovação (cat. 32)", regra: "1 card por apólice" },
  { id: "cap", titulo: "Renovações de Capitalização", funil: "SPA 1048 · Reaplicações (cat. 38)", regra: "1 card por título (apólice)" },
  { id: "auto", titulo: "Renovações de Automóvel", funil: "SPA 1050 · Pipeline padrão (cat. 30)", regra: "1 card por apólice" },
  { id: "re_lotes", titulo: "Ramos Elementares — incêndio imobiliário em lotes", funil: "SPA 1046 · Renovações (cat. 34)", regra: "1 card por imobiliária + seguradora (lote); itens renovados pela Segimob ficam em lote separado (SEG/seguradora)" },
  { id: "re_demais", titulo: "Ramos Elementares — demais produtos", funil: "SPA 1046 · Renovações (cat. 34)", regra: "1 card por apólice (residencial, empresarial, condomínio, vida, portáteis, RC…)" },
];
const STATUS: Record<string, string> = { a_renovar: "A renovar", em_cotacao: "Em cotação", renovado: "Renovado", nao_renovado: "Não renovado", cancelado: "Cancelado" };
const NOME_SEG: Record<string, string> = { TOKI: "TOKIO", YELU: "YELLUM", PORT: "PORTO", ALLI: "ALLIANZ", ZURI: "ZURICH", ALF: "ALFA", BRAD: "BRADESCO" };
const mmaaaa = (iso: string) => `${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const isoData = (d: Date) => d.toISOString().slice(0, 10);
const nomeSeg = (s: string | null) => (s ? NOME_SEG[s] ?? s : "SEM SEGURADORA");
const lotes = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

function padraoMaisDois() {
  // ciclo do robô de renovações: dia 25 trata os vencimentos de M+2; a tela abre nesse mês (os filtros mudam)
  const hoje = new Date();
  const ini = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 2, 1));
  const fim = new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() + 1, 0));
  return { de: isoData(ini), ate: isoData(fim) };
}

export default async function ErpRenovacaoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f = lerFiltros(sp);
  const padrao = padraoMaisDois();
  const de = f.de ?? padrao.de;
  const ate = f.ate ?? padrao.ate;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const docs: Doc[] = [];
  for (let p = 0; p < 4; p++) {
    const { data, error } = await supabase
      .rpc("erp_renovacao_documentos", { p_de: de, p_ate: ate, p_produto: f.produto ?? null, p_seguradora: f.seguradora ?? null, p_imobiliaria: f.imobiliaria ?? null, p_busca: f.q ?? null })
      .range(p * 1000, p * 1000 + 999);
    if (error) throw new Error(`erp_renovacao_documentos: ${error.message}`);
    docs.push(...((data ?? []) as Doc[]));
    if ((data ?? []).length < 1000) break;
  }
  const truncado = docs.length >= 4000;

  // complementos por documento: Nosso nº do Corp, abreviação do ramo e canais (Segimob/Superlógica/Base Software/Sohtec) vindos dos produtores do Corp
  const extra = new Map<string, Extra>();
  const ids = docs.map((d) => d.documento_id);
  for (const l of lotes(ids, 120)) {
    const [{ data: dd }, { data: pp }] = await Promise.all([
      supabase.from("erp_documentos").select("id, nosso_numero_corp, ramo:erp_ramos(abreviacao)").in("id", l),
      supabase.from("erp_documento_produtores").select("documento_id, produtor_corp_nome").in("documento_id", l),
    ]);
    for (const x of (dd ?? []) as unknown as { id: string; nosso_numero_corp: number | null; ramo: { abreviacao: string } | { abreviacao: string }[] | null }[]) {
      const r = Array.isArray(x.ramo) ? x.ramo[0] : x.ramo;
      extra.set(x.id, { corp: x.nosso_numero_corp, abrev: r?.abreviacao ?? "", canais: [] });
    }
    for (const p of (pp ?? []) as { documento_id: string; produtor_corp_nome: string | null }[]) {
      const n = (p.produtor_corp_nome ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
      const canal = /^SEGIMOB/.test(n) ? "SEGIMOB" : /^SUPERLOGICA/.test(n) ? "SUPERLOGICA" : /^BASE SOFTWARE/.test(n) ? "BASE SOFTWARE" : /^SOHTEC/.test(n) ? "SOHTEC" : null;
      const e = extra.get(p.documento_id);
      if (canal && e && !e.canais.includes(canal)) e.canais.push(canal);
    }
  }

  const blocoDe = (d: Doc): BlocoId =>
    d.produto === "fianca" ? "fianca" : d.produto === "capitalizacao" ? "cap" : d.produto === "automovel" ? "auto" : d.tipo_card === "lote" ? "re_lotes" : "re_demais";

  const porChave = new Map<string, Card & { bloco: BlocoId }>();
  for (const d of docs) {
    const ex = extra.get(d.documento_id);
    const bloco = blocoDe(d);
    const segimob = bloco === "re_lotes" && !!ex?.canais.includes("SEGIMOB");
    const chaveCard = d.chave_card + (segimob ? "|SEG" : "");
    let c = porChave.get(chaveCard);
    if (!c) {
      const mes = mmaaaa(d.vigencia_fim);
      const cli = d.cliente ?? "SEM CLIENTE";
      const imob = d.imobiliaria;
      const titulo =
        bloco === "re_lotes" ? `RENOVAÇÃO - ${imob ?? "SEM IMOBILIÁRIA"} - ${segimob ? "SEG/" : ""}${nomeSeg(d.seguradora)} - ${mes}`
        : bloco === "fianca" ? `${cli}${imob ? ` - ${imob}` : ""}`
        : bloco === "cap" ? `VENCE ${formatarData(d.vigencia_fim)} | ${cli} | CORP ${ex?.corp ?? d.nosso_numero}`
        : bloco === "auto" ? `RENOVAÇÃO - ${cli}`
        : `RENOVAÇÃO - ${ex?.abrev || d.ramo} - ${cli}${imob && !cli.toUpperCase().startsWith(imob.toUpperCase().slice(0, 12)) ? ` - ${imob}` : ""} - ${mes}`;
      c = { chave: chaveCard, tipo: d.tipo_card, titulo, docs: [], fim: d.vigencia_fim, premio: 0, comissaoMin: null, segimob, canais: [], bloco };
      porChave.set(chaveCard, c);
    }
    c.docs.push(d);
    for (const k of ex?.canais ?? []) if (!c.canais.includes(k)) c.canais.push(k);
    if (d.vigencia_fim < c.fim) c.fim = d.vigencia_fim;
    c.premio += Number(d.premio_liquido ?? 0);
    if (d.comissao_pct != null && Number(d.comissao_pct) > 0) c.comissaoMin = c.comissaoMin == null ? Number(d.comissao_pct) : Math.min(c.comissaoMin, Number(d.comissao_pct));
  }
  const cards = [...porChave.values()].sort((a, b) => a.fim.localeCompare(b.fim) || a.titulo.localeCompare(b.titulo));

  // atalhos de mês: o mês atual +1 até +4
  const hoje = new Date();
  const atalhos = [1, 2, 3, 4].map((n) => {
    const ini = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + n, 1));
    const fim = new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() + 1, 0));
    return { rotulo: ini.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }), de: isoData(ini), ate: isoData(fim) };
  });
  const base = new URLSearchParams();
  for (const k of ["q", "seguradora", "produto", "imobiliaria"] as const) if (sp[k] && typeof sp[k] === "string") base.set(k, sp[k] as string);

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-5 p-8">
      <PageHeader
        icon={<IconReport />}
        titulo="ERP O2 — Renovação"
        subtitulo="Prévia dos cards de renovação: todas as apólices vigentes que vencem no período, organizadas em um bloco por funil. A criação dos cards será autorizada bloco a bloco aqui."
      />

      <FiltrosErp
        caminho="/erp/renovacao"
        campos={["busca", "seguradora", "produto", "imobiliaria", "periodo"]}
        valores={{ ...f, de, ate }}
        rotuloBusca="Cliente ou nº da apólice"
        placeholderBusca="Nome do cliente · Nº da apólice · Código O2 do documento · Nosso nº do Corp"
        rotuloPeriodo="Fim de vigência"
        resumo={
          <>
            {docs.length.toLocaleString("pt-BR")} apólice(s) vigente(s) · {cards.length.toLocaleString("pt-BR")} card(s) a criar
            {truncado ? " · lista limitada a 4.000 documentos: afunile o período" : ""}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-500">Vencimento em:</span>
        {atalhos.map((a) => {
          const q = new URLSearchParams(base);
          q.set("de", a.de); q.set("ate", a.ate);
          const ativo = a.de === de && a.ate === ate;
          return (
            <Link key={a.de} href={`/erp/renovacao?${q.toString()}`} className={`rounded-full border px-3 py-1 capitalize ${ativo ? "border-o2-navy bg-o2-navy text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}>
              {a.rotulo}
            </Link>
          );
        })}
      </div>

      {cards.length === 0 && <p className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">Nenhuma apólice vigente com fim de vigência nesse período e filtros.</p>}

      {BLOCOS.map((b) => {
        const lista = cards.filter((c) => c.bloco === b.id);
        if (!lista.length) return null;
        const nDocs = lista.reduce((s, c) => s + c.docs.length, 0);
        const todos = lista.flatMap((c) => c.docs);
        const semImob = todos.filter((d) => !d.imobiliaria_id).length;
        const semPremio = todos.filter((d) => !d.premio_liquido || Number(d.premio_liquido) <= 0).length;
        const incompletos = todos.filter((d) => d.cliente_incompleto).length;
        const semNumero = todos.filter((d) => !d.numero_apolice || !/[1-9]/.test(d.numero_apolice)).length;
        const jaRenov = todos.filter((d) => d.status_renovacao && d.status_renovacao !== "a_renovar").length;
        const premio = lista.reduce((s, c) => s + c.premio, 0);
        const segCards = lista.filter((c) => c.segimob).length;
        return (
          <section key={b.id} className="space-y-2 rounded-2xl border border-gray-200 bg-gray-50/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-[280px] flex-1">
                <h2 className="text-base font-semibold text-gray-900">{b.titulo}</h2>
                <p className="text-xs text-gray-500">Destino: {b.funil} · {b.regra}</p>
                <p className="mt-1 text-sm text-gray-800">
                  <strong>{lista.length}</strong> card(s) · <strong>{nDocs}</strong> apólice(s) · prêmio líquido {formatarReais(premio)}
                  {segCards > 0 && <> · {segCards} lote(s) Segimob</>}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {semImob > 0 && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-800">{semImob} sem imobiliária{b.id === "re_demais" ? " (venda direta O2)" : ""}</span>}
                  {semPremio > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">{semPremio} sem prêmio</span>}
                  {semNumero > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">{semNumero} sem Nº da apólice</span>}
                  {incompletos > 0 && <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-medium text-yellow-800">{incompletos} cliente(s) com cadastro incompleto</span>}
                  {jaRenov > 0 && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-800">{jaRenov} já em andamento/renovada(s)</span>}
                </div>
              </div>
              <div className="text-right">
                <button type="button" disabled title="A criação no Bitrix ainda não está ligada. Nesta fase a tela só mostra a prévia." className="cursor-not-allowed rounded-lg bg-gray-300 px-4 py-2 text-sm font-semibold text-white">
                  Autorizar criação dos {lista.length} card(s)
                </button>
                <p className="mt-1 max-w-[260px] text-[11px] text-gray-500">Autorização ainda não ligada ao Bitrix: nada é criado a partir desta tela.</p>
              </div>
            </div>

            <div className="space-y-2">
              {lista.map((c) => (
                <details key={c.chave} className="rounded-xl border border-gray-200 bg-white">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-xs">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${c.tipo === "lote" ? "bg-o2-navy text-white" : "bg-gray-100 text-gray-700"}`}>{c.tipo === "lote" ? "LOTE" : "INDIVIDUAL"}</span>
                    {c.segimob && <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[11px] font-semibold text-purple-800">SEGIMOB</span>}
                    {!c.segimob && c.canais.filter((k) => k !== "SEGIMOB").map((k) => <span key={k} className="rounded bg-purple-50 px-1.5 py-0.5 text-[11px] font-medium text-purple-700">{k}</span>)}
                    <span className="min-w-[260px] flex-1 text-sm font-medium text-gray-900">{c.titulo}</span>
                    <span>{c.docs.length} item(ns)</span>
                    <span>vence {formatarData(c.fim)}</span>
                    <span>prêmio líquido {formatarReais(c.premio)}</span>
                    <span>comissão {c.comissaoMin != null ? `${c.comissaoMin.toLocaleString("pt-BR")}%` : "—"}</span>
                  </summary>
                  <div className="overflow-x-auto border-t border-gray-100">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="px-3 py-2">Código O2 do documento</th>
                          <th className="px-3 py-2">Nº da apólice</th>
                          <th className="px-3 py-2">Cliente</th>
                          <th className="px-3 py-2">Imobiliária</th>
                          <th className="px-3 py-2">Seg.</th>
                          <th className="px-3 py-2">Ramo</th>
                          <th className="px-3 py-2">Fim vig.</th>
                          <th className="px-3 py-2 text-right">Pr. líquido</th>
                          <th className="px-3 py-2 text-right">Com. %</th>
                          <th className="px-3 py-2">Renovação</th>
                          <th className="px-3 py-2 text-right">Anexos</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {c.docs.map((d) => (
                          <tr key={d.documento_id} className="hover:bg-gray-50">
                            <td className="px-3 py-1.5 font-medium"><Link href={`/erp/documentos/${d.documento_id}`} className="text-o2-navy hover:underline">{d.nosso_numero}</Link></td>
                            <td className="px-3 py-1.5">{d.numero_apolice ?? <span className="text-gray-300">0</span>}</td>
                            <td className="px-3 py-1.5">
                              {d.cliente_id ? <Link href={`/erp/clientes/${d.cliente_id}`} className="hover:underline">{d.cliente}</Link> : <span className="text-gray-400">sem cliente</span>}
                              {d.cliente_incompleto && <span className="ml-1 rounded bg-yellow-100 px-1 text-[10px] text-yellow-800">cadastro incompleto</span>}
                            </td>
                            <td className="px-3 py-1.5">{d.imobiliaria ?? <span className="text-gray-400">—</span>}</td>
                            <td className="px-3 py-1.5">{d.seguradora ?? "—"}</td>
                            <td className="px-3 py-1.5">{d.ramo}</td>
                            <td className="px-3 py-1.5">{formatarData(d.vigencia_fim)}</td>
                            <td className="px-3 py-1.5 text-right">{formatarReais(d.premio_liquido)}</td>
                            <td className="px-3 py-1.5 text-right">{d.comissao_pct != null ? Number(d.comissao_pct).toLocaleString("pt-BR") : "—"}</td>
                            <td className="px-3 py-1.5">{d.status_renovacao ? STATUS[d.status_renovacao] ?? d.status_renovacao : "—"}</td>
                            <td className="px-3 py-1.5 text-right">{d.anexos > 0 ? d.anexos : <span className="text-gray-300">0</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))}
            </div>
          </section>
        );
      })}

      <p className="text-xs text-gray-500">
        Só entram apólices vigentes (propostas ainda digitadas não aparecem). Prêmio líquido conforme o Corp; a regra de prêmio total (líquido + IOF + adicional de fracionamento) vale na ficha do documento.
        Os títulos de Fiança, Capitalização e Automóvel seguem o padrão dos cards já existentes em cada funil e ainda precisam ser confirmados.
      </p>
    </main>
  );
}
