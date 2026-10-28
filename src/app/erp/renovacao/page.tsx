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

// ERP O2 — Renovação (Matheus 28/10/2026). Lista AGRUPADA de documentos VIGENTES por fim de vigência, para todos os produtos, já no desenho dos cards
// que serão criados: no ramo imobiliário 1 card por lote (imobiliária + seguradora); nos demais, 1 card por seguro. A conferência acontece aqui;
// só depois dela o sistema recebe a ordem de criar o card no funil do produto (Fiança SPA 1042 · Capitalização SPA 1048 · Automóvel SPA 1050 ·
// demais SPA 1046). Mesma lógica do robô de renovações dos ramos elementares. Nesta fase a tela é SÓ LEITURA: nada é criado no Bitrix.
type Doc = {
  documento_id: string; nosso_numero: number; numero_apolice: string | null; produto: string; ramo: string; seguradora: string | null;
  imobiliaria_id: string | null; imobiliaria: string | null; cliente_id: string | null; cliente: string | null; cliente_incompleto: boolean | null;
  vigencia_inicio: string | null; vigencia_fim: string; premio_liquido: number | null; comissao_pct: number | null; forma: string | null;
  destino: string; tipo_card: "lote" | "individual"; chave_card: string; status_renovacao: string | null; anexos: number;
};
type Card = { chave: string; tipo: "lote" | "individual"; titulo: string; destino: string; docs: Doc[]; fim: string; premio: number; comissaoMin: number | null };

const STATUS: Record<string, string> = { a_renovar: "A renovar", em_cotacao: "Em cotação", renovado: "Renovado", nao_renovado: "Não renovado", cancelado: "Cancelado" };
const mmaaaa = (iso: string) => `${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const isoData = (d: Date) => d.toISOString().slice(0, 10);

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

  const porChave = new Map<string, Card>();
  for (const d of docs) {
    let c = porChave.get(d.chave_card);
    if (!c) {
      const mes = mmaaaa(d.vigencia_fim);
      const titulo = d.tipo_card === "lote"
        ? `RENOVAÇÃO - ${d.imobiliaria ?? "SEM IMOBILIÁRIA"} - ${d.seguradora ?? "SEM SEGURADORA"} - ${mes}`
        : `RENOVAÇÃO - ${d.ramo} - ${d.cliente ?? "SEM CLIENTE"} - ${mes}`;
      c = { chave: d.chave_card, tipo: d.tipo_card, titulo, destino: d.destino, docs: [], fim: d.vigencia_fim, premio: 0, comissaoMin: null };
      porChave.set(d.chave_card, c);
    }
    c.docs.push(d);
    if (d.vigencia_fim < c.fim) c.fim = d.vigencia_fim;
    c.premio += Number(d.premio_liquido ?? 0);
    if (d.comissao_pct != null && Number(d.comissao_pct) > 0) c.comissaoMin = c.comissaoMin == null ? Number(d.comissao_pct) : Math.min(c.comissaoMin, Number(d.comissao_pct));
  }
  const cards = [...porChave.values()].sort((a, b) => a.fim.localeCompare(b.fim) || a.titulo.localeCompare(b.titulo));

  const porDestino = new Map<string, { cards: number; docs: number }>();
  for (const c of cards) {
    const x = porDestino.get(c.destino) ?? { cards: 0, docs: 0 };
    x.cards++; x.docs += c.docs.length;
    porDestino.set(c.destino, x);
  }
  const lotes = cards.filter((c) => c.tipo === "lote").length;

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-5 p-8">
      <PageHeader
        icon={<IconReport />}
        titulo="ERP O2 — Renovação"
        subtitulo="Documentos vigentes por fim de vigência, agrupados como serão os cards: um por lote (imobiliária + seguradora) no ramo imobiliário e um por seguro nos demais. Confira aqui; só depois da conferência o sistema cria o card no funil do produto."
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
            {docs.length.toLocaleString("pt-BR")} documento(s) vigente(s) · {cards.length.toLocaleString("pt-BR")} card(s) ({lotes} lote(s) imobiliária + seguradora)
            {truncado ? " · lista limitada a 4.000 documentos: afunile o período" : ""}
          </>
        }
      />

      <div className="flex flex-wrap gap-2 text-xs">
        {[...porDestino.entries()].map(([destino, x]) => (
          <span key={destino} className="rounded-full border border-gray-300 bg-white px-3 py-1 text-gray-700">
            {destino}: <strong>{x.cards}</strong> card(s) · {x.docs} doc(s)
          </span>
        ))}
      </div>

      {cards.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">Nenhum documento vigente com fim de vigência nesse período e filtros.</p>
      ) : (
        <div className="space-y-2">
          {cards.map((c) => {
            const semImob = c.docs.filter((d) => !d.imobiliaria_id).length;
            const semPremio = c.docs.filter((d) => !d.premio_liquido || Number(d.premio_liquido) <= 0).length;
            const incompletos = c.docs.filter((d) => d.cliente_incompleto).length;
            return (
              <details key={c.chave} className="rounded-xl border border-gray-200 bg-white">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-xs">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${c.tipo === "lote" ? "bg-o2-navy text-white" : "bg-gray-100 text-gray-700"}`}>{c.tipo === "lote" ? "LOTE" : "INDIVIDUAL"}</span>
                  <span className="min-w-[260px] flex-1 text-sm font-medium text-gray-900">{c.titulo}</span>
                  <span className="text-gray-500">{c.destino}</span>
                  <span>{c.docs.length} item(ns)</span>
                  <span>vence {formatarData(c.fim)}</span>
                  <span>prêmio líquido {formatarReais(c.premio)}</span>
                  <span>comissão {c.comissaoMin != null ? `${c.comissaoMin.toLocaleString("pt-BR")}%` : "—"}</span>
                  {semImob > 0 && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-800">{semImob} sem imobiliária</span>}
                  {semPremio > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">{semPremio} sem prêmio</span>}
                  {incompletos > 0 && <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-medium text-yellow-800">{incompletos} cliente(s) com cadastro incompleto</span>}
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
                          <td className="px-3 py-1.5">{d.cliente_id ? <Link href={`/erp/clientes/${d.cliente_id}`} className="hover:underline">{d.cliente}</Link> : <span className="text-gray-400">sem cliente</span>}</td>
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
            );
          })}
        </div>
      )}
      <p className="text-xs text-gray-500">
        Lista só de leitura: nenhum card é criado no Bitrix a partir daqui. Prêmio líquido conforme o Corp; a regra de prêmio total (líquido + IOF + adicional de fracionamento) vale na ficha do documento.
      </p>
    </main>
  );
}
