import { Fragment } from "react";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconChart } from "@/components/icons";
import { signOut } from "../../actions";
import { Abas, Alternador, BarrasH, Cartao, Colunas, compacto, div, FonteDados, lista, mesValido, num, pct, Quadro, rotuloMes } from "../_corp/comum";
import { abrirPainel, prontoOuCalcula } from "../_corp/dados";
import FiltrosCorp from "../_corp/FiltrosCorp";

export const dynamic = "force-dynamic";

// Power BI - O2 Seguros › Sinistros ("SINISTRALIDADE: Visão Completa" do
// Power BI). Base = extração "Sinistros Geral Grade" do Corp, sem
// deduplicação (já vem 1 linha por sinistro), mês = data de ocorrência.
// Casos s/ valor (0800) = indenização e despesa zeradas. O módulo de gestão
// de sinistros do Workspace continua em /sinistros (outra base).

type Totais = { casos: number; casos_ind: number; casos_desp: number; casos_valor: number; casos_0800: number; vl_inden: number; vl_despesas: number; meses: number };
type Sin = {
  totais: Totais;
  por_situacao: { k: string; casos: number; valor: number }[];
  por_faixa: { k: string; casos: number; valor: number }[];
  por_ramo: { k: string; casos: number; valor: number }[];
  por_grupo: { grupo: string; ramo: string; casos: number; inden: number; desp: number }[];
  mensal: { mes: string; casos: number; inden: number; desp: number }[];
};

const FAIXAS = ["SEM VALOR", "MENOR QUE 1K", "ENTRE 1K E 5K", "ENTRE 5K E 10K", "MAIOR QUE 10K"];

export default async function SinistrosCorpPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, user, opcoes } = await abrirPainel();
  const mesAtual = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
  const meses = (opcoes.meses ?? []).filter((m) => m <= mesAtual);
  // Regra do Matheus (21/10/2026): toda aba do Power BI abre no mês vigente.
  let de = mesValido(sp.de) ?? mesAtual;
  let ate = mesValido(sp.ate) ?? mesAtual;
  if (de > ate) [de, ate] = [ate, de];
  const situacoes = opcoes.situacoes ?? [];
  const nomeSit = (k: string) => situacoes.find((s) => s.codigo === k)?.descricao ?? (k || "(vazio)");
  const v = (k: string) => {
    const l = lista(sp[k]);
    return l.length ? l : null;
  };

  const semFiltro = !v("seg") && !v("ramo") && !v("sit") && !v("faixa") && de === (meses[0] ?? de) && ate === mesAtual;
  const { data: s, error } = await prontoOuCalcula<Sin>(supabase, semFiltro ? "sinistros" : null, () =>
    supabase.rpc("corp_painel_sinistros", {
      p_de: `${de}-01`,
      p_ate: `${ate}-01`,
      p_seg: v("seg"),
      p_ramo: v("ramo"),
      p_situacao: v("sit"),
      p_faixa: v("faixa"),
    })
  );
  const t = s?.totais;
  const base = "/producao/sinistros";
  const g1 = sp.g1 === "faixa" ? "faixa" : "sit";
  const g2 = sp.g2 === "valor" ? "valor" : "casos";
  const g3 = ["valor", "inden", "desp"].includes(sp.g3 ?? "") ? sp.g3! : "casos";

  // Matriz grupo → ramo
  const grupos = new Map<string, { casos: number; inden: number; desp: number; ramos: Sin["por_grupo"] }>();
  for (const r of s?.por_grupo ?? []) {
    const gr = grupos.get(r.grupo) ?? { casos: 0, inden: 0, desp: 0, ramos: [] };
    gr.casos += r.casos;
    gr.inden += r.inden;
    gr.desp += r.desp;
    gr.ramos.push(r);
    grupos.set(r.grupo, gr);
  }

  const serie = (s?.mensal ?? []).map((m) => ({
    rotulo: rotuloMes(m.mes),
    v: g3 === "casos" ? m.casos : g3 === "inden" ? m.inden : g3 === "desp" ? m.desp : m.inden + m.desp,
  }));
  // Tendência (reta de mínimos quadrados) em unidades por mês, como a linha tracejada do PBI.
  const n = serie.length;
  const media = n ? serie.reduce((a, p) => a + p.v, 0) / n : 0;
  const inclinacao =
    n > 1 ? serie.reduce((a, p, i) => a + (i - (n - 1) / 2) * (p.v - media), 0) / serie.reduce((a, _, i) => a + (i - (n - 1) / 2) ** 2, 0) : 0;

  return (
    <>
      <AppHeader userEmail={user.email} logoutAction={signOut} />
      <main className="mx-auto max-w-7xl flex-1 space-y-5 p-8">
        <PageHeader icon={<IconChart />} titulo="Power BI - O2 Seguros" subtitulo={`Sinistralidade · visão completa · ${rotuloMes(de)} a ${rotuloMes(ate)}`} />
        <Abas ativa="/producao/sinistros" />
        <FiltrosCorp
          meses={meses}
          periodo={{ de, ate }}
          campos={[
            { chave: "seg", rotulo: "Seguradora", opcoes: (opcoes.seguradoras ?? []).map((x) => ({ valor: x, rotulo: x })) },
            { chave: "ramo", rotulo: "Ramo", opcoes: (opcoes.ramos ?? []).map((x) => ({ valor: x, rotulo: x })) },
            { chave: "sit", rotulo: "Situação", opcoes: situacoes.map((x) => ({ valor: x.codigo, rotulo: x.descricao })) },
            { chave: "faixa", rotulo: "Faixa de valor", opcoes: FAIXAS.map((x) => ({ valor: x, rotulo: x })) },
          ]}
        />
        <FonteDados importadoEm={opcoes.importado_em} arquivoEm={opcoes.arquivo_modificado_em} />
        {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Não foi possível calcular ({error.message}).</p>}

        {t && s && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Cartao rotulo="Nº de casos" valor={num(t.casos)} legenda="Sinistros com ocorrência no período. Casos s/ valor = indenização e despesa zeradas (encerrados sem pagamento, avisos 0800).">
                <p>Casos s/ valor: {num(t.casos_0800)} {pct(div(t.casos_0800, t.casos))}</p>
                <p>Média mensal: {num(div(t.casos, t.meses))}</p>
              </Cartao>
              <Cartao rotulo="Valor total" valor={compacto(t.vl_inden + t.vl_despesas)} legenda="Indenização + despesas. Valor médio = total ÷ casos com valor.">
                <p>Casos c/ valor: {num(t.casos_valor)} {pct(div(t.casos_valor, t.casos))}</p>
                <p>Valor médio: {compacto(div(t.vl_inden + t.vl_despesas, t.casos_valor))}</p>
              </Cartao>
              <Cartao rotulo="Indenização" valor={compacto(t.vl_inden)}>
                <p>Casos c/ valor: {num(t.casos_ind)} {pct(div(t.casos_ind, t.casos))}</p>
                <p>Valor médio: {compacto(div(t.vl_inden, t.casos_ind))}</p>
              </Cartao>
              <Cartao rotulo="Despesas" valor={compacto(t.vl_despesas)}>
                <p>Casos c/ valor: {num(t.casos_desp)} {pct(div(t.casos_desp, t.casos))}</p>
                <p>Valor médio: {compacto(div(t.vl_despesas, t.casos_desp))}</p>
              </Cartao>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Quadro
                titulo={g1 === "faixa" ? "Casos por faixa de valor" : "Situação dos casos"}
                acoes={<Alternador base={base} sp={sp} chave="g1" opcoes={[{ valor: "sit", rotulo: "Situação" }, { valor: "faixa", rotulo: "Faixa de valor" }]} atual={g1} />}
              >
                <BarrasH
                  itens={
                    g1 === "faixa"
                      ? FAIXAS.map((f) => ({ k: f, v: s.por_faixa.find((x) => x.k === f)?.casos ?? 0 }))
                      : s.por_situacao.map((x) => ({ k: nomeSit(x.k), v: x.casos }))
                  }
                />
              </Quadro>
              <Quadro
                titulo={g2 === "valor" ? "Valor total por ramo" : "Nº de casos por ramo"}
                acoes={<Alternador base={base} sp={sp} chave="g2" opcoes={[{ valor: "casos", rotulo: "Casos" }, { valor: "valor", rotulo: "Valor" }]} atual={g2} />}
              >
                <BarrasH
                  formato={g2 === "valor" ? "reais" : "numero"}
                  itens={s.por_ramo.map((x) => ({ k: x.k, v: g2 === "valor" ? x.valor : x.casos })).sort((a, b) => b.v - a.v)}
                />
              </Quadro>
            </div>

            <Quadro
              titulo={g3 === "casos" ? "Nº de casos no tempo" : g3 === "inden" ? "Indenização no tempo" : g3 === "desp" ? "Despesas no tempo" : "Valor total no tempo"}
              legenda="Por mês de ocorrência. Tendência = inclinação da reta que melhor passa pelos meses do período."
              acoes={
                <Alternador
                  base={base}
                  sp={sp}
                  chave="g3"
                  opcoes={[
                    { valor: "casos", rotulo: "Casos" },
                    { valor: "valor", rotulo: "Valor total" },
                    { valor: "inden", rotulo: "Indenização" },
                    { valor: "desp", rotulo: "Despesas" },
                  ]}
                  atual={g3}
                />
              }
            >
              <Colunas itens={serie} formato={g3 === "casos" ? "numero" : "reais"} altura={120} />
              <p className="mt-2 text-xs text-gray-500">
                Tendência no período: {inclinacao >= 0 ? "+" : "−"}
                {g3 === "casos" ? num(Math.abs(inclinacao)) : compacto(Math.abs(inclinacao))} por mês (média de {g3 === "casos" ? num(media) : compacto(media)} por mês).
              </p>
            </Quadro>

            <Quadro titulo="Detalhamento">
              <table className="w-full text-right text-xs tabular-nums">
                <thead className="border-b border-o2-coral/40 text-[11px] uppercase text-gray-500">
                  <tr>
                    <th className="py-1 text-left">Grupo / ramo</th>
                    <th>Casos</th>
                    <th>Total (R$)</th>
                    <th>Indeniz. (R$)</th>
                    <th>Desp. (R$)</th>
                  </tr>
                </thead>
                <tbody>
                  {[...grupos.entries()]
                    .sort((a, b) => b[1].casos - a[1].casos)
                    .map(([nome, gr]) => (
                      <Fragment key={nome}>
                        <tr className="border-b border-gray-100 font-semibold text-o2-navy">
                          <td className="py-1 text-left">{nome}</td>
                          <td>{num(gr.casos)}</td>
                          <td>{num(gr.inden + gr.desp)}</td>
                          <td>{num(gr.inden)}</td>
                          <td>{num(gr.desp)}</td>
                        </tr>
                        {gr.ramos.map((r) => (
                          <tr key={`${nome}-${r.ramo}`} className="border-b border-gray-50 text-gray-600">
                            <td className="py-0.5 pl-4 text-left">{r.ramo}</td>
                            <td>{num(r.casos)}</td>
                            <td>{num(r.inden + r.desp)}</td>
                            <td>{num(r.inden)}</td>
                            <td>{num(r.desp)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  <tr className="font-semibold text-o2-navy">
                    <td className="py-1 text-left">TOTAL</td>
                    <td>{num(t.casos)}</td>
                    <td>{num(t.vl_inden + t.vl_despesas)}</td>
                    <td>{num(t.vl_inden)}</td>
                    <td>{num(t.vl_despesas)}</td>
                  </tr>
                </tbody>
              </table>
            </Quadro>
          </>
        )}
      </main>
    </>
  );
}
