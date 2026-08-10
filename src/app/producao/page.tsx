import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import { RAMOS_PRODUCAO, rotuloRamo } from "@/lib/producaoRamos";

export const dynamic = "force-dynamic";

const MESES_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

function formatarCompetencia(competencia: string): string {
  const [ano, mes] = competencia.split("-");
  const nomeMes = MESES_PT[Number(mes) - 1];
  return nomeMes ? `${nomeMes}/${ano}` : competencia;
}

function fmtMoeda(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtNumero(v: number): string {
  return v.toLocaleString("pt-BR");
}

type LinhaMensal = { ramo: string; competencia: string; tipo: string; quantidade: number; premio_total: number; comissao_corretora: number };
type LinhaSeguradora = { seguradora: string; ramo: string; quantidade: number; premio_total: number };
type LinhaBairro = { ramo: string; bairro: string; cidade: string | null; uf: string | null; quantidade: number; premio_total: number; aluguel_soma: number; aluguel_quantidade: number };
type LinhaClientesRamo = { ramo: string; clientes_distintos: number };
type LinhaCruzamento = { ramo_a: string; ramo_b: string; clientes_em_comum: number };
type LinhaCrossSell = { total_clientes_imobiliario: number; clientes_imobiliario_com_auto: number };
type LinhaDispersao = {
  ramo: string;
  quantidade: number;
  media: number;
  mediana: number;
  desvio_padrao: number;
  minimo: number;
  maximo: number;
  q1: number;
  q3: number;
  coeficiente_variacao: number;
};

const TAMANHO_PAGINA = 1000;

// O Supabase devolve no máximo 1000 linhas por consulta sem paginação
// explícita -- as tabelas-resumo são pequenas hoje, mas "por bairro" pode
// crescer bastante conforme mais relatórios de endereço forem entrando.
async function buscarTudo<T>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tabela: string,
  colunas: string
): Promise<T[]> {
  const linhas: T[] = [];
  let inicio = 0;
  for (;;) {
    const { data } = await supabase.from(tabela).select(colunas).range(inicio, inicio + TAMANHO_PAGINA - 1);
    linhas.push(...((data ?? []) as T[]));
    if (!data || data.length < TAMANHO_PAGINA) break;
    inicio += TAMANHO_PAGINA;
  }
  return linhas;
}

export default async function ProducaoPage({
  searchParams,
}: {
  searchParams: Promise<{ ramo?: string }>;
}) {
  const { ramo: ramoParam } = await searchParams;
  const ramoSelecionado = ramoParam && RAMOS_PRODUCAO.some((r) => r.valor === ramoParam) ? ramoParam : "";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const [mensal, seguradoras, bairros, clientesRamo, cruzamento, crossSellLinhas, dispersao] = await Promise.all([
    buscarTudo<LinhaMensal>(supabase, "producao_resumo_mensal", "ramo, competencia, tipo, quantidade, premio_total, comissao_corretora"),
    buscarTudo<LinhaSeguradora>(supabase, "producao_resumo_seguradora", "seguradora, ramo, quantidade, premio_total"),
    buscarTudo<LinhaBairro>(supabase, "producao_resumo_bairro", "ramo, bairro, cidade, uf, quantidade, premio_total, aluguel_soma, aluguel_quantidade"),
    buscarTudo<LinhaClientesRamo>(supabase, "producao_resumo_clientes_ramo", "ramo, clientes_distintos"),
    buscarTudo<LinhaCruzamento>(supabase, "producao_resumo_cruzamento", "ramo_a, ramo_b, clientes_em_comum"),
    buscarTudo<LinhaCrossSell>(supabase, "producao_resumo_cross_sell", "total_clientes_imobiliario, clientes_imobiliario_com_auto"),
    buscarTudo<LinhaDispersao>(
      supabase,
      "producao_resumo_dispersao",
      "ramo, quantidade, media, mediana, desvio_padrao, minimo, maximo, q1, q3, coeficiente_variacao"
    ),
  ]);
  const crossSell = crossSellLinhas[0] ?? null;
  const dispersaoOrdenada = [...dispersao].sort((a, b) => b.coeficiente_variacao - a.coeficiente_variacao);

  const semDadoNenhum = !mensal.length && !seguradoras.length;

  // Contagem por ramo (pra badge nas abas) -- soma direto do resumo mensal,
  // tabela pequena, não é reprocessar a base bruta.
  const quantidadePorRamo = new Map<string, number>();
  for (const l of mensal) quantidadePorRamo.set(l.ramo, (quantidadePorRamo.get(l.ramo) ?? 0) + l.quantidade);

  const mensalFiltrado = ramoSelecionado ? mensal.filter((l) => l.ramo === ramoSelecionado) : mensal;
  const seguradorasFiltrado = ramoSelecionado ? seguradoras.filter((l) => l.ramo === ramoSelecionado) : seguradoras;

  // --- Cards do topo ---
  const totalApolices = mensalFiltrado.reduce((s, l) => s + l.quantidade, 0);
  const totalPremio = mensalFiltrado.reduce((s, l) => s + l.premio_total, 0);
  const totalComissao = mensalFiltrado.reduce((s, l) => s + l.comissao_corretora, 0);
  const totalNovo = mensalFiltrado.filter((l) => l.tipo === "NOVO").reduce((s, l) => s + l.quantidade, 0);
  const totalRenovacao = mensalFiltrado.filter((l) => l.tipo === "RENV").reduce((s, l) => s + l.quantidade, 0);

  // --- Evolução mensal (soma NOVO+RENV por competência) ---
  const porCompetencia = new Map<string, { quantidade: number; premio_total: number }>();
  for (const l of mensalFiltrado) {
    const atual = porCompetencia.get(l.competencia) ?? { quantidade: 0, premio_total: 0 };
    atual.quantidade += l.quantidade;
    atual.premio_total += l.premio_total;
    porCompetencia.set(l.competencia, atual);
  }
  const evolucaoMensal = Array.from(porCompetencia.entries())
    .map(([competencia, v]) => ({ competencia, ...v }))
    .sort((a, b) => a.competencia.localeCompare(b.competencia))
    .slice(-18); // últimos 18 meses, senão fica ilegível
  const maiorPremioMes = Math.max(1, ...evolucaoMensal.map((m) => m.premio_total));

  // --- Painel secundário: ticket médio por ramo (visão "Todos") ou
  // Novo x Renovação do ramo selecionado -- comparação de mercado, não de
  // produtor/imobiliária (isso já é acompanhado no Power BI/ERP).
  const porRamo = new Map<string, { quantidade: number; premio_total: number }>();
  for (const l of mensal) {
    const atual = porRamo.get(l.ramo) ?? { quantidade: 0, premio_total: 0 };
    atual.quantidade += l.quantidade;
    atual.premio_total += l.premio_total;
    porRamo.set(l.ramo, atual);
  }
  const ticketPorRamo = Array.from(porRamo.entries())
    .map(([ramo, v]) => ({ ramo, ticket_medio: v.quantidade ? v.premio_total / v.quantidade : 0, quantidade: v.quantidade }))
    .sort((a, b) => b.ticket_medio - a.ticket_medio);
  const maiorTicketRamo = Math.max(1, ...ticketPorRamo.map((r) => r.ticket_medio));

  // --- Participação no prêmio total por ramo ("fatia do bolo") -- sempre
  // sobre a base inteira (não filtrada), é a visão de mix de produto. ---
  const totalPremioGeral = Array.from(porRamo.values()).reduce((s, r) => s + r.premio_total, 0);
  const participacaoPorRamo = Array.from(porRamo.entries())
    .map(([ramo, v]) => ({
      ramo,
      premio_total: v.premio_total,
      quantidade: v.quantidade,
      percentual: totalPremioGeral ? (v.premio_total / totalPremioGeral) * 100 : 0,
    }))
    .sort((a, b) => b.percentual - a.percentual);

  // --- Cross-sell: taxa de anexação com Automóvel + cesta de produtos ---
  const attachRateAuto = crossSell && crossSell.total_clientes_imobiliario
    ? (crossSell.clientes_imobiliario_com_auto / crossSell.total_clientes_imobiliario) * 100
    : null;
  const cestaProdutos = cruzamento
    .filter((c) => c.clientes_em_comum > 0)
    .sort((a, b) => b.clientes_em_comum - a.clientes_em_comum)
    .slice(0, 8);
  const maiorCruzamento = Math.max(1, ...cestaProdutos.map((c) => c.clientes_em_comum));

  const novoVsRenovacao = ["NOVO", "RENV"].map((tipo) => {
    const linhas = mensalFiltrado.filter((l) => l.tipo === tipo);
    const quantidade = linhas.reduce((s, l) => s + l.quantidade, 0);
    const premio = linhas.reduce((s, l) => s + l.premio_total, 0);
    return { tipo, quantidade, premio_total: premio, ticket_medio: quantidade ? premio / quantidade : 0 };
  });
  const maiorPremioTipo = Math.max(1, ...novoVsRenovacao.map((t) => t.premio_total));

  // --- Mix por seguradora (agrega ramos se "Todos") ---
  const porSeguradora = new Map<string, { quantidade: number; premio_total: number }>();
  for (const l of seguradorasFiltrado) {
    const atual = porSeguradora.get(l.seguradora) ?? { quantidade: 0, premio_total: 0 };
    atual.quantidade += l.quantidade;
    atual.premio_total += l.premio_total;
    porSeguradora.set(l.seguradora, atual);
  }
  const mixSeguradoras = Array.from(porSeguradora.entries())
    .map(([seguradora, v]) => ({ seguradora, ...v }))
    .sort((a, b) => b.premio_total - a.premio_total);
  const maiorPremioSeguradora = Math.max(1, ...mixSeguradoras.map((s) => s.premio_total));

  // --- Por bairro (mercado) -- top bairros por volume + ticket médio de
  // aluguel onde existir (só Fiança tem cobertura de aluguel). ---
  const bairrosFiltrado = ramoSelecionado ? bairros.filter((b) => b.ramo === ramoSelecionado) : bairros;
  const porBairro = new Map<string, { bairro: string; cidade: string | null; uf: string | null; quantidade: number; premio_total: number; aluguel_soma: number; aluguel_quantidade: number }>();
  for (const b of bairrosFiltrado) {
    const chave = `${b.bairro}|${b.cidade ?? ""}`;
    const atual = porBairro.get(chave) ?? { bairro: b.bairro, cidade: b.cidade, uf: b.uf, quantidade: 0, premio_total: 0, aluguel_soma: 0, aluguel_quantidade: 0 };
    atual.quantidade += b.quantidade;
    atual.premio_total += b.premio_total;
    atual.aluguel_soma += b.aluguel_soma;
    atual.aluguel_quantidade += b.aluguel_quantidade;
    porBairro.set(chave, atual);
  }
  const rankingBairros = Array.from(porBairro.values())
    .map((b) => ({ ...b, ticket_aluguel: b.aluguel_quantidade ? b.aluguel_soma / b.aluguel_quantidade : null }))
    .sort((a, b) => b.quantidade - a.quantidade)
    .slice(0, 20);
  const maiorQuantidadeBairro = Math.max(1, ...rankingBairros.map((b) => b.quantidade));

  // --- Concentração 80/20 (Pareto): quantos bairros concentram 80% do
  // prêmio mapeado -- mesma lista de bairros acima, só ordenada por prêmio
  // em vez de quantidade e com acumulado, nenhum dado novo é lido. ---
  const totalBairrosDistintos = porBairro.size;
  const totalPremioBairros = Array.from(porBairro.values()).reduce((s, b) => s + b.premio_total, 0);
  const bairrosPorPremio = Array.from(porBairro.values()).sort((a, b) => b.premio_total - a.premio_total);
  let paretoAcumulado = 0;
  let paretoContagem = 0;
  const metaPareto = totalPremioBairros * 0.8;
  for (const b of bairrosPorPremio) {
    paretoAcumulado += b.premio_total;
    paretoContagem++;
    if (paretoAcumulado >= metaPareto) break;
  }
  const paretoPercentualBairros = totalBairrosDistintos ? (paretoContagem / totalBairrosDistintos) * 100 : 0;

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-5xl flex-1 space-y-6 p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">Produção</h1>
            <p className="text-sm text-gray-500">
              Estatísticas de mercado — prêmio, comissão e ticket médio por produto e período.
            </p>
          </div>
          <Link
            href="/producao/upload"
            className="whitespace-nowrap rounded-full bg-o2-coral px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
          >
            Carregar grade
          </Link>
        </div>

        {semDadoNenhum ? (
          <div className="rounded-xl border border-o2-navy/10 bg-white p-8 text-center shadow-sm">
            <p className="text-sm text-gray-500">
              Nenhuma grade de produção carregada ainda.{" "}
              <Link href="/producao/upload" className="font-medium text-o2-navy hover:underline">
                Carregar a primeira
              </Link>
              .
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5 rounded-full bg-o2-gray/60 p-1.5">
              <Link
                href="/producao"
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                  !ramoSelecionado ? "bg-o2-navy text-white shadow-sm" : "text-gray-600 hover:bg-white/70 hover:text-o2-navy"
                }`}
              >
                Todos
              </Link>
              {RAMOS_PRODUCAO.map((r) => (
                <Link
                  key={r.valor}
                  href={`/producao?ramo=${r.valor}`}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                    ramoSelecionado === r.valor
                      ? "bg-o2-navy text-white shadow-sm"
                      : "text-gray-600 hover:bg-white/70 hover:text-o2-navy"
                  }`}
                >
                  {r.rotulo}
                  {quantidadePorRamo.get(r.valor) ? (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                        ramoSelecionado === r.valor ? "bg-o2-coral text-white" : "bg-o2-navy/10 text-o2-navy"
                      }`}
                    >
                      {fmtNumero(quantidadePorRamo.get(r.valor)!)}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Apólices</p>
                <p className="mt-1 text-2xl font-bold text-o2-navy">{fmtNumero(totalApolices)}</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {fmtNumero(totalNovo)} novas · {fmtNumero(totalRenovacao)} renovações
                </p>
              </div>
              <div className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Prêmio total</p>
                <p className="mt-1 text-2xl font-bold text-o2-navy">{fmtMoeda(totalPremio)}</p>
              </div>
              <div className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Comissão da corretora</p>
                <p className="mt-1 text-2xl font-bold text-o2-navy">{fmtMoeda(totalComissao)}</p>
              </div>
              <div className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Ticket médio</p>
                <p className="mt-1 text-2xl font-bold text-o2-navy">
                  {totalApolices ? fmtMoeda(totalPremio / totalApolices) : "—"}
                </p>
              </div>
            </div>

            <section className="rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">
                Evolução mensal (prêmio) {ramoSelecionado ? `— ${rotuloRamo(ramoSelecionado)}` : ""}
              </h2>
              {evolucaoMensal.length ? (
                <div className="space-y-2">
                  {evolucaoMensal.map((m) => (
                    <div key={m.competencia} className="flex items-center gap-3 text-sm">
                      <span className="w-16 shrink-0 text-xs text-gray-500">{formatarCompetencia(m.competencia)}</span>
                      <div className="h-5 flex-1 overflow-hidden rounded-full bg-o2-gray/50">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-o2-coral to-orange-400"
                          style={{ width: `${Math.max(3, (m.premio_total / maiorPremioMes) * 100)}%` }}
                        />
                      </div>
                      <span className="w-28 shrink-0 text-right text-xs font-medium text-o2-navy">{fmtMoeda(m.premio_total)}</span>
                      <span className="w-16 shrink-0 text-right text-xs text-gray-400">{fmtNumero(m.quantidade)} apól.</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">Sem competência identificada nessas linhas.</p>
              )}
            </section>

            <section className="rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
              <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-400">Participação no prêmio total</h2>
              <p className="mb-4 text-xs text-gray-500">Fatia de cada produto na carteira toda — mostra onde o volume de mercado está concentrado.</p>
              {participacaoPorRamo.length ? (
                <>
                  <div className="mb-4 flex h-4 w-full overflow-hidden rounded-full bg-o2-gray/50">
                    {participacaoPorRamo.map((r, i) => (
                      <div
                        key={r.ramo}
                        title={`${rotuloRamo(r.ramo)}: ${r.percentual.toFixed(1)}%`}
                        className={i % 2 === 0 ? "h-full bg-o2-navy" : "h-full bg-o2-coral"}
                        style={{ width: `${r.percentual}%` }}
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                    {participacaoPorRamo.map((r, i) => (
                      <div key={r.ramo} className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex items-center gap-2 text-gray-800">
                          <span className={`inline-block h-2.5 w-2.5 rounded-full ${i % 2 === 0 ? "bg-o2-navy" : "bg-o2-coral"}`} />
                          {rotuloRamo(r.ramo)}
                        </span>
                        <span className="whitespace-nowrap text-xs text-gray-500">
                          <span className="font-medium text-o2-navy">{r.percentual.toFixed(1)}%</span> · {fmtMoeda(r.premio_total)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-500">Sem dados.</p>
              )}
            </section>

            {!ramoSelecionado && (attachRateAuto !== null || cestaProdutos.length > 0) ? (
              <section className="rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
                <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-400">Cross-sell</h2>
                <p className="mb-4 text-xs text-gray-500">
                  Cruzamento por CPF/CNPJ do cliente entre ramos — só números agregados, sem nomes.
                </p>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="rounded-lg bg-o2-navy/5 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Taxa de anexação com Automóvel
                    </p>
                    {attachRateAuto !== null ? (
                      <>
                        <p className="mt-1 text-2xl font-bold text-o2-navy">{attachRateAuto.toFixed(1)}%</p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {fmtNumero(crossSell!.clientes_imobiliario_com_auto)} de {fmtNumero(crossSell!.total_clientes_imobiliario)}{" "}
                          clientes com produto imobiliário também têm Automóvel conosco.
                        </p>
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-gray-500">Sem dados.</p>
                    )}
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Produtos que mais aparecem juntos (mesmo cliente)
                    </p>
                    {cestaProdutos.length ? (
                      <div className="space-y-2">
                        {cestaProdutos.map((c) => (
                          <div key={`${c.ramo_a}-${c.ramo_b}`} className="text-sm">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="truncate text-gray-800">
                                {rotuloRamo(c.ramo_a)} + {rotuloRamo(c.ramo_b)}
                              </span>
                              <span className="whitespace-nowrap text-xs font-medium text-o2-navy">{fmtNumero(c.clientes_em_comum)}</span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-o2-gray/50">
                              <div
                                className="h-full rounded-full bg-o2-indigo"
                                style={{ width: `${Math.max(4, (c.clientes_em_comum / maiorCruzamento) * 100)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">Nenhum cliente com mais de 1 produto ainda.</p>
                    )}
                  </div>
                </div>
              </section>
            ) : null}

            {!ramoSelecionado && dispersaoOrdenada.length ? (
              <section className="rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
                <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-400">Dispersão de prêmio por ramo</h2>
                <p className="mb-4 text-xs text-gray-500">
                  Quanto maior o coeficiente de variação, mais inconsistente é a precificação dentro do produto — muita
                  apólice barata misturada com pouca muito cara (ou o contrário).
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs text-gray-500">
                        <th className="px-2 py-1.5 font-medium">Ramo</th>
                        <th className="px-2 py-1.5 font-medium">Média</th>
                        <th className="px-2 py-1.5 font-medium">Mediana</th>
                        <th className="px-2 py-1.5 font-medium">Desvio padrão</th>
                        <th className="px-2 py-1.5 font-medium">Coef. de variação</th>
                        <th className="px-2 py-1.5 font-medium">Mín – Máx</th>
                        <th className="px-2 py-1.5 font-medium">Q1 – Q3 (IQR)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dispersaoOrdenada.map((d) => (
                        <tr key={d.ramo} className="border-b border-gray-50 last:border-0">
                          <td className="px-2 py-2 text-gray-800">{rotuloRamo(d.ramo)}</td>
                          <td className="px-2 py-2 text-gray-800">{fmtMoeda(d.media)}</td>
                          <td className="px-2 py-2 text-gray-800">{fmtMoeda(d.mediana)}</td>
                          <td className="px-2 py-2 text-gray-800">{fmtMoeda(d.desvio_padrao)}</td>
                          <td className="px-2 py-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                d.coeficiente_variacao >= 100
                                  ? "bg-red-50 text-red-600"
                                  : d.coeficiente_variacao >= 50
                                    ? "bg-amber-50 text-amber-600"
                                    : "bg-green-50 text-green-600"
                              }`}
                            >
                              {d.coeficiente_variacao.toFixed(0)}%
                            </span>
                          </td>
                          <td className="px-2 py-2 text-gray-500">
                            {fmtMoeda(d.minimo)} – {fmtMoeda(d.maximo)}
                          </td>
                          <td className="px-2 py-2 text-gray-500">
                            {fmtMoeda(d.q1)} – {fmtMoeda(d.q3)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <section className="rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
                {ramoSelecionado ? (
                  <>
                    <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">Novo x Renovação</h2>
                    <div className="space-y-3">
                      {novoVsRenovacao.map((t) => (
                        <div key={t.tipo} className="text-sm">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <span className="text-gray-800">{t.tipo === "NOVO" ? "Novo" : "Renovação"}</span>
                            <span className="whitespace-nowrap text-xs text-gray-500">
                              {fmtNumero(t.quantidade)} apól. · ticket médio {fmtMoeda(t.ticket_medio)}
                            </span>
                          </div>
                          <div className="h-3 overflow-hidden rounded-full bg-o2-gray/50">
                            <div
                              className={`h-full rounded-full ${t.tipo === "NOVO" ? "bg-o2-coral" : "bg-o2-navy"}`}
                              style={{ width: `${Math.max(3, (t.premio_total / maiorPremioTipo) * 100)}%` }}
                            />
                          </div>
                          <p className="mt-0.5 text-right text-xs font-medium text-o2-navy">{fmtMoeda(t.premio_total)}</p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">Ticket médio por ramo</h2>
                    {ticketPorRamo.length ? (
                      <div className="space-y-2">
                        {ticketPorRamo.map((r) => (
                          <div key={r.ramo} className="text-sm">
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="truncate text-gray-800">{rotuloRamo(r.ramo)}</span>
                              <span className="whitespace-nowrap text-xs font-medium text-o2-navy">{fmtMoeda(r.ticket_medio)}</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-o2-gray/50">
                              <div
                                className="h-full rounded-full bg-o2-navy"
                                style={{ width: `${Math.max(3, (r.ticket_medio / maiorTicketRamo) * 100)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">Sem dados.</p>
                    )}
                  </>
                )}
              </section>

              <section className="rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-400">Mix por seguradora</h2>
                {mixSeguradoras.length ? (
                  <div className="space-y-2">
                    {mixSeguradoras.map((s) => (
                      <div key={s.seguradora} className="text-sm">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="truncate text-gray-800">{s.seguradora}</span>
                          <span className="whitespace-nowrap text-xs font-medium text-o2-navy">{fmtMoeda(s.premio_total)}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-o2-gray/50">
                          <div
                            className="h-full rounded-full bg-o2-indigo"
                            style={{ width: `${Math.max(3, (s.premio_total / maiorPremioSeguradora) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">Sem dados.</p>
                )}
              </section>
            </div>

            <section className="rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
              <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-400">
                Por bairro {ramoSelecionado ? `— ${rotuloRamo(ramoSelecionado)}` : ""}
              </h2>
              <p className="mb-2 text-xs text-gray-500">
                Vem dos relatórios de endereço carregados — cobertura parcial, cresce conforme mais
                relatórios forem enviados.
              </p>
              {totalBairrosDistintos > 0 ? (
                <p className="mb-4 inline-block rounded-full bg-o2-navy/5 px-3 py-1 text-xs font-medium text-o2-navy">
                  {fmtNumero(paretoContagem)} de {fmtNumero(totalBairrosDistintos)} bairros (
                  {paretoPercentualBairros.toFixed(0)}%) concentram 80% do prêmio mapeado
                </p>
              ) : null}
              {rankingBairros.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs text-gray-500">
                        <th className="px-2 py-1.5 font-medium">Bairro</th>
                        <th className="px-2 py-1.5 font-medium">Cidade/UF</th>
                        <th className="px-2 py-1.5 font-medium">Apólices</th>
                        <th className="px-2 py-1.5 font-medium">Prêmio</th>
                        <th className="px-2 py-1.5 font-medium">Ticket médio de aluguel</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankingBairros.map((b) => (
                        <tr key={`${b.bairro}-${b.cidade}`} className="border-b border-gray-50 last:border-0">
                          <td className="px-2 py-2">
                            <div className="mb-1 flex items-center gap-2">
                              <span className="text-gray-800">{b.bairro}</span>
                            </div>
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-o2-gray/50">
                              <div
                                className="h-full rounded-full bg-o2-coral"
                                style={{ width: `${Math.max(4, (b.quantidade / maiorQuantidadeBairro) * 100)}%` }}
                              />
                            </div>
                          </td>
                          <td className="px-2 py-2 text-gray-500">
                            {b.cidade ?? "—"}
                            {b.uf ? `/${b.uf}` : ""}
                          </td>
                          <td className="px-2 py-2 text-gray-800">{fmtNumero(b.quantidade)}</td>
                          <td className="px-2 py-2 text-gray-800">{fmtMoeda(b.premio_total)}</td>
                          <td className="px-2 py-2 text-gray-800">
                            {b.ticket_aluguel !== null ? fmtMoeda(b.ticket_aluguel) : <span className="text-gray-300">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-gray-500">
                  Nenhum endereço carregado ainda.{" "}
                  <Link href="/producao/upload" className="font-medium text-o2-navy hover:underline">
                    Carregar relatório de endereços
                  </Link>
                  .
                </p>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
