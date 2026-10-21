// Power BI - O2 Seguros › Imobiliária 360 (Matheus, 21/10/2026): todo o
// comportamento de UMA imobiliária ou grupo num lugar só — cadastro, cotações
// de todos os produtos, apólices do Corp, sinistros e uso das ferramentas do
// Workspace (Auditor, Gerador de contrato, Faturas, Campanhas, portal).
// Grupo = soma de todas as fichas, com a quebra por unidade (clicar numa
// unidade mostra só ela). Sem imobiliária escolhida, /producao mostra a O2
// inteira com o ranking (page.tsx) — a antiga aba "Cotações e apólices" virou
// essa visão (21/10/2026). Cotações/apólices: kpis_producao; o resto:
// visao_360_imobiliaria (supabase/schema_visao_360.sql). Só conta o que tem
// vínculo CONFIRMADO.
import Link from "next/link";
import type { ReactNode } from "react";
import type { createClient } from "@/lib/supabase/server";
import InfoLegenda from "@/components/InfoLegenda";
import BarrasMensais from "./BarrasMensais";
import type { OpcaoImob } from "./FiltrosProducao";
import Seletor360 from "./Seletor360";

type Valores = { propostas: number; premio: number; comissao: number };
type CotacaoProduto = {
  produto: string;
  entradas: number;
  aprovacoes: number;
  recusas: number;
  perdas: number;
  conversoes: number;
  premio_convertido: number;
  historico_desde: string | null;
};
type Kpis = {
  resumo: Valores;
  resumo_ano_anterior: Valores;
  por_produto: (Valores & { produto: string; premio_ano_anterior: number; propostas_ano_anterior: number })[];
  mensal: { competencia: string; produtos: Record<string, Valores> }[];
  funil_por_produto: CotacaoProduto[];
  funil_mensal_produto: { competencia: string; produtos: Record<string, Partial<Record<"entrada" | "conversao", number>>> }[];
};
type Unidade = {
  id: string;
  nome: string;
  nome_completo: string;
  papel_no_grupo: string | null;
  cnpj: string | null;
  cidade: string | null;
  uf: string | null;
  cadastro_incompleto: boolean | null;
  codigo_produtor_corp: string | null;
  origem_comercial: string | null;
  logins: number;
  produz_desde: string | null;
  ultima_apolice: string | null;
  ultima_cotacao: string | null;
  cotacoes: number;
  convertidas: number;
  apolices: number;
  premio: number;
  comissao: number;
  sinistros: number;
  indenizado: number;
  sinistros_abertos: number;
  auditorias: number;
  contratos: number;
  faturas: number;
  campanhas_recebidas: number;
  campanhas_abertas: number;
};
type Uso = { periodo: number; total: number; ultima: string | null };
type Visao = {
  alvo: { tipo: "grupo" | "imobiliaria"; id: string; nome: string; tipo_grupo?: string | null; grupo?: { id: string; nome: string; tipo_grupo: string | null } | null } | null;
  unidades: Unidade[];
  fontes: { fonte: string; nomes: number }[];
  sinistros: {
    avisados: number;
    vl_avisado: number;
    indenizados: number;
    vl_indenizado: number;
    sem_indenizacao: number;
    em_andamento: number;
    total_historico: number;
    desde: string | null;
    por_produto: Record<string, number>;
    abertos: { card: string | null; produto: string | null; tipo: string | null; seguradora: string | null; aviso: string | null; vl_avisado: number | null; unidade: string | null }[];
  };
  ferramentas: {
    auditor: Uso & { por_status: Record<string, number> };
    gerador: Uso;
    faturas: Uso;
    campanhas: { recebidas: number; abertas: number; clicadas: number; campanhas: number; ultima: string | null };
    logins: number;
  };
  mensal: { competencia: string; sinistros: number; auditorias: number; contratos: number; faturas: number; campanhas_abertas: number }[];
};

const PRODUTOS: Record<string, { rotulo: string; cor: string }> = {
  capitalizacao: { rotulo: "Capitalização", cor: "#2E6FB7" },
  fianca: { rotulo: "Seguro Fiança", cor: "#F8540D" },
  re: { rotulo: "Ramos Elementares", cor: "#01192e" },
  automovel: { rotulo: "Automóvel", cor: "#9CA3AF" },
};
const ORDEM = ["capitalizacao", "fianca", "re", "automovel"];
// Mesma régua de conversão de cada painel (igual à visão da O2 inteira).
const REGUA: Record<string, { texto: string; calc: (p: CotacaoProduto) => [number, number] }> = {
  fianca: { texto: "convertidas ÷ recebidas", calc: (p) => [p.conversoes, p.entradas] },
  re: { texto: "efetivadas ÷ recebidas", calc: (p) => [p.conversoes, p.entradas] },
  capitalizacao: { texto: "emitidos ÷ (emitidos + perdidos)", calc: (p) => [p.conversoes, p.conversoes + p.perdas] },
  automovel: { texto: "convertidas ÷ (convertidas + perdidas)", calc: (p) => [p.conversoes, p.conversoes + p.perdas] },
};
const ROTULO_FONTE: Record<string, string> = {
  corp_produtor: "Corp",
  planilha_fianca: "Planilha Fiança",
  planilha_re: "Planilha RE",
  planilha_cap: "Planilha Capitalização",
  bitrix_empresa: "Bitrix (Empresa)",
  bitrix_cap_texto: "Bitrix Capitalização",
  receita_cnpj: "Receita (CNPJ)",
  imobiliarias_conhecidas: "Imobiliárias conhecidas",
  email: "E-mail",
};
const PRODUTO_SINISTRO: Record<string, string> = { fianca: "Fiança", capitalizacao: "Capitalização", incendio: "Incêndio", re: "RE", automovel: "Automóvel" };

const MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (m: string | null) => (m ? `${MESES_PT[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}` : "—");
const num = (v: number) => Math.round(v).toLocaleString("pt-BR");
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const compacto = (v: number) =>
  Math.abs(v) >= 1e6
    ? `R$ ${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`
    : Math.abs(v) >= 1e3
      ? `R$ ${Math.round(v / 1e3).toLocaleString("pt-BR")} mil`
      : reais(v);
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—");
const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
function somarMeses(mes: string, n: number) {
  const [a, m] = mes.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

type Cliente = Awaited<ReturnType<typeof createClient>>;

// Visão 360 de UMA imobiliária ou grupo, dentro de /producao (a página abre
// aqui quando o recorte tem exatamente uma imobiliária/grupo).
export async function Imobiliaria360({
  supabase,
  de,
  ate,
  grupo,
  imob,
  mesAtual,
  opcoes,
}: {
  supabase: Cliente;
  de: string;
  ate: string;
  grupo: string | null;
  imob: string | null;
  mesAtual: string;
  opcoes: OpcaoImob[];
}) {
  const alvo = grupo ? `g:${grupo}` : `i:${imob}`;
  const [v, k] = await Promise.all([
    supabase.rpc("visao_360_imobiliaria", { p_tipo: grupo ? "grupo" : "imobiliaria", p_id: grupo ?? imob, p_de: de, p_ate: ate }),
    supabase.rpc("kpis_producao", { p_de: de, p_ate: ate, p_produtos: null, p_grupos: grupo ? [grupo] : null, p_imobs: imob ? [imob] : null, p_seguradoras: null }),
  ]);
  const visao = v.data as Visao | null;
  const kpis = k.data as Kpis | null;
  const erro = v.error?.message ?? k.error?.message ?? null;
  const linkCom = (troca: Record<string, string>) => `/producao?${new URLSearchParams({ de, ate, ...troca }).toString()}`;

  return (
    <>
      <Seletor360 key={`${alvo}|${de}|${ate}`} de={de} ate={ate} alvo={alvo} mesAtual={mesAtual} opcoes={opcoes} />
      <Link href={linkCom({})} className="inline-block text-sm text-o2-blue underline">
        ← Voltar à visão da O2 inteira (todas as imobiliárias e o ranking)
      </Link>
      {erro && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Não foi possível montar a visão agora ({erro}).</p>}
      {visao?.alvo && kpis && <Visao360 visao={visao} kpis={kpis} de={de} ate={ate} linkCom={linkCom} />}
    </>
  );
}

function Bloco({ titulo, legenda, cor = "#01192e", children }: { titulo: string; legenda?: ReactNode; cor?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50/60 p-5" style={{ borderTop: `4px solid ${cor}` }}>
      <h2 className="flex items-center gap-1 text-lg font-bold text-o2-navy">
        {titulo}
        {legenda && <InfoLegenda titulo={titulo}>{legenda}</InfoLegenda>}
      </h2>
      {children}
    </section>
  );
}

function Cartao({ rotulo, valor, linhas = [], legenda }: { rotulo: string; valor: string; linhas?: string[]; legenda?: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {rotulo}
        {legenda && <InfoLegenda titulo={rotulo}>{legenda}</InfoLegenda>}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-o2-navy">{valor}</p>
      {linhas.map((l) => (
        <p key={l} className="text-xs text-gray-500">
          {l}
        </p>
      ))}
    </div>
  );
}

function Grafico({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <h4 className="mb-2 text-sm font-semibold text-o2-navy">{titulo}</h4>
      {children}
    </div>
  );
}

function Visao360({ visao, kpis, de, ate, linkCom }: { visao: Visao; kpis: Kpis; de: string; ate: string; linkCom: (t: Record<string, string>) => string }) {
  const alvo = visao.alvo!;
  const us = visao.unidades;
  const ehGrupo = alvo.tipo === "grupo";
  const f = visao.ferramentas;
  const s = visao.sinistros;
  const cot = kpis.funil_por_produto.filter((p) => p.entradas + p.conversoes + p.perdas > 0);
  const cotEntradas = cot.reduce((t, p) => t + p.entradas, 0);
  const cotConv = cot.reduce((t, p) => t + p.conversoes, 0);
  const produzDesde = us.map((u) => u.produz_desde).filter((x): x is string => !!x).sort()[0] ?? null;
  const ultimaApolice = us.map((u) => u.ultima_apolice).filter((x): x is string => !!x).sort().at(-1) ?? null;
  const ultimaCotacao = us.map((u) => u.ultima_cotacao).filter((x): x is string => !!x).sort().at(-1) ?? null;
  const meses: string[] = [];
  for (let m = de; m <= ate; m = somarMeses(m, 1)) meses.push(m);
  const cotMes = new Map(kpis.funil_mensal_produto.map((x) => [x.competencia, x.produtos]));
  const apoMes = new Map(kpis.mensal.map((x) => [x.competencia, x.produtos]));
  const usoMes = new Map(visao.mensal.map((x) => [x.competencia, x]));
  const seriesProd = ORDEM.map((p) => ({ chave: p, rotulo: PRODUTOS[p].rotulo, cor: PRODUTOS[p].cor }));
  const unica = us.length === 1 ? us[0] : null;
  const movimento = (u: Unidade) => u.cotacoes + u.apolices + u.sinistros + u.sinistros_abertos + u.auditorias + u.contratos + u.faturas + u.campanhas_recebidas > 0;
  const ativos = us.filter(movimento);
  const parados = us.filter((u) => !movimento(u));

  return (
    <div className="space-y-6">
      {/* Cadastro */}
      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-o2-navy">
              {alvo.nome}
              {ehGrupo && (
                <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 align-middle text-xs font-semibold text-blue-800">
                  {alvo.tipo_grupo === "rede_filiais" ? "rede com filiais" : "grupo (mesma empresa)"} · {us.length} fichas
                </span>
              )}
            </h2>
            {!ehGrupo && alvo.grupo && (
              <p className="text-sm text-gray-600">
                {unica?.papel_no_grupo === "matriz" ? "Matriz" : "Unidade"} do grupo{" "}
                <Link href={linkCom({ g: alvo.grupo.id })} className="font-medium text-o2-blue underline">
                  {alvo.grupo.nome}
                </Link>
              </p>
            )}
            {unica && (
              <p className="text-xs text-gray-500">
                {unica.nome_completo}
                {unica.cnpj && unica.cnpj !== "A definir" ? ` · CNPJ ${unica.cnpj}` : ""}
                {unica.cidade ? ` · ${unica.cidade}${unica.uf ? `/${unica.uf}` : ""}` : ""}
                {unica.codigo_produtor_corp ? ` · código Corp ${unica.codigo_produtor_corp}` : ""}
                {unica.origem_comercial ? ` · origem: ${unica.origem_comercial.toLowerCase()}` : ""}
              </p>
            )}
          </div>
          {unica && (
            <Link href={`/admin/imobiliarias/${unica.id}`} className="rounded-full border border-o2-navy px-3 py-1 text-xs font-medium text-o2-navy hover:bg-o2-navy hover:text-white">
              Abrir ficha de cadastro
            </Link>
          )}
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
          <Info rotulo="Produz conosco desde" valor={rotuloMes(produzDesde)} legenda="Mês da primeira proposta no Corp ligada a esta(s) ficha(s)." />
          <Info rotulo="Última apólice" valor={rotuloMes(ultimaApolice)} />
          <Info rotulo="Última cotação" valor={rotuloMes(ultimaCotacao)} legenda="Último mês com cotação recebida (planilhas ou Bitrix) de qualquer produto." />
          <Info rotulo="Logins no portal" valor={num(f.logins)} legenda="Pessoas da imobiliária com acesso ao Workspace (dono do cadastro + funcionários convidados)." />
          <Info rotulo="Sinistros desde" valor={s.desde ? data(s.desde) : "—"} />
        </div>
        {visao.fontes.length > 0 && (
          <p className="flex flex-wrap items-center gap-1 text-xs text-gray-500">
            <span className="mr-1 font-semibold uppercase tracking-wide">Como aparece nas fontes</span>
            {visao.fontes.map((x) => (
              <span key={x.fonte} className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">
                {ROTULO_FONTE[x.fonte] ?? x.fonte}: {x.nomes} {x.nomes === 1 ? "nome" : "nomes"}
              </span>
            ))}
            <InfoLegenda titulo="Nomes nas fontes">
              Quantas grafias diferentes desta imobiliária já estão ligadas (confirmadas) ao cadastro em cada fonte. É o que permite somar o histórico dela mesmo com o nome
              mudando ao longo dos anos.
            </InfoLegenda>
          </p>
        )}
      </section>

      {/* Resumo */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Cartao
          rotulo="Cotações recebidas"
          valor={num(cotEntradas)}
          linhas={[`${num(cotConv)} convertidas`]}
          legenda="Tomadas de preço de todos os produtos no período (planilhas e Bitrix), na mesma régua do painel de cada produto."
        />
        <Cartao rotulo="Apólices (Corp)" valor={num(kpis.resumo.propostas)} linhas={[`${compacto(kpis.resumo.premio)} de prêmio líquido`]} legenda="Documentos efetivados no Corp no período, pela data da proposta (espelho do SharePoint, mesma conta do Power BI)." />
        <Cartao rotulo="Comissão" valor={compacto(kpis.resumo.comissao)} linhas={[`ano anterior: ${compacto(kpis.resumo_ano_anterior.comissao)}`]} />
        <Cartao
          rotulo="Sinistros avisados"
          valor={num(s.avisados)}
          linhas={[`${compacto(s.vl_indenizado)} indenizado`, `${num(s.em_andamento)} em andamento hoje`]}
          legenda="Mesma base da aba Sinistros: histórico do Corp + cards da Gestão de sinistros, pela data do aviso. Ligados à imobiliária pela apólice."
        />
        <Cartao
          rotulo="Uso das ferramentas"
          valor={num(f.auditor.periodo + f.gerador.periodo)}
          linhas={[`${num(f.auditor.periodo)} auditorias · ${num(f.gerador.periodo)} contratos gerados`]}
          legenda="Auditor de contrato + Gerador de contrato usados pela imobiliária no período."
        />
      </div>

      {/* Cotações */}
      <Bloco titulo="Cotações" cor="#F8540D" legenda="Tomadas de preço: a cotação conta no mês em que entrou; a conversão e a perda, no mês em que aconteceram. Automóvel não tem imobiliária.">
        {cot.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhuma cotação ligada a esta imobiliária no período.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Produto</th>
                  <th className="px-3 py-2 text-right">Recebidas</th>
                  <th className="px-3 py-2 text-right">Convertidas</th>
                  <th className="px-3 py-2 text-right">Perdidas / recusadas</th>
                  <th className="px-3 py-2 text-right">Conversão</th>
                  <th className="px-3 py-2 text-right">Prêmio/valor convertido</th>
                </tr>
              </thead>
              <tbody>
                {ORDEM.map((k) => cot.find((p) => p.produto === k))
                  .filter((p): p is CotacaoProduto => !!p)
                  .map((p) => {
                    const [a, b] = REGUA[p.produto].calc(p);
                    return (
                      <tr key={p.produto} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-medium text-o2-navy">{PRODUTOS[p.produto].rotulo}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(p.entradas)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(p.conversoes)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(p.perdas + p.recusas)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {pct(a, b)} <span className="block text-[10px] text-gray-400">{REGUA[p.produto].texto}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{compacto(p.premio_convertido)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
        <Grafico titulo="Cotações recebidas por mês">
          <BarrasMensais
            pontos={meses.map((m) => ({ mes: m, valores: Object.fromEntries(ORDEM.map((p) => [p, cotMes.get(m)?.[p]?.entrada ?? 0])) }))}
            series={seriesProd}
          />
        </Grafico>
      </Bloco>

      {/* Apólices */}
      <Bloco titulo="Apólices (Corp)" cor="#2E6FB7" legenda="O que foi efetivado, na mesma conta do Power BI (espelho do SharePoint do Corp, 2020 em diante; PDFs de 2015 a 2019): documentos, prêmio líquido e comissão, ligados à imobiliária pelo código do produtor.">
        {kpis.por_produto.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhuma apólice ligada a esta imobiliária no período.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Produto</th>
                  <th className="px-3 py-2 text-right">Propostas</th>
                  <th className="px-3 py-2 text-right">Prêmio</th>
                  <th className="px-3 py-2 text-right">Comissão</th>
                  <th className="px-3 py-2 text-right">Prêmio no ano anterior</th>
                </tr>
              </thead>
              <tbody>
                {[...kpis.por_produto]
                  .sort((a, b) => b.premio - a.premio)
                  .map((p) => (
                    <tr key={p.produto} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-medium text-o2-navy">{PRODUTOS[p.produto]?.rotulo ?? p.produto}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(p.propostas)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{compacto(p.premio)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{compacto(p.comissao)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-500">{compacto(p.premio_ano_anterior)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <Grafico titulo="Propostas efetivadas por mês">
          <BarrasMensais
            pontos={meses.map((m) => ({ mes: m, valores: Object.fromEntries(ORDEM.map((p) => [p, apoMes.get(m)?.[p]?.propostas ?? 0])) }))}
            series={seriesProd}
          />
        </Grafico>
      </Bloco>

      {/* Sinistros */}
      <Bloco titulo="Sinistros" cor="#B42318" legenda="Mesma base da aba Sinistros (histórico do Corp + cards da Gestão), ligada à imobiliária pela apólice do sinistro ou pelo card.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Cartao rotulo="Avisados no período" valor={num(s.avisados)} linhas={[`${compacto(s.vl_avisado)} avisado`]} />
          <Cartao rotulo="Indenizados" valor={num(s.indenizados)} linhas={[`${compacto(s.vl_indenizado)} pago`]} />
          <Cartao rotulo="Encerrados sem indenização" valor={num(s.sem_indenizacao)} />
          <Cartao rotulo="Em andamento hoje" valor={num(s.em_andamento)} linhas={[`${num(s.total_historico)} no histórico todo`]} />
        </div>
        {Object.keys(s.por_produto).length > 0 && (
          <p className="text-xs text-gray-500">
            No período:{" "}
            {Object.entries(s.por_produto)
              .sort((a, b) => b[1] - a[1])
              .map(([p, n]) => `${PRODUTO_SINISTRO[p] ?? p} ${num(n)}`)
              .join(" · ")}
          </p>
        )}
        <Grafico titulo="Sinistros avisados por mês">
          <BarrasMensais pontos={meses.map((m) => ({ mes: m, valores: { s: usoMes.get(m)?.sinistros ?? 0 } }))} series={[{ chave: "s", rotulo: "Sinistros", cor: "#B42318" }]} />
        </Grafico>
        {s.abertos.length > 0 && (
          <details className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
            <summary className="cursor-pointer font-semibold text-o2-navy">Sinistros em andamento ({s.abertos.length})</summary>
            <table className="mt-2 w-full text-xs">
              <thead className="text-left uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="py-1">Aviso</th>
                  <th className="py-1">Produto</th>
                  <th className="py-1">Tipo</th>
                  <th className="py-1">Seguradora</th>
                  {ehGrupo && <th className="py-1">Unidade</th>}
                  <th className="py-1 text-right">Avisado</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {s.abertos.map((x, k) => (
                  <tr key={x.card ?? k} className="border-t border-gray-100">
                    <td className="py-1">{data(x.aviso)}</td>
                    <td className="py-1">{PRODUTO_SINISTRO[x.produto ?? ""] ?? x.produto ?? "—"}</td>
                    <td className="py-1">{x.tipo ?? "—"}</td>
                    <td className="py-1">{x.seguradora ?? "—"}</td>
                    {ehGrupo && <td className="py-1">{x.unidade ?? "—"}</td>}
                    <td className="py-1 text-right tabular-nums">{x.vl_avisado ? reais(x.vl_avisado) : "—"}</td>
                    <td className="py-1 text-right">
                      {x.card && (
                        <Link href={`/sinistros/${x.card}`} className="text-o2-blue underline">
                          abrir
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </Bloco>

      {/* Ferramentas */}
      <Bloco titulo="Ferramentas do Workspace" cor="#6B7280" legenda="Uso das ferramentas pela imobiliária (ou pela O2 para ela), contado pela data de uso.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Cartao
            rotulo="Auditor de contrato"
            valor={num(f.auditor.periodo)}
            linhas={[
              `${num(f.auditor.total)} no total · última ${data(f.auditor.ultima)}`,
              ...(Object.keys(f.auditor.por_status).length
                ? [
                    Object.entries(f.auditor.por_status)
                      .map(([st, n]) => `${st.toLowerCase()} ${n}`)
                      .join(" · "),
                  ]
                : []),
            ]}
          />
          <Cartao rotulo="Gerador de contrato" valor={num(f.gerador.periodo)} linhas={[`${num(f.gerador.total)} no total · último ${data(f.gerador.ultima)}`]} />
          <Cartao
            rotulo="Faturas"
            valor={num(f.faturas.periodo)}
            linhas={[`${num(f.faturas.total)} no total · última ${data(f.faturas.ultima)}`]}
            legenda="Faturas das seguradoras identificadas para esta imobiliária no módulo Faturas."
          />
          <Cartao
            rotulo="Campanhas (e-mails)"
            valor={num(f.campanhas.recebidas)}
            linhas={[`${num(f.campanhas.abertas)} abertos (${pct(f.campanhas.abertas, f.campanhas.recebidas)}) · ${num(f.campanhas.clicadas)} cliques`, `último envio ${data(f.campanhas.ultima)}`]}
            legenda="E-mails de campanhas comerciais enviados à imobiliária no período, e quantos ela abriu/clicou."
          />
        </div>
        <Grafico titulo="Uso por mês">
          <BarrasMensais
            pontos={meses.map((m) => {
              const u = usoMes.get(m);
              return { mes: m, valores: { aud: u?.auditorias ?? 0, ger: u?.contratos ?? 0, fat: u?.faturas ?? 0, camp: u?.campanhas_abertas ?? 0 } };
            })}
            series={[
              { chave: "aud", rotulo: "Auditorias", cor: "#2E6FB7" },
              { chave: "ger", rotulo: "Contratos gerados", cor: "#F8540D" },
              { chave: "fat", rotulo: "Faturas", cor: "#01192e" },
              { chave: "camp", rotulo: "Campanhas abertas", cor: "#9CA3AF" },
            ]}
          />
        </Grafico>
        <p className="text-xs text-gray-500">
          O Cálculo de multa rescisória ainda não registra qual imobiliária usou, por isso não aparece aqui. Repasses de comissão entram quando o módulo tiver lançamentos.
        </p>
      </Bloco>

      {/* Por unidade */}
      {us.length > 1 && (
        <Bloco
          titulo="Por unidade"
          legenda="Cada ficha do grupo. Cotações de planilhas que não dizem a unidade ficam na ficha principal do grupo (matriz), por isso algumas unidades aparecem sem cotação."
        >
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-left uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Ficha</th>
                  <th className="px-3 py-2 text-right">Cotações</th>
                  <th className="px-3 py-2 text-right">Convertidas</th>
                  <th className="px-3 py-2 text-right">Apólices</th>
                  <th className="px-3 py-2 text-right">Prêmio</th>
                  <th className="px-3 py-2 text-right">Sinistros</th>
                  <th className="px-3 py-2 text-right">Em andamento</th>
                  <th className="px-3 py-2 text-right">Auditorias</th>
                  <th className="px-3 py-2 text-right">Contratos</th>
                  <th className="px-3 py-2 text-right">Logins</th>
                  <th className="px-3 py-2">Última apólice</th>
                </tr>
              </thead>
              <tbody>
                {ativos.map((u) => (
                  <tr key={u.id} className="border-t border-gray-100">
                    <td className="px-3 py-2">
                      <Link href={linkCom({ i: u.id })} className="font-medium text-o2-blue underline">
                        {u.nome}
                      </Link>
                      {u.papel_no_grupo && <span className="ml-1 text-[10px] text-gray-400">{u.papel_no_grupo}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(u.cotacoes)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(u.convertidas)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(u.apolices)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{compacto(u.premio)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(u.sinistros)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(u.sinistros_abertos)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(u.auditorias)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(u.contratos)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(u.logins)}</td>
                    <td className="px-3 py-2">{rotuloMes(u.ultima_apolice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parados.length > 0 && (
            <details className="rounded-xl border border-gray-200 bg-white p-3 text-xs">
              <summary className="cursor-pointer font-semibold text-o2-navy">{parados.length} fichas sem movimento no período</summary>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {parados.map((u) => (
                  <li key={u.id}>
                    <Link href={linkCom({ i: u.id })} className="text-o2-blue underline">
                      {u.nome}
                    </Link>
                    <span className="text-gray-400"> · última apólice {rotuloMes(u.ultima_apolice)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Bloco>
      )}
      <p className="text-xs text-gray-400">
        Só conta o que tem vínculo confirmado no cadastro de imobiliárias. Nomes ainda em revisão ficam de fora até serem confirmados em Imobiliárias cadastradas.
      </p>
    </div>
  );
}

function Info({ rotulo, valor, legenda }: { rotulo: string; valor: string; legenda?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {rotulo}
        {legenda && <InfoLegenda titulo={rotulo}>{legenda}</InfoLegenda>}
      </p>
      <p className="font-semibold text-o2-navy">{valor}</p>
    </div>
  );
}
