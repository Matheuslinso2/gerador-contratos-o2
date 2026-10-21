import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconChart } from "@/components/icons";
import { signOut } from "../../actions";
import { Abas, Alternador, Cartao, Colunas, compacto, div, FonteDados, mesValido, num, pct, Quadro, reais, rotuloMes, somarMeses } from "../_corp/comum";
import { abrirPainel, camposProducao, filtrosProducao, prontoOuCalcula, temFiltro } from "../_corp/dados";
import FiltrosCorp from "../_corp/FiltrosCorp";

export const dynamic = "force-dynamic";

// Power BI - O2 Seguros › Produção Histórica. Mesma página do Power BI
// ("PRODUÇÃO: Análise Histórica"): cartões com total do período, média de %
// de comissão (só valores > 0), crescimento de 12 meses e CAGR de 12 meses
// ((12 meses até o fim ÷ 12 meses até 11 meses antes)^(1/12) − 1); gráficos
// em visão anual / trimestral / mensal com a variação contra o período
// anterior; e o "Detalhe em tabela" (página Detalhe Histórica do PBI).

type Mes = { mes: string; docs: number | null; pl: number | null; com: number | null; com_prod: number | null; s_com: number | null; n_com: number | null; s_prod: number | null; n_prod: number | null };
type Soma = { docs: number; pl: number; com: number; com_prod: number; s_com: number; n_com: number; s_prod: number; n_prod: number };

const VISOES = [
  { valor: "ano", rotulo: "Visão anual" },
  { valor: "tri", rotulo: "Visão trimestral" },
  { valor: "mes", rotulo: "Visão mensal" },
  { valor: "tabela", rotulo: "Detalhe em tabela" },
];

function somar(lista: Mes[]): Soma {
  const s: Soma = { docs: 0, pl: 0, com: 0, com_prod: 0, s_com: 0, n_com: 0, s_prod: 0, n_prod: 0 };
  for (const m of lista) {
    s.docs += m.docs ?? 0;
    s.pl += m.pl ?? 0;
    s.com += m.com ?? 0;
    s.com_prod += m.com_prod ?? 0;
    s.s_com += m.s_com ?? 0;
    s.n_com += m.n_com ?? 0;
    s.s_prod += m.s_prod ?? 0;
    s.n_prod += m.n_prod ?? 0;
  }
  return s;
}

const INDICADORES: { chave: string; rotulo: string; formato: "numero" | "reais"; valor: (s: Soma) => number | null }[] = [
  { chave: "com", rotulo: "Comissão corretora", formato: "reais", valor: (s) => s.com },
  { chave: "com_prod", rotulo: "Comissão produtor", formato: "reais", valor: (s) => s.com_prod },
  { chave: "pl", rotulo: "Prêmio líquido", formato: "reais", valor: (s) => s.pl },
  { chave: "docs", rotulo: "Documentos", formato: "numero", valor: (s) => s.docs },
  { chave: "tm_com", rotulo: "TM comissão corretora", formato: "reais", valor: (s) => div(s.com, s.docs) },
  { chave: "tm_prod", rotulo: "TM comissão produtor", formato: "reais", valor: (s) => div(s.com_prod, s.docs) },
  { chave: "tm_pl", rotulo: "TM prêmio líquido", formato: "reais", valor: (s) => div(s.pl, s.docs) },
];

export default async function ProducaoHistoricaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, user, opcoes } = await abrirPainel();
  const meses = opcoes.meses ?? [];
  const mesAtual = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
  const ultimo = meses.filter((m) => m <= mesAtual).at(-1) ?? mesAtual;
  // Regra do Matheus (21/10/2026): toda aba do Power BI abre no mês vigente.
  let de = mesValido(sp.de) ?? ultimo;
  let ate = mesValido(sp.ate) ?? ultimo;
  if (ate > ultimo) ate = ultimo;
  if (de > ate) [de, ate] = [ate, de];
  const visao = VISOES.some((v) => v.valor === sp.visao) ? sp.visao! : "ano";
  const filtros = filtrosProducao(sp);

  const { data, error } = await prontoOuCalcula<Mes[]>(supabase, temFiltro(filtros) ? null : "historico", () =>
    supabase.rpc("corp_painel_historico", filtros)
  );
  const serie = (data ?? []).filter((m) => m.mes <= ultimo);
  const porMes = new Map(serie.map((m) => [m.mes, m]));
  const noPeriodo = serie.filter((m) => m.mes >= de && m.mes <= ate);
  const total = somar(noPeriodo);

  // 12 meses terminando em `fim` (meses sem produção contam zero).
  const doze = (fim: string) => somar(Array.from({ length: 12 }, (_, i) => porMes.get(somarMeses(fim, -i))).filter(Boolean) as Mes[]);
  const fim12 = doze(ate);
  const ini12 = doze(somarMeses(ate, -11));
  const cresc12 = (v: (s: Soma) => number | null) => {
    const a = v(ini12);
    const b = v(fim12);
    return a && b !== null ? b / a - 1 : null;
  };
  const cagr12 = (v: (s: Soma) => number | null) => {
    const a = v(ini12);
    const b = v(fim12);
    return a && a > 0 && b !== null ? Math.pow(b / a, 1 / 12) - 1 : null;
  };

  // Agrupa por ano / trimestre / mês.
  const chave = (m: string) => (visao === "ano" ? m.slice(0, 4) : visao === "tri" ? `${m.slice(0, 4)}-T${Math.ceil(Number(m.slice(5, 7)) / 3)}` : m);
  const grupos = new Map<string, Mes[]>();
  for (const m of noPeriodo) grupos.set(chave(m.mes), [...(grupos.get(chave(m.mes)) ?? []), m]);
  const periodos = [...grupos.entries()].map(([k, l]) => ({ k, s: somar(l) }));
  const rotuloPeriodo = (k: string) => (visao === "mes" ? rotuloMes(k) : visao === "tri" ? `${k.slice(7)}/${k.slice(2, 4)}` : k);
  const base = "/producao/historica";

  return (
    <>
      <AppHeader userEmail={user.email} logoutAction={signOut} />
      <main className="mx-auto max-w-7xl flex-1 space-y-5 p-8">
        <PageHeader icon={<IconChart />} titulo="Power BI - O2 Seguros" subtitulo={`Produção Histórica · ${rotuloMes(de)} a ${rotuloMes(ate)}`} />
        <Abas ativa="/producao/historica" />
        <FiltrosCorp meses={meses.filter((m) => m <= ultimo)} periodo={{ de, ate }} campos={camposProducao(opcoes)} />
        <FonteDados importadoEm={opcoes.importado_em} arquivoEm={opcoes.arquivo_modificado_em} />
        {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Não foi possível calcular ({error.message}).</p>}
        {temFiltro(filtros) && (
          <p className="rounded-lg border border-o2-coral/30 bg-o2-coral/5 p-3 text-sm text-o2-navy">Todos os quadros abaixo estão recortados pelos filtros escolhidos.</p>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
          <Cartao rotulo="Com. corretora" valor={compacto(total.com)} legenda="Total do período. Base méd. = média do % de comissão da corretora (só documentos com % > 0). Cresc. 12M = 12 meses até o fim do período contra os 12 meses até 11 meses antes; CAGR 12M = mesma comparação em taxa composta mensal.">
            <p>Base méd.: {pct(div(total.s_com, total.n_com) !== null ? div(total.s_com, total.n_com)! / 100 : null)}</p>
            <p>Cresc. 12M: {pct(cresc12((s) => s.com))}</p>
            <p>CAGR 12M: {pct(cagr12((s) => s.com), 2)}</p>
          </Cartao>
          <Cartao rotulo="Com. produtor" valor={compacto(total.com_prod)}>
            <p>Base méd.: {pct(div(total.s_prod, total.n_prod) !== null ? div(total.s_prod, total.n_prod)! / 100 : null)}</p>
            <p>Cresc. 12M: {pct(cresc12((s) => s.com_prod))}</p>
            <p>CAGR 12M: {pct(cagr12((s) => s.com_prod), 2)}</p>
          </Cartao>
          <Cartao rotulo="Prêmio líquido" valor={compacto(total.pl)}>
            <p>Cresc. 12M: {pct(cresc12((s) => s.pl))}</p>
            <p>CAGR 12M: {pct(cagr12((s) => s.pl), 2)}</p>
          </Cartao>
          <Cartao rotulo="Documentos" valor={num(total.docs)}>
            <p>Cresc. 12M: {pct(cresc12((s) => s.docs))}</p>
            <p>CAGR 12M: {pct(cagr12((s) => s.docs), 2)}</p>
          </Cartao>
          <Cartao rotulo="TM com. corret." valor={reais(div(total.com, total.docs))}>
            <p>Cresc. 12M: {pct(cresc12((s) => div(s.com, s.docs)))}</p>
            <p>CAGR 12M: {pct(cagr12((s) => div(s.com, s.docs)), 2)}</p>
          </Cartao>
          <Cartao rotulo="TM com. prod." valor={reais(div(total.com_prod, total.docs))}>
            <p>Cresc. 12M: {pct(cresc12((s) => div(s.com_prod, s.docs)))}</p>
            <p>CAGR 12M: {pct(cagr12((s) => div(s.com_prod, s.docs)), 2)}</p>
          </Cartao>
          <Cartao rotulo="TM prêmio líq." valor={reais(div(total.pl, total.docs))}>
            <p>Cresc. 12M: {pct(cresc12((s) => div(s.pl, s.docs)))}</p>
            <p>CAGR 12M: {pct(cagr12((s) => div(s.pl, s.docs)), 2)}</p>
          </Cartao>
        </div>

        <Alternador base={base} sp={sp} chave="visao" opcoes={VISOES} atual={visao} />

        {visao !== "tabela" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {INDICADORES.map((ind) => (
              <Quadro key={ind.chave} titulo={ind.rotulo} legenda={`Colunas = valor do ${visao === "ano" ? "ano" : visao === "tri" ? "trimestre" : "mês"}; número acima = variação contra o ${visao === "ano" ? "ano" : visao === "tri" ? "trimestre" : "mês"} anterior.`}>
                <Colunas
                  formato={ind.formato}
                  itens={periodos.map((p, i) => {
                    const v = ind.valor(p.s) ?? 0;
                    const ant = i > 0 ? ind.valor(periodos[i - 1].s) : null;
                    return { rotulo: rotuloPeriodo(p.k), v, cresc: ant ? v / ant - 1 : null };
                  })}
                />
              </Quadro>
            ))}
          </div>
        ) : (
          <Quadro titulo="Detalhe em tabela">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs tabular-nums">
                <thead className="border-b border-gray-200 text-[11px] uppercase text-gray-500">
                  <tr>
                    <th className="py-1.5 text-left">Período</th>
                    <th>Documentos</th>
                    <th>Prêmio líquido</th>
                    <th>Com. corretora</th>
                    <th>Com. produtor</th>
                    <th>TM com. corret.</th>
                    <th>TM com. prod.</th>
                    <th>TM prêmio líq.</th>
                    <th>% méd. com. corret.</th>
                    <th>% méd. com. prod.</th>
                  </tr>
                </thead>
                <tbody>
                  {[...periodos.map((p) => ({ k: rotuloPeriodo(p.k), s: p.s })), { k: "Total", s: total }].map(({ k, s }) => (
                    <tr key={k} className={`border-b border-gray-100 ${k === "Total" ? "font-semibold text-o2-navy" : ""}`}>
                      <td className="py-1 text-left">{k}</td>
                      <td>{num(s.docs)}</td>
                      <td>{reais(s.pl)}</td>
                      <td>{reais(s.com)}</td>
                      <td>{reais(s.com_prod)}</td>
                      <td>{reais(div(s.com, s.docs))}</td>
                      <td>{reais(div(s.com_prod, s.docs))}</td>
                      <td>{reais(div(s.pl, s.docs))}</td>
                      <td>{pct(s.n_com ? s.s_com / s.n_com / 100 : null)}</td>
                      <td>{pct(s.n_prod ? s.s_prod / s.n_prod / 100 : null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Quadro>
        )}
      </main>
    </>
  );
}
