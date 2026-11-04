import Link from "next/link";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import InfoLegenda from "@/components/InfoLegenda";
import { Cartao } from "./kpiUi";

// Aba "Dados estatísticos O2" do Início (Matheus, 03-04/11/2026): visão de mercado dos
// seguros da NOSSA carteira (não é o mercado inteiro). Organizada em sub-abas por assunto:
//   Visão geral (todos os produtos) · Funil de cotações · Preço · Região · Margem e repasse
//   (admin) · Parceiros.
// "Um número, uma resposta": Visão geral e Funil usam a MESMA fonte e a mesma conta do Power BI
// (/producao) e da Imobiliária 360 (RPC kpis_producao: cada evento no mês em que aconteceu).
// As visões por coorte (faixa de aluguel, mês a mês) contam a cotação no mês em que ENTROU e são
// avisadas na tela. Preço, Região, Margem e Parceiros leem tabelas prontas analise_* (1x por dia),
// cada uma com a janela indicada no próprio bloco. O filtro de período vale para Visão geral e Funil.

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dec2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MIN_AMOSTRA = 30; // abaixo disso o percentual é ruído: mostra só o número de casos
const pct = (a: number, b: number) => (b > 0 ? (100 * a) / b : null);
const fp = (v: number | null) => (v == null ? "—" : `${dec1.format(v)}%`);
const fpn = (a: number, b: number) => (b >= MIN_AMOSTRA ? fp(pct(a, b)) : "n baixo");
const titulo = (s: string | null) => (s ? s.toLowerCase().replace(/(^|\s|-)\S/g, (c) => c.toUpperCase()) : "—");
const rotuloMes = (m: string) => `${MES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
function somarMeses(mes: string, n: number) {
  const [a, m] = mes.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export type SecaoEstat = "geral" | "funil" | "preco" | "regiao" | "margem" | "parceiros";
export type PeriodoEstat = "12" | "24" | "tudo";
export type ProdutoEstat = "fianca" | "re" | "capitalizacao" | "automovel";
const PRODUTOS_ESTAT: { k: ProdutoEstat; t: string }[] = [
  { k: "fianca", t: "Seguro Fiança" },
  { k: "re", t: "Incêndio" },
  { k: "capitalizacao", t: "Capitalização" },
  { k: "automovel", t: "Automóvel" },
];
export function lerProduto(v: string | undefined): ProdutoEstat {
  return PRODUTOS_ESTAT.some((p) => p.k === v) ? (v as ProdutoEstat) : "fianca";
}
const SECOES: { k: SecaoEstat; t: string; admin?: boolean; periodo?: boolean; porProduto?: boolean }[] = [
  { k: "geral", t: "Visão geral (todos os produtos)", periodo: true },
  { k: "funil", t: "Funil de cotações", periodo: true, porProduto: true },
  { k: "preco", t: "Preço", porProduto: true },
  { k: "regiao", t: "Região", porProduto: true },
  { k: "margem", t: "Margem e repasse (todos os produtos)", admin: true },
  { k: "parceiros", t: "Parceiros", porProduto: true },
];
const PERIODOS: { k: PeriodoEstat; t: string }[] = [
  { k: "12", t: "12 meses" },
  { k: "24", t: "24 meses" },
  { k: "tudo", t: "Desde 2020" },
];

export function lerSecao(v: string | undefined): SecaoEstat {
  return SECOES.some((s) => s.k === v) ? (v as SecaoEstat) : "geral";
}
export function lerPeriodo(v: string | undefined): PeriodoEstat {
  return v === "12" || v === "tudo" ? v : "24";
}
// Meses FECHADOS: o período termina no mês anterior ao atual (mês aberto distorceria taxas).
function janela(per: PeriodoEstat) {
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
  const ate = somarMeses(hoje, -1);
  const de = per === "tudo" ? "2020-01" : somarMeses(ate, per === "12" ? -11 : -23);
  return { de, ate, hoje };
}

function Secao({ titulo: t, legenda, children }: { titulo: string; legenda?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="flex items-center gap-1 text-sm font-semibold uppercase tracking-wide text-o2-navy">
        {t}
        {legenda && <InfoLegenda titulo={t}>{legenda}</InfoLegenda>}
      </h2>
      {children}
    </section>
  );
}
function Barra({ valor, max, cor = "#00447E" }: { valor: number; max: number; cor?: string }) {
  return (
    <div className="h-2 w-full rounded-full bg-gray-100">
      <div className="h-2 rounded-full" style={{ width: `${Math.max(2, Math.min(100, (valor / max) * 100))}%`, background: cor }} />
    </div>
  );
}
const Aviso = ({ children }: { children: ReactNode }) => <p className="text-[11px] leading-snug text-o2-cinza-medio">{children}</p>;
const Erro = ({ msg }: { msg: string }) => <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Não foi possível carregar agora ({msg}).</p>;

export default async function DashboardEstatisticas({ verMargem, secao, periodo, produto }: { verMargem: boolean; secao: SecaoEstat; periodo: PeriodoEstat; produto: ProdutoEstat }) {
  const ativa = SECOES.find((s) => s.k === secao && (!s.admin || verMargem)) ?? SECOES[0];
  const { de, ate } = janela(periodo);
  const href = (s: SecaoEstat, p: PeriodoEstat, pr: ProdutoEstat = produto) => `/?aba=estatisticas&sec=${s}&per=${p}&prod=${pr}`;
  return (
    <div className="space-y-5">
      <p className="text-xs text-o2-cinza-medio">
        Visão de mercado dos seguros da <b>nossa carteira</b> (não é o mercado inteiro). Os números de Visão geral e do quadro de eventos do Funil são os mesmos do Power BI (/producao).
      </p>
      <nav className="flex flex-wrap gap-1.5" aria-label="Assuntos">
        {SECOES.filter((s) => !s.admin || verMargem).map((s) => (
          <Link
            key={s.k}
            href={href(s.k, periodo)}
            scroll={false}
            aria-current={ativa.k === s.k ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              ativa.k === s.k ? "border-o2-navy bg-o2-navy text-white" : "border-gray-300 text-o2-cinza-escuro hover:border-o2-navy"
            }`}
          >
            {s.t}
          </Link>
        ))}
      </nav>
      {ativa.porProduto && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-o2-cinza-medio">Produto:</span>
          {PRODUTOS_ESTAT.map((p) => (
            <Link
              key={p.k}
              href={href(ativa.k, periodo, p.k)}
              scroll={false}
              aria-current={produto === p.k ? "true" : undefined}
              className={`rounded-md px-2.5 py-1 font-medium ${produto === p.k ? "bg-o2-navy text-white" : "text-o2-cinza-escuro hover:text-o2-navy"}`}
            >
              {p.t}
            </Link>
          ))}
        </div>
      )}
      {ativa.periodo ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-o2-cinza-medio">Período (meses fechados):</span>
          {PERIODOS.map((p) => (
            <Link
              key={p.k}
              href={href(ativa.k, p.k)}
              scroll={false}
              aria-current={periodo === p.k ? "true" : undefined}
              className={`rounded-md px-2.5 py-1 font-medium ${periodo === p.k ? "bg-o2-coral/15 text-o2-navy" : "text-o2-cinza-medio hover:text-o2-navy"}`}
            >
              {p.t}
            </Link>
          ))}
          <span className="text-o2-cinza-medio">· {rotuloMes(de)} a {rotuloMes(ate)}</span>
        </div>
      ) : (
        <p className="text-[11px] text-o2-cinza-medio">Este assunto tem janela própria, indicada em cada quadro (o filtro de período vale para Visão geral e Funil).</p>
      )}
      {ativa.k === "geral" && <Geral de={de} ate={ate} verMargem={verMargem} />}
      {ativa.k === "funil" && (produto === "fianca" ? <FunilFianca de={de} ate={ate} /> : <FunilOutro produto={produto} de={de} ate={ate} />)}
      {ativa.k === "preco" && (produto === "fianca" ? <PrecoFianca /> : <PrecoOutro produto={produto} />)}
      {ativa.k === "regiao" && (produto === "fianca" ? <RegiaoFianca /> : produto === "re" ? <RegiaoRe /> : <SemEndereco produto={produto} />)}
      {ativa.k === "margem" && verMargem && <Margem />}
      {ativa.k === "parceiros" && (produto === "fianca" ? <ParceirosFianca /> : <ParceirosOutro produto={produto} />)}
    </div>
  );
}

// ───────────────────────── Visão geral e Funil (fonte do Power BI) ─────────────────────────
type Valores = { propostas: number; premio: number; comissao: number };
type Cot = { produto: string; entradas: number; aprovacoes: number; recusas: number; perdas: number; conversoes: number; premio_convertido: number };
type Ren = { produto: string; entradas: number; conversoes: number; perdas: number; premio_convertido: number };
type Kpis = {
  resumo: Valores;
  resumo_ano_anterior: Valores;
  por_produto: (Valores & { produto: string; premio_ano_anterior: number })[];
  funil_por_produto: Cot[];
  renovacoes_por_produto: Ren[];
};
const PRODUTOS: Record<string, { rotulo: string; cor: string; regua: string; calc: (p: Cot) => [number, number] }> = {
  fianca: { rotulo: "Seguro Fiança", cor: "#F8540D", regua: "convertidas ÷ recebidas", calc: (p) => [p.conversoes, p.entradas] },
  re: { rotulo: "Incêndio / Ramos elementares", cor: "#01192e", regua: "efetivadas ÷ recebidas", calc: (p) => [p.conversoes, p.entradas] },
  capitalizacao: { rotulo: "Capitalização", cor: "#2E6FB7", regua: "emitidos ÷ (emitidos + perdidos)", calc: (p) => [p.conversoes, p.conversoes + p.perdas] },
  automovel: { rotulo: "Automóvel", cor: "#9CA3AF", regua: "convertidas ÷ (convertidas + perdidas)", calc: (p) => [p.conversoes, p.conversoes + p.perdas] },
};
const ORDEM = ["fianca", "re", "capitalizacao", "automovel"];

async function kpisDoPeriodo(de: string, ate: string) {
  const sb = await createClient();
  const { data, error } = await sb.rpc("kpis_producao", { p_de: de, p_ate: ate, p_produtos: null, p_grupos: null, p_imobs: null, p_seguradoras: null });
  return { k: data as Kpis | null, erro: error?.message ?? null };
}
const variacao = (atual: number, anterior: number) => (anterior > 0 ? `${atual >= anterior ? "+" : "−"}${dec1.format(Math.abs((atual / anterior - 1) * 100))}% vs ano anterior` : "sem base no ano anterior");

async function Geral({ de, ate, verMargem }: { de: string; ate: string; verMargem: boolean }) {
  const { k, erro } = await kpisDoPeriodo(de, ate);
  if (!k) return <Erro msg={erro ?? "sem dados"} />;
  const cot = ORDEM.map((p) => k.funil_por_produto.find((x) => x.produto === p)).filter((x): x is Cot => !!x);
  const ren = ORDEM.map((p) => k.renovacoes_por_produto.find((x) => x.produto === p)).filter((x): x is Ren => !!x && x.entradas + x.conversoes + x.perdas > 0);
  const entradas = cot.reduce((t, p) => t + p.entradas, 0);
  const conv = cot.reduce((t, p) => t + p.conversoes, 0);
  const premioTotal = k.por_produto.reduce((t, p) => t + p.premio, 0) || 1;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao rotulo="Cotações recebidas" valor={inteiro.format(entradas)} linhas={[`${inteiro.format(conv)} convertidas`]} />
        <Cartao rotulo="Apólices efetivadas (Corp)" valor={inteiro.format(k.resumo.propostas)} linhas={[variacao(k.resumo.propostas, k.resumo_ano_anterior.propostas)]} />
        <Cartao rotulo="Prêmio líquido" valor={reais.format(k.resumo.premio)} linhas={[variacao(k.resumo.premio, k.resumo_ano_anterior.premio)]} />
        {verMargem && <Cartao rotulo="Comissão" valor={reais.format(k.resumo.comissao)} linhas={[variacao(k.resumo.comissao, k.resumo_ano_anterior.comissao)]} />}
      </div>
      <Secao
        titulo="Todos os produtos"
        legenda="Mesma fonte e mesma conta do Power BI (/producao) e da Imobiliária 360. Cotação conta no mês em que entrou; conversão e perda, no mês em que aconteceram. Apólices = documentos efetivados no Corp pelo mês de início de vigência. Cada produto usa a régua de conversão do próprio painel."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left uppercase tracking-wide text-o2-cinza-medio">
              <tr>
                <th className="py-1">Produto</th>
                <th className="py-1 text-right">Cotações recebidas</th>
                <th className="py-1 text-right">Convertidas</th>
                <th className="py-1 text-right">Conversão</th>
                <th className="py-1 text-right">Apólices</th>
                <th className="py-1 text-right">Prêmio</th>
                <th className="py-1 text-right">Parte do prêmio</th>
              </tr>
            </thead>
            <tbody>
              {ORDEM.map((p) => {
                const c = cot.find((x) => x.produto === p);
                const a = k.por_produto.find((x) => x.produto === p);
                if (!c && !a) return null;
                const [x, y] = c ? PRODUTOS[p].calc(c) : [0, 0];
                return (
                  <tr key={p} className="border-t border-gray-100">
                    <td className="py-1.5 font-medium text-o2-navy">{PRODUTOS[p].rotulo}</td>
                    <td className="py-1.5 text-right tabular-nums">{c ? inteiro.format(c.entradas) : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{c ? inteiro.format(c.conversoes) : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {fpn(x, y)}
                      <span className="block text-[10px] text-o2-cinza-medio">{PRODUTOS[p].regua}</span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{a ? inteiro.format(a.propostas) : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {a ? reais.format(a.premio) : "—"}
                      {a && <span className="block text-[10px] text-o2-cinza-medio">{variacao(a.premio, a.premio_ano_anterior)}</span>}
                    </td>
                    <td className="w-24 py-1.5 pl-3">
                      {a && <Barra valor={a.premio} max={premioTotal} cor={PRODUTOS[p].cor} />}
                      {a && <span className="text-[10px] text-o2-cinza-medio">{fp(pct(a.premio, premioTotal))}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Aviso>Automóvel não tem imobiliária vinculada; entra só nos totais. Incêndio conta itens (cada endereço), como no painel de Ramos Elementares.</Aviso>
      </Secao>
      {ren.length > 0 && (
        <Secao
          titulo="Renovações"
          legenda="Série separada das cotações novas. Taxa = renovadas ÷ (renovadas + não renovadas), a mesma régua dos painéis de renovação (Fiança e Ramos Elementares)."
        >
          <table className="w-full text-xs">
            <thead className="text-left uppercase tracking-wide text-o2-cinza-medio">
              <tr>
                <th className="py-1">Produto</th>
                <th className="py-1 text-right">Recebidas</th>
                <th className="py-1 text-right">Renovadas</th>
                <th className="py-1 text-right">Não renovadas</th>
                <th className="py-1 text-right">Taxa</th>
              </tr>
            </thead>
            <tbody>
              {ren.map((r) => (
                <tr key={r.produto} className="border-t border-gray-100">
                  <td className="py-1.5 font-medium text-o2-navy">{PRODUTOS[r.produto]?.rotulo ?? r.produto}</td>
                  <td className="py-1.5 text-right tabular-nums">{inteiro.format(r.entradas)}</td>
                  <td className="py-1.5 text-right tabular-nums">{inteiro.format(r.conversoes)}</td>
                  <td className="py-1.5 text-right tabular-nums">{inteiro.format(r.perdas)}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">{fpn(r.conversoes, r.conversoes + r.perdas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Secao>
      )}
    </>
  );
}

type Fx = { mes: string; faixa: string; ordem: number; decididas: number; fechadas: number; recusadas: number; perdidas: number };
type MesCoorte = { mes: string; decididas: number; fechadas: number };

async function FunilFianca({ de, ate }: { de: string; ate: string }) {
  const sb = await createClient();
  const { k, erro } = await kpisDoPeriodo(de, ate);
  // Coorte: os 2 meses mais recentes ficam de fora (ainda há cotações em andamento e a taxa apareceria baixa/recusa alta demais).
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
  const corteCoorte = somarMeses(hoje, -2);
  const fimCoorte = ate < corteCoorte ? ate : corteCoorte;
  const [fx, ms] = await Promise.all([
    sb.from("analise_mercado_mes_faixa").select("mes, faixa, ordem, decididas, fechadas, recusadas, perdidas").gte("mes", `${de}-01`).lte("mes", `${fimCoorte}-28`),
    sb.from("analise_mercado_mes").select("mes, decididas, fechadas").gte("mes", `${de}-01`).lte("mes", `${fimCoorte}-28`).order("mes"),
  ]);
  if (!k || fx.error || ms.error) return <Erro msg={erro ?? fx.error?.message ?? ms.error?.message ?? "sem dados"} />;
  const f = k.funil_por_produto.find((x) => x.produto === "fianca");
  const cot = ORDEM.map((p) => k.funil_por_produto.find((x) => x.produto === p)).filter((x): x is Cot => !!x);

  const porFaixa = new Map<string, { ordem: number; d: number; f: number; r: number; p: number }>();
  for (const r of (fx.data ?? []) as Fx[]) {
    const a = porFaixa.get(r.faixa) ?? { ordem: r.ordem, d: 0, f: 0, r: 0, p: 0 };
    a.d += r.decididas; a.f += r.fechadas; a.r += r.recusadas; a.p += r.perdidas; porFaixa.set(r.faixa, a);
  }
  const faixas = [...porFaixa.entries()].sort((a, b) => a[1].ordem - b[1].ordem);
  const totC = faixas.reduce((t, [, v]) => ({ d: t.d + v.d, f: t.f + v.f, r: t.r + v.r, p: t.p + v.p }), { d: 0, f: 0, r: 0, p: 0 });
  const maxFaixa = Math.max(...faixas.map(([, v]) => pct(v.f, v.d) ?? 0), 1);
  const serie = ((ms.data ?? []) as MesCoorte[]).filter((m) => m.decididas >= 100).slice(-36);
  const maxSerie = Math.max(...serie.map((m) => pct(m.fechadas, m.decididas) ?? 0), 1);

  return (
    <>
      {f && (
        <Secao
          titulo="Seguro Fiança: funil do período"
          legenda="Mesma conta do painel /seguro-fianca e do Power BI: cada evento conta no mês em que aconteceu (entrada, aprovação, recusa, perda, conversão). As taxas são razões entre eventos do período, a régua do painel (convertidas ÷ recebidas). Para comparar perfis de cotação use a visão por coorte, mais abaixo."
        >
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Cartao rotulo="Recebidas" valor={inteiro.format(f.entradas)} linhas={["cotações novas"]} />
            <Cartao rotulo="Aprovadas" valor={inteiro.format(f.aprovacoes)} linhas={[`${fp(pct(f.aprovacoes, f.entradas))} das recebidas`]} />
            <Cartao rotulo="Recusadas" valor={inteiro.format(f.recusas)} linhas={[`${fp(pct(f.recusas, f.entradas))} das recebidas`]} />
            <Cartao rotulo="Perdidas" valor={inteiro.format(f.perdas)} linhas={[`${fp(pct(f.perdas, f.entradas))} das recebidas`]} />
            <Cartao rotulo="Convertidas" valor={inteiro.format(f.conversoes)} linhas={[`${fp(pct(f.conversoes, f.entradas))} das recebidas`]} />
          </div>
        </Secao>
      )}
      <Secao
        titulo="Todos os produtos"
        legenda="Funil de cotações novas de cada produto, na régua de conversão do painel dele. Incêndio conta itens (cada endereço)."
      >
        <table className="w-full text-xs">
          <thead className="text-left uppercase tracking-wide text-o2-cinza-medio">
            <tr>
              <th className="py-1">Produto</th>
              <th className="py-1 text-right">Recebidas</th>
              <th className="py-1 text-right">Aprovadas</th>
              <th className="py-1 text-right">Recusadas</th>
              <th className="py-1 text-right">Perdidas</th>
              <th className="py-1 text-right">Convertidas</th>
              <th className="py-1 text-right">Conversão</th>
            </tr>
          </thead>
          <tbody>
            {cot.map((c) => {
              const [x, y] = PRODUTOS[c.produto].calc(c);
              return (
                <tr key={c.produto} className="border-t border-gray-100">
                  <td className="py-1.5 font-medium text-o2-navy">{PRODUTOS[c.produto].rotulo}</td>
                  <td className="py-1.5 text-right tabular-nums">{inteiro.format(c.entradas)}</td>
                  <td className="py-1.5 text-right tabular-nums text-o2-cinza-medio">{c.aprovacoes ? inteiro.format(c.aprovacoes) : "—"}</td>
                  <td className="py-1.5 text-right tabular-nums text-o2-cinza-medio">{c.recusas ? inteiro.format(c.recusas) : "—"}</td>
                  <td className="py-1.5 text-right tabular-nums">{inteiro.format(c.perdas)}</td>
                  <td className="py-1.5 text-right tabular-nums">{inteiro.format(c.conversoes)}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">
                    {fpn(x, y)}
                    <span className="block text-[10px] font-normal text-o2-cinza-medio">{PRODUTOS[c.produto].regua}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Secao>
      <Secao
        titulo="Fiança: fechamento por faixa de aluguel (coorte de entrada)"
        legenda="Aqui cada cotação conta no mês em que ENTROU e só entram as já decididas (fechada, perdida ou recusada), por isso as taxas diferem das do quadro acima (que soma eventos do mês). Serve para comparar perfis: quanto maior o aluguel, menos fecha; a recusa pela seguradora é maior nos aluguéis muito baixos e muito altos. Os 2 meses mais recentes ficam de fora (cotações ainda em andamento). Faixas com menos de 30 casos mostram só o número."
      >
        <p className="text-xs text-o2-cinza-escuro">
          No período: <b>{fpn(totC.f, totC.d)}</b> fecham, <b>{fpn(totC.r, totC.d)}</b> são recusadas pela seguradora e, das aprovadas, <b>{fpn(totC.f, totC.f + totC.p)}</b> fecham ({inteiro.format(totC.d)} cotações decididas, {rotuloMes(de)} a {rotuloMes(fimCoorte)}).
        </p>
        {faixas.length === 0 ? (
          <Aviso>Sem cotações decididas neste período.</Aviso>
        ) : (
          <div className="space-y-2">
            {faixas.map(([nome, v]) => (
              <div key={nome} className="grid grid-cols-[6.5rem_1fr_11rem] items-center gap-3 text-xs">
                <span className="text-o2-cinza-escuro">R$ {nome}</span>
                <Barra valor={v.d >= MIN_AMOSTRA ? (pct(v.f, v.d) ?? 0) : 0} max={maxFaixa} />
                <span className="tabular-nums text-o2-navy">
                  <b>{fpn(v.f, v.d)}</b> fecha · <span className="text-o2-cinza-medio">{fpn(v.r, v.d)} recusa · n={inteiro.format(v.d)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </Secao>
      <Secao titulo="Fiança: fechamento mês a mês (coorte de entrada)" legenda="% das cotações decididas que fecharam, por mês em que a cotação entrou. Só meses com 100 ou mais decididas; os 2 meses mais recentes ficam de fora porque ainda há cotações em andamento. Passe o mouse nas barras para ver o mês.">
        {serie.length === 0 ? (
          <Aviso>Sem meses suficientes neste período.</Aviso>
        ) : (
          <>
            <div className="flex h-28 items-end gap-0.5">
              {serie.map((m) => {
                const v = pct(m.fechadas, m.decididas) ?? 0;
                return (
                  <div key={m.mes} className="group flex h-full flex-1 flex-col justify-end" title={`${rotuloMes(m.mes)}: ${dec1.format(v)}% (${m.fechadas} de ${m.decididas})`}>
                    <div className="rounded-t bg-o2-navy/80 group-hover:bg-o2-coral" style={{ height: `${(v / maxSerie) * 100}%` }} />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-o2-cinza-medio">
              <span>{rotuloMes(serie[0].mes)}</span>
              <span>{rotuloMes(serie[serie.length - 1].mes)}</span>
            </div>
          </>
        )}
      </Secao>
    </>
  );
}

// ───────────────────────── Preço ─────────────────────────
type Preco = { seguradora: string; apolices: number; premio_alugueis_mediana: number; premio_alugueis_p25: number; premio_alugueis_p75: number };
type Part = { ano: number; seguradora: string; apolices: number; pct: number };

async function PrecoFianca() {
  const sb = await createClient();
  const [preco, part] = await Promise.all([
    sb.from("analise_preco_seguradora").select("*").order("premio_alugueis_mediana"),
    sb.from("analise_mercado_seguradora_ano").select("*").gte("ano", 2022).order("ano"),
  ]);
  if (preco.error || part.error) return <Erro msg={preco.error?.message ?? part.error?.message ?? ""} />;
  const precos = (preco.data ?? []) as Preco[];
  const parts = (part.data ?? []) as Part[];
  const anos = [...new Set(parts.map((p) => p.ano))];
  const nAno = new Map<number, number>();
  for (const p of parts) nAno.set(p.ano, (nAno.get(p.ano) ?? 0) + p.apolices);
  const ult = anos.at(-1);
  const segs = [...new Set(parts.map((p) => p.seguradora))].sort((a, b) => (parts.find((p) => p.seguradora === b && p.ano === ult)?.pct ?? 0) - (parts.find((p) => p.seguradora === a && p.ano === ult)?.pct ?? 0));
  const apolicesPreco = precos.reduce((t, p) => t + p.apolices, 0);
  const tipico = apolicesPreco ? precos.reduce((t, p) => t + p.premio_alugueis_mediana * p.apolices, 0) / apolicesPreco : null;
  return (
    <>
      <Aviso>
        <b>Atenção:</b> o preço só é conhecido para cotações que <b>fecharam</b> (a seguradora e o prêmio das perdidas e recusadas não ficam guardados nas planilhas). Desde novembro/2026 o sistema passou a guardar a oferta de cada seguradora também nas perdidas (Bitrix); quando houver volume, entra aqui a comparação entre ofertas.
      </Aviso>
      <Secao
        titulo="Fiança: preço praticado por seguradora"
        legenda="Prêmio anual em número de aluguéis (mediana das apólices de Fiança fechadas de 2024 em diante; metade fica entre o 25% e o 75%). Parcela mensal = prêmio ÷ 12. É o que cada seguradora cobrou nas apólices fechadas, não uma tabela de preços."
      >
        {tipico != null && (
          <p className="text-xs text-o2-cinza-escuro">
            Preço típico da carteira: cerca de <b>{dec2.format(tipico)} aluguéis por ano</b> (média das medianas, ponderada pelo número de apólices), isto é, parcela mensal ≈ {fp((tipico / 12) * 100)} do aluguel.
          </p>
        )}
        <table className="w-full text-xs">
          <thead className="text-left uppercase tracking-wide text-o2-cinza-medio">
            <tr>
              <th className="py-1">Seguradora</th>
              <th className="py-1 text-right">Prêmio em aluguéis</th>
              <th className="py-1 text-right">Faixa (25%–75%)</th>
              <th className="py-1 text-right">Parcela / aluguel</th>
              <th className="py-1 text-right">Apólices</th>
            </tr>
          </thead>
          <tbody>
            {precos.map((p) => (
              <tr key={p.seguradora} className="border-t border-gray-100">
                <td className="py-1.5 font-medium text-o2-navy">{p.seguradora}</td>
                <td className="py-1.5 text-right tabular-nums">{dec2.format(p.premio_alugueis_mediana)}</td>
                <td className="py-1.5 text-right tabular-nums text-o2-cinza-medio">{dec2.format(p.premio_alugueis_p25)} a {dec2.format(p.premio_alugueis_p75)}</td>
                <td className="py-1.5 text-right tabular-nums">{fp((p.premio_alugueis_mediana / 12) * 100)}</td>
                <td className="py-1.5 text-right tabular-nums text-o2-cinza-medio">{inteiro.format(p.apolices)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Secao>
      {anos.length > 0 && (
        <Secao titulo="Fiança: participação de cada seguradora nas apólices fechadas" legenda="% das cotações de Fiança fechadas em cada ano (pelo ano da cotação) por seguradora. Mostra a migração da carteira. Anos com menos de 30 apólices de uma seguradora aparecem como 'n baixo'.">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left uppercase tracking-wide text-o2-cinza-medio">
                <tr>
                  <th className="py-1">Seguradora</th>
                  {anos.map((a) => (
                    <th key={a} className="py-1 text-right">{a}<span className="block text-[10px] font-normal normal-case">{inteiro.format(nAno.get(a) ?? 0)} apól.</span></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {segs.map((s) => (
                  <tr key={s} className="border-t border-gray-100">
                    <td className="py-1.5 font-medium text-o2-navy">{s}</td>
                    {anos.map((a) => {
                      const x = parts.find((p) => p.seguradora === s && p.ano === a);
                      return (
                        <td key={a} className="py-1.5 text-right tabular-nums text-o2-cinza-escuro">{x == null ? "—" : x.apolices >= MIN_AMOSTRA ? fp(x.pct) : "n baixo"}</td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Aviso>{ult ? `${ult}: dados até o último dia atualizado.` : ""}</Aviso>
        </Secao>
      )}
    </>
  );
}

// ───────────────────────── Região ─────────────────────────
type Regiao = { cep5?: string; cidade: string | null; uf?: string | null; bairro?: string | null; n: number; p25: number; mediana: number; p75: number };

async function RegiaoFianca() {
  const sb = await createClient();
  const [cidades, ceps] = await Promise.all([
    sb.from("analise_aluguel_cidade").select("*").order("n", { ascending: false }).limit(10),
    sb.from("analise_aluguel_cep5").select("*").gte("n", 30).order("n", { ascending: false }).limit(10),
  ]);
  if (cidades.error || ceps.error) return <Erro msg={cidades.error?.message ?? ceps.error?.message ?? ""} />;
  const dCid = (cidades.data ?? []) as Regiao[];
  const dCep = (ceps.data ?? []) as Regiao[];
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Secao titulo="Aluguel por cidade (24 meses)" legenda="Aluguel das cotações de Fiança (contratação nova, 24 meses) da carteira da O2 nas 10 cidades com mais cotações. Mediana e faixa em que cai metade dos contratos (25% a 75%). Não é o mercado inteiro.">
        <table className="w-full text-xs">
          <tbody>
            {dCid.map((c) => (
              <tr key={`${c.cidade}${c.uf}`} className="border-t border-gray-100 first:border-0">
                <td className="py-1.5 font-medium text-o2-navy">{titulo(c.cidade)}<span className="block text-[10px] font-normal text-o2-cinza-medio">{inteiro.format(c.n)} cotações</span></td>
                <td className="py-1.5 text-right tabular-nums">{reais.format(c.mediana)}<span className="block text-[10px] text-o2-cinza-medio">{reais.format(c.p25)} a {reais.format(c.p75)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Secao>
      <Secao titulo="Aluguel por bairro (24 meses, CEP)" legenda="Mesma base, agrupada pelos 5 primeiros dígitos do CEP (bairro). Só regiões com 30 ou mais cotações; o nome do bairro é o mais frequente nas cotações.">
        <table className="w-full text-xs">
          <tbody>
            {dCep.map((c) => (
              <tr key={c.cep5} className="border-t border-gray-100 first:border-0">
                <td className="py-1.5 font-medium text-o2-navy">{c.bairro ? titulo(c.bairro) : `CEP ${c.cep5}-***`}<span className="block text-[10px] font-normal text-o2-cinza-medio">{titulo(c.cidade)} · {inteiro.format(c.n)} cotações</span></td>
                <td className="py-1.5 text-right tabular-nums">{reais.format(c.mediana)}<span className="block text-[10px] text-o2-cinza-medio">{reais.format(c.p25)} a {reais.format(c.p75)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Secao>
    </div>
  );
}

// ───────────────────────── Parceiros ─────────────────────────
type Imob = { chave: string; decididas_24m: number; fechadas_24m: number };

async function ParceirosFianca() {
  const sb = await createClient();
  const { data, error } = await sb.from("analise_visita_imob").select("chave, decididas_24m, fechadas_24m").eq("tipo", "i").gte("decididas_24m", 100);
  if (error) return <Erro msg={error.message} />;
  const ordenadas = ((data ?? []) as Imob[]).map((i) => ({ ...i, conv: (100 * i.fechadas_24m) / i.decididas_24m })).sort((a, b) => b.conv - a.conv);
  const destaques = [...ordenadas.slice(0, 5), ...ordenadas.slice(-5)];
  const { data: nomesRows } = destaques.length ? await sb.from("imobiliarias").select("id, nome, apelido").in("id", destaques.map((d) => d.chave)) : { data: [] };
  const nome = new Map((nomesRows ?? []).map((r: { id: string; nome: string; apelido: string | null }) => [r.id, r.apelido || r.nome]));
  if (ordenadas.length === 0) return <Aviso>Nenhuma imobiliária com 100 ou mais cotações decididas em 24 meses.</Aviso>;
  return (
    <Secao titulo="Imobiliárias: quem mais e quem menos fecha (24 meses)" legenda="Imobiliárias com 100 ou mais cotações de Fiança decididas em 24 meses, ordenadas pela taxa de fechamento. O número depende também do perfil de aluguel e da recusa pela seguradora de cada uma. Para a ficha completa de uma imobiliária, peça no chat interno.">
      <div className="grid gap-5 sm:grid-cols-2">
        {[
          { rotulo: "Mais fecham", lista: ordenadas.slice(0, 5) },
          { rotulo: "Menos fecham", lista: ordenadas.slice(-5).reverse() },
        ].map((g) => (
          <div key={g.rotulo}>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-o2-cinza-medio">{g.rotulo}</p>
            <table className="w-full text-xs">
              <tbody>
                {g.lista.map((i) => (
                  <tr key={i.chave} className="border-t border-gray-100 first:border-0">
                    <td className="py-1.5 text-o2-navy">{titulo(nome.get(i.chave) ?? "?")}<span className="block text-[10px] text-o2-cinza-medio">{inteiro.format(i.decididas_24m)} decididas</span></td>
                    <td className="py-1.5 text-right font-semibold tabular-nums">{fp(i.conv)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Secao>
  );
}

// ───────────────────────── Margem e repasse (admin) ─────────────────────────
type Margem = { produto: string; seguradora: string; ano: number; apolices: number; premio_liquido: number; comissao: number; repasse: number };

async function Margem() {
  const sb = await createClient();
  const { data, error } = await sb.from("analise_margem").select("produto, seguradora, ano, apolices, premio_liquido, comissao, repasse").gte("ano", 2022);
  if (error) return <Erro msg={error.message} />;
  const m = ((data ?? []) as Margem[]).map((x) => ({ ...x, premio_liquido: Number(x.premio_liquido), comissao: Number(x.comissao), repasse: Number(x.repasse) }));
  type Ac = { ap: number; prem: number; com: number; rep: number };
  const soma = (linhas: Margem[]): Ac => linhas.reduce((t, x) => ({ ap: t.ap + x.apolices, prem: t.prem + x.premio_liquido, com: t.com + x.comissao, rep: t.rep + x.repasse }), { ap: 0, prem: 0, com: 0, rep: 0 });
  const recentes = m.filter((x) => x.ano >= 2025);
  const porProduto = [...new Set(recentes.map((x) => x.produto))]
    .map((p) => ({ p, ...soma(recentes.filter((x) => x.produto === p)) }))
    .filter((x) => x.ap >= 20)
    .sort((a, b) => b.com - b.rep - (a.com - a.rep));
  const fiancaSeg = [...new Set(recentes.filter((x) => x.produto === "Fiança").map((x) => x.seguradora))]
    .map((s) => ({ s, ...soma(recentes.filter((x) => x.produto === "Fiança" && x.seguradora === s)) }))
    .filter((x) => x.ap >= 30)
    .sort((a, b) => b.com - b.rep - (a.com - a.rep));
  const anos = [2022, 2023, 2024, 2025, 2026];
  const principais = ["Fiança", "Incêndio imobiliário", "Capitalização"];
  return (
    <>
      <Aviso>Margem = comissão − repasse previsto à imobiliária (inclui o pró-labore, que é repasse negociado). Apólices vigentes ou vencidas, pelo ano de início de vigência. É margem de comissão: não desconta custos nem impostos. Só administradores veem esta parte.</Aviso>
      <Secao titulo="Margem por produto (2025–2026)" legenda="Soma de 2025 e 2026 (até agora). Mostra quanto cada produto deixa depois do repasse e quanto sobra por apólice.">
        <div className="grid gap-3 sm:grid-cols-3">
          {porProduto.slice(0, 3).map((p) => (
            <Cartao key={p.p} rotulo={p.p} valor={reais.format(p.com - p.rep)} linhas={[`${inteiro.format(p.ap)} apólices`, `${reais.format((p.com - p.rep) / p.ap)} por apólice`, `repasse = ${fp(pct(p.rep, p.com))} da comissão`]} />
          ))}
        </div>
      </Secao>
      <Secao titulo="Evolução por ano" legenda="Para cada produto principal: comissão sobre o prêmio, repasse sobre a comissão e margem por apólice, ano a ano (2026 até agora). Mostra como o negócio mudou: por exemplo, o repasse do Incêndio imobiliário caiu muito desde 2020.">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left uppercase tracking-wide text-o2-cinza-medio">
              <tr>
                <th className="py-1">Produto · indicador</th>
                {anos.map((a) => (
                  <th key={a} className="py-1 text-right">{a}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {principais.flatMap((p) => {
                const porAno = anos.map((a) => soma(m.filter((x) => x.produto === p && x.ano === a)));
                return [
                  { k: `${p}|a`, rot: `${p} · comissão / prêmio`, v: porAno.map((s) => (s.ap >= 20 ? fp(pct(s.com, s.prem)) : "—")) },
                  { k: `${p}|b`, rot: `${p} · repasse / comissão`, v: porAno.map((s) => (s.ap >= 20 ? fp(pct(s.rep, s.com)) : "—")) },
                  { k: `${p}|c`, rot: `${p} · margem por apólice`, v: porAno.map((s) => (s.ap >= 20 ? reais.format((s.com - s.rep) / s.ap) : "—")) },
                ].map((l) => (
                  <tr key={l.k} className="border-t border-gray-100">
                    <td className="py-1.5 text-o2-navy">{l.rot}</td>
                    {l.v.map((x, i) => (
                      <td key={i} className="py-1.5 text-right tabular-nums text-o2-cinza-escuro">{x}</td>
                    ))}
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      </Secao>
      {fiancaSeg.length > 0 && (
        <Secao titulo="Fiança: margem por seguradora (2025–2026)" legenda="Seguradoras com 30 ou mais apólices de Fiança no período.">
          <table className="w-full text-xs">
            <thead className="text-left uppercase tracking-wide text-o2-cinza-medio">
              <tr>
                <th className="py-1">Seguradora</th>
                <th className="py-1 text-right">Apólices</th>
                <th className="py-1 text-right">Margem</th>
                <th className="py-1 text-right">Por apólice</th>
                <th className="py-1 text-right">Repasse / comissão</th>
              </tr>
            </thead>
            <tbody>
              {fiancaSeg.map((v) => (
                <tr key={v.s} className="border-t border-gray-100">
                  <td className="py-1.5 font-medium text-o2-navy">{titulo(v.s)}</td>
                  <td className="py-1.5 text-right tabular-nums">{inteiro.format(v.ap)}</td>
                  <td className="py-1.5 text-right tabular-nums">{reais.format(v.com - v.rep)}</td>
                  <td className="py-1.5 text-right tabular-nums">{reais.format((v.com - v.rep) / v.ap)}</td>
                  <td className="py-1.5 text-right tabular-nums text-o2-cinza-medio">{fp(pct(v.rep, v.com))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Secao>
      )}
    </>
  );
}

// ───────────────────────── Outros produtos (Incêndio, Capitalização, Automóvel) ─────────────────────────
const ROTULO_PROD: Record<string, string> = { fianca: "Fiança", re: "Incêndio", capitalizacao: "Capitalização", automovel: "Automóvel" };
const BASE_FAIXA: Record<string, string> = { re: "aluguel do imóvel", capitalizacao: "valor do título" };
type FxP = { mes: string; faixa: string; ordem: number; decididas: number; fechadas: number; perdidas: number };

async function FunilOutro({ produto, de, ate }: { produto: ProdutoEstat; de: string; ate: string }) {
  const sb = await createClient();
  const { k, erro } = await kpisDoPeriodo(de, ate);
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
  const fimCoorte = ate < somarMeses(hoje, -2) ? ate : somarMeses(hoje, -2);
  const [fx, mot] = await Promise.all([
    sb.from("analise_prod_mes_faixa").select("mes, faixa, ordem, decididas, fechadas, perdidas").eq("produto", produto).gte("mes", `${de}-01`).lte("mes", `${fimCoorte}-28`),
    produto === "capitalizacao" ? sb.from("analise_prod_motivo").select("motivo, n").eq("produto", produto).order("n", { ascending: false }) : Promise.resolve({ data: [] as { motivo: string; n: number }[], error: null }),
  ]);
  if (!k || fx.error || mot.error) return <Erro msg={erro ?? fx.error?.message ?? mot.error?.message ?? "sem dados"} />;
  const c = k.funil_por_produto.find((x) => x.produto === produto);
  const linhas = (fx.data ?? []) as FxP[];
  const porFaixa = new Map<string, { ordem: number; d: number; f: number }>();
  const porMes = new Map<string, { d: number; f: number }>();
  for (const r of linhas) {
    const a = porFaixa.get(r.faixa) ?? { ordem: r.ordem, d: 0, f: 0 };
    a.d += r.decididas;
    a.f += r.fechadas;
    porFaixa.set(r.faixa, a);
    const m = porMes.get(r.mes) ?? { d: 0, f: 0 };
    m.d += r.decididas;
    m.f += r.fechadas;
    porMes.set(r.mes, m);
  }
  const faixas = [...porFaixa.entries()].sort((a, b) => a[1].ordem - b[1].ordem);
  const tot = faixas.reduce((t, [, v]) => ({ d: t.d + v.d, f: t.f + v.f }), { d: 0, f: 0 });
  const maxFaixa = Math.max(...faixas.map(([, v]) => (v.d >= MIN_AMOSTRA ? (pct(v.f, v.d) ?? 0) : 0)), 1);
  const minMes = produto === "re" ? 60 : 20;
  const serie = [...porMes.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).filter(([, v]) => v.d >= minMes).slice(-36);
  const maxSerie = Math.max(...serie.map(([, v]) => pct(v.f, v.d) ?? 0), 1);
  const motivos = (mot.data ?? []) as { motivo: string; n: number }[];
  const totMot = motivos.reduce((t, m) => t + m.n, 0);
  const nome = ROTULO_PROD[produto];
  return (
    <>
      {c && (
        <Secao titulo={`${nome}: funil do período`} legenda="Mesma conta do Power BI (/producao): cada evento conta no mês em que aconteceu. A conversão usa a régua do painel do produto.">
          <div className="grid gap-3 sm:grid-cols-3">
            <Cartao rotulo="Recebidas" valor={inteiro.format(c.entradas)} linhas={[produto === "re" ? "itens (cada endereço)" : "cotações novas"]} />
            <Cartao rotulo="Perdidas" valor={inteiro.format(c.perdas)} linhas={[]} />
            <Cartao rotulo="Convertidas" valor={inteiro.format(c.conversoes)} linhas={[`conversão ${fpn(...PRODUTOS[produto].calc(c))} (${PRODUTOS[produto].regua})`]} />
          </div>
        </Secao>
      )}
      {produto === "automovel" ? (
        <Aviso>Automóvel tem poucas cotações com histórico e não guarda valor do bem nem prêmio das perdidas; por isso não há quebra por faixa. Acompanhe o funil acima.</Aviso>
      ) : (
        <>
          <Secao
            titulo={`${nome}: fechamento por faixa de ${BASE_FAIXA[produto]} (coorte de entrada)`}
            legenda={`Cada cotação conta no mês em que ENTROU e só entram as já decididas (fechada ou perdida), por isso as taxas diferem do quadro de eventos acima. Mostra como o fechamento muda com o ${BASE_FAIXA[produto]}. Os 2 meses mais recentes ficam de fora (cotações em andamento). Faixas com menos de 30 casos mostram só o número. "Sem informação" = cotações sem esse dado na planilha.`}
          >
            <p className="text-xs text-o2-cinza-escuro">
              No período: <b>{fpn(tot.f, tot.d)}</b> fecham ({inteiro.format(tot.d)} decididas, {rotuloMes(de)} a {rotuloMes(fimCoorte)}).
            </p>
            {faixas.length === 0 ? (
              <Aviso>Sem cotações decididas neste período.</Aviso>
            ) : (
              <div className="space-y-2">
                {faixas.map(([nomeF, v]) => (
                  <div key={nomeF} className="grid grid-cols-[7.5rem_1fr_9rem] items-center gap-3 text-xs">
                    <span className="text-o2-cinza-escuro">{nomeF === "Sem informação" ? nomeF : `R$ ${nomeF}`}</span>
                    <Barra valor={v.d >= MIN_AMOSTRA ? (pct(v.f, v.d) ?? 0) : 0} max={maxFaixa} />
                    <span className="tabular-nums text-o2-navy">
                      <b>{fpn(v.f, v.d)}</b> <span className="text-o2-cinza-medio">· n={inteiro.format(v.d)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Secao>
          <Secao titulo={`${nome}: fechamento mês a mês (coorte de entrada)`} legenda={`% das cotações decididas que fecharam, por mês em que a cotação entrou. Só meses com ${minMes} ou mais decididas; os 2 meses mais recentes ficam de fora. Passe o mouse nas barras para ver o mês.`}>
            {serie.length === 0 ? (
              <Aviso>Sem meses suficientes neste período.</Aviso>
            ) : (
              <>
                <div className="flex h-28 items-end gap-0.5">
                  {serie.map(([mes, v]) => {
                    const t = pct(v.f, v.d) ?? 0;
                    return (
                      <div key={mes} className="group flex h-full flex-1 flex-col justify-end" title={`${rotuloMes(mes)}: ${dec1.format(t)}% (${v.f} de ${v.d})`}>
                        <div className="rounded-t bg-o2-navy/80 group-hover:bg-o2-coral" style={{ height: `${(t / maxSerie) * 100}%` }} />
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-o2-cinza-medio">
                  <span>{rotuloMes(serie[0][0])}</span>
                  <span>{rotuloMes(serie[serie.length - 1][0])}</span>
                </div>
              </>
            )}
          </Secao>
        </>
      )}
      {produto === "re" && <SegmentoRe />}
      {produto === "capitalizacao" && motivos.length > 0 && (
        <Secao
          titulo="Capitalização: por que as cotações se perdem"
          legenda="Motivo de desistência registrado nas planilhas das cotações perdidas (todo o histórico, desde 2021; só as que têm motivo preenchido)."
        >
          <div className="space-y-2">
            {motivos.map((m) => (
              <div key={m.motivo} className="grid grid-cols-[11rem_1fr_6rem] items-center gap-3 text-xs">
                <span className="text-o2-cinza-escuro">{titulo(m.motivo)}</span>
                <Barra valor={m.n} max={motivos[0].n} cor="#B42318" />
                <span className="tabular-nums text-o2-navy">
                  <b>{fp(pct(m.n, totMot))}</b> <span className="text-o2-cinza-medio">· {inteiro.format(m.n)}</span>
                </span>
              </div>
            ))}
          </div>
        </Secao>
      )}
    </>
  );
}

async function SegmentoRe() {
  const sb = await createClient();
  const { data, error } = await sb.from("analise_prod_segmento").select("*").eq("produto", "re");
  if (error || !data?.length) return null;
  const linhas = data as { segmento: string; decididas: number; fechadas: number; premio_med: number | null; k_med: number | null }[];
  return (
    <Secao
      titulo="Incêndio: residencial x comercial (24 meses)"
      legenda="Ocupação do imóvel informada na cotação. Residencial = apartamento, casa e condomínio residencial; comercial/serviços = lojas, escritórios, consultórios e demais atividades. Prêmio = mediana das fechadas; relação = prêmio ÷ aluguel."
    >
      <table className="w-full text-xs">
        <thead className="text-left uppercase tracking-wide text-o2-cinza-medio">
          <tr>
            <th className="py-1">Tipo</th>
            <th className="py-1 text-right">Decididas</th>
            <th className="py-1 text-right">Fecham</th>
            <th className="py-1 text-right">Prêmio mediano</th>
            <th className="py-1 text-right">Prêmio ÷ aluguel</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.segmento} className="border-t border-gray-100">
              <td className="py-1.5 font-medium text-o2-navy">{l.segmento}</td>
              <td className="py-1.5 text-right tabular-nums text-o2-cinza-medio">{inteiro.format(l.decididas)}</td>
              <td className="py-1.5 text-right font-semibold tabular-nums">{fpn(l.fechadas, l.decididas)}</td>
              <td className="py-1.5 text-right tabular-nums">{l.premio_med == null ? "—" : reais.format(Number(l.premio_med))}</td>
              <td className="py-1.5 text-right tabular-nums">{l.k_med == null ? "—" : fp(Number(l.k_med) * 100)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Secao>
  );
}

type PrecoP = { seguradora: string; n: number; premio_med: number | null; premio_p25: number | null; premio_p75: number | null; k_med: number | null; titulo_med: number | null; com_pct_med: number | null };
type PartP = { ano: number; seguradora: string; n: number; pct: number };

async function PrecoOutro({ produto }: { produto: ProdutoEstat }) {
  const sb = await createClient();
  const [pr, pa] = await Promise.all([
    sb.from("analise_prod_preco").select("*").eq("produto", produto).order("n", { ascending: false }),
    sb.from("analise_prod_seg_ano").select("ano, seguradora, n, pct").eq("produto", produto).gte("ano", 2022).order("ano"),
  ]);
  if (pr.error || pa.error) return <Erro msg={pr.error?.message ?? pa.error?.message ?? ""} />;
  const precos = ((pr.data ?? []) as PrecoP[]).filter((p) => p.n >= 10);
  const parts = (pa.data ?? []) as PartP[];
  const anos = [...new Set(parts.map((p) => p.ano))];
  const nAno = new Map<number, number>();
  for (const p of parts) nAno.set(p.ano, (nAno.get(p.ano) ?? 0) + p.n);
  const ult = anos.at(-1);
  const segs = [...new Set(parts.map((p) => p.seguradora))].sort((a, b) => (parts.find((p) => p.seguradora === b && p.ano === ult)?.pct ?? 0) - (parts.find((p) => p.seguradora === a && p.ano === ult)?.pct ?? 0));
  const nome = ROTULO_PROD[produto];
  const ehCap = produto === "capitalizacao";
  const ehRe = produto === "re";
  return (
    <>
      <Aviso>
        <b>Atenção:</b> o preço só é conhecido para cotações que <b>fecharam</b> (a perdida não guarda prêmio). Janela de 24 meses; seguradoras com menos de 10 fechadas ficam de fora.
        {ehRe && " Na planilha de Incêndio muitas cotações trazem só “Segimob” como seguradora (a seguradora efetiva não foi informada); elas aparecem separadas, sem presumir qual é."}
      </Aviso>
      {precos.length === 0 ? (
        <Aviso>Sem fechadas com prêmio suficiente neste produto.</Aviso>
      ) : (
        <Secao
          titulo={`${nome}: preço praticado por seguradora`}
          legenda={
            ehCap
              ? "Capitalização: o 'prêmio' é o valor do título. Mostra o valor mediano do título e a comissão ÷ valor, por seguradora, das cotações fechadas."
              : ehRe
                ? "Incêndio: prêmio anual mediano das cotações fechadas (metade fica entre o 25% e o 75%), a relação prêmio ÷ aluguel mensal do imóvel e a comissão sobre o prêmio."
                : "Prêmio mediano das cotações de Automóvel fechadas. Amostra pequena: use como referência, não como regra."
          }
        >
          <table className="w-full text-xs">
            <thead className="text-left uppercase tracking-wide text-o2-cinza-medio">
              <tr>
                <th className="py-1">Seguradora</th>
                <th className="py-1 text-right">Fechadas</th>
                <th className="py-1 text-right">{ehCap ? "Valor do título" : "Prêmio mediano"}</th>
                {!ehCap && <th className="py-1 text-right">Faixa (25%–75%)</th>}
                {ehRe && <th className="py-1 text-right">Prêmio ÷ aluguel</th>}
                <th className="py-1 text-right">Comissão ÷ prêmio</th>
              </tr>
            </thead>
            <tbody>
              {precos.map((p) => (
                <tr key={p.seguradora} className="border-t border-gray-100">
                  <td className="py-1.5 font-medium text-o2-navy">{p.seguradora}</td>
                  <td className="py-1.5 text-right tabular-nums text-o2-cinza-medio">{inteiro.format(p.n)}</td>
                  <td className="py-1.5 text-right tabular-nums">{p.premio_med == null ? "—" : reais.format(Number(p.premio_med))}</td>
                  {!ehCap && <td className="py-1.5 text-right tabular-nums text-o2-cinza-medio">{p.premio_p25 == null ? "—" : `${reais.format(Number(p.premio_p25))} a ${reais.format(Number(p.premio_p75))}`}</td>}
                  {ehRe && <td className="py-1.5 text-right tabular-nums">{p.k_med == null ? "—" : fp(Number(p.k_med) * 100)}</td>}
                  <td className="py-1.5 text-right tabular-nums">{p.com_pct_med == null ? "—" : fp(Number(p.com_pct_med) * 100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Secao>
      )}
      {anos.length > 0 && (
        <Secao titulo={`${nome}: participação de cada seguradora nas fechadas`} legenda="% das cotações fechadas em cada ano (pelo ano da cotação), por seguradora. Células com menos de 30 casos aparecem como 'n baixo'.">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left uppercase tracking-wide text-o2-cinza-medio">
                <tr>
                  <th className="py-1">Seguradora</th>
                  {anos.map((a) => (
                    <th key={a} className="py-1 text-right">
                      {a}
                      <span className="block text-[10px] font-normal normal-case">{inteiro.format(nAno.get(a) ?? 0)} fech.</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {segs.map((sg) => (
                  <tr key={sg} className="border-t border-gray-100">
                    <td className="py-1.5 font-medium text-o2-navy">{sg}</td>
                    {anos.map((a) => {
                      const x = parts.find((p) => p.seguradora === sg && p.ano === a);
                      return (
                        <td key={a} className="py-1.5 text-right tabular-nums text-o2-cinza-escuro">
                          {x == null ? "—" : x.n >= MIN_AMOSTRA ? fp(Number(x.pct)) : "n baixo"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Secao>
      )}
    </>
  );
}

function SemEndereco({ produto }: { produto: ProdutoEstat }) {
  return <Aviso>{ROTULO_PROD[produto]} não registra o endereço do imóvel nas cotações, então não há análise por região. Veja Fiança ou Incêndio.</Aviso>;
}

type RegP = { cep5: string; cidade: string | null; bairro: string | null; n: number; p25: number; mediana: number; p75: number; premio_med: number | null };

async function RegiaoRe() {
  const sb = await createClient();
  const { data, error } = await sb.from("analise_prod_regiao").select("cep5, cidade, bairro, n, p25, mediana, p75, premio_med").eq("produto", "re").gte("n", 15).order("n", { ascending: false }).limit(12);
  if (error) return <Erro msg={error.message} />;
  const linhas = (data ?? []) as RegP[];
  if (linhas.length === 0) return <Aviso>Sem regiões com 15 ou mais cotações de Incêndio com CEP.</Aviso>;
  return (
    <Secao
      titulo="Incêndio: aluguel e prêmio por bairro (24 meses, CEP)"
      legenda="Cotações de Incêndio com CEP válido, agrupadas pelos 5 primeiros dígitos (bairro). Aluguel = o do imóvel segurado; prêmio = mediana das fechadas. Só regiões com 15 ou mais cotações. Carteira da O2, não o mercado inteiro."
    >
      <table className="w-full text-xs">
        <thead className="text-left uppercase tracking-wide text-o2-cinza-medio">
          <tr>
            <th className="py-1">Bairro</th>
            <th className="py-1 text-right">Cotações</th>
            <th className="py-1 text-right">Aluguel</th>
            <th className="py-1 text-right">Prêmio</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.cep5} className="border-t border-gray-100">
              <td className="py-1.5 font-medium text-o2-navy">
                {l.bairro ? titulo(l.bairro) : `CEP ${l.cep5}-***`}
                <span className="block text-[10px] font-normal text-o2-cinza-medio">{titulo(l.cidade)}</span>
              </td>
              <td className="py-1.5 text-right tabular-nums text-o2-cinza-medio">{inteiro.format(l.n)}</td>
              <td className="py-1.5 text-right tabular-nums">
                {reais.format(Number(l.mediana))}
                <span className="block text-[10px] text-o2-cinza-medio">
                  {reais.format(Number(l.p25))} a {reais.format(Number(l.p75))}
                </span>
              </td>
              <td className="py-1.5 text-right tabular-nums">{l.premio_med == null ? "—" : reais.format(Number(l.premio_med))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Secao>
  );
}

async function ParceirosOutro({ produto }: { produto: ProdutoEstat }) {
  if (produto === "automovel") return <Aviso>Automóvel não tem imobiliária vinculada às cotações.</Aviso>;
  const sb = await createClient();
  const minimo = produto === "re" ? 60 : 30;
  const { data, error } = await sb.from("analise_prod_imob").select("imobiliaria_id, decididas, fechadas").eq("produto", produto).gte("decididas", minimo);
  if (error) return <Erro msg={error.message} />;
  const ordenadas = ((data ?? []) as { imobiliaria_id: string; decididas: number; fechadas: number }[]).map((i) => ({ ...i, conv: (100 * i.fechadas) / i.decididas })).sort((a, b) => b.conv - a.conv);
  if (ordenadas.length < 6) return <Aviso>Poucas imobiliárias com {minimo} ou mais cotações decididas em 24 meses neste produto.</Aviso>;
  const destaques = [...ordenadas.slice(0, 5), ...ordenadas.slice(-5)];
  const { data: nomesRows } = await sb.from("imobiliarias").select("id, nome, apelido").in("id", destaques.map((d) => d.imobiliaria_id));
  const nome = new Map((nomesRows ?? []).map((r: { id: string; nome: string; apelido: string | null }) => [r.id, r.apelido || r.nome]));
  return (
    <Secao
      titulo={`${ROTULO_PROD[produto]}: imobiliárias que mais e que menos fecham (24 meses)`}
      legenda={`Imobiliárias com ${minimo} ou mais cotações decididas (fechada ou perdida) em 24 meses, ordenadas pela taxa de fechamento. Para a ficha completa de uma imobiliária, peça no chat interno.`}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        {[
          { rotulo: "Mais fecham", lista: ordenadas.slice(0, 5) },
          { rotulo: "Menos fecham", lista: ordenadas.slice(-5).reverse() },
        ].map((g) => (
          <div key={g.rotulo}>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-o2-cinza-medio">{g.rotulo}</p>
            <table className="w-full text-xs">
              <tbody>
                {g.lista.map((i) => (
                  <tr key={i.imobiliaria_id} className="border-t border-gray-100 first:border-0">
                    <td className="py-1.5 text-o2-navy">
                      {titulo(nome.get(i.imobiliaria_id) ?? "?")}
                      <span className="block text-[10px] text-o2-cinza-medio">{inteiro.format(i.decididas)} decididas</span>
                    </td>
                    <td className="py-1.5 text-right font-semibold tabular-nums">{fp(i.conv)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Secao>
  );
}
