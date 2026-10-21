import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconChart } from "@/components/icons";
import { signOut } from "../../actions";
import { Abas, ah, Alternador, BarrasH, Cartao, compacto, div, FonteDados, mesValido, num, pct, Quadro, reais, rotuloMesLongo, somarMeses, Variacao } from "../_corp/comum";
import { abrirPainel, camposProducao, filtrosProducao, ROTULO_CANCELADO, ROTULO_TIPO, temFiltro } from "../_corp/dados";
import FiltrosCorp from "../_corp/FiltrosCorp";

export const dynamic = "force-dynamic";

// Power BI - O2 Seguros › Produção Geral. Mesma página do Power BI "PRODUÇÃO:
// Análise de Performance do Mês" (família de 6 páginas: Documentos /
// Comissão da corretora / Ticket médio × Mês / Acumulado no ano), com os
// mesmos cartões (AH = análise horizontal contra o mês anterior e o mesmo mês
// do ano anterior) e as mesmas trocas de dimensão dos quadros. Números de
// corp_painel_geral() sobre os retratos mensais (mês fechado congelado).

type Per = { docs: number; com: number; pl: number };
type Item = { k: string; docs: number; com: number };
type Geral = {
  cartoes: Record<"mes" | "mes_ant" | "ano_ant" | "ytd" | "ytd_mes_ant" | "ytd_ano_ant", Per>;
  quebras: Record<"mes" | "ytd", Record<string, Item[]>> | null;
};

const METRICAS = [
  { valor: "docs", rotulo: "Documentos" },
  { valor: "com", rotulo: "Comissão corretora" },
  { valor: "tm", rotulo: "Ticket médio" },
];
const JANELAS = [
  { valor: "mes", rotulo: "Mês" },
  { valor: "ytd", rotulo: "Acumulado no ano" },
];

export default async function ProducaoGeralPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, user, opcoes } = await abrirPainel();
  const meses = opcoes.meses ?? [];
  const mesAtual = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
  const padrao = meses.includes(somarMeses(mesAtual, -1)) ? somarMeses(mesAtual, -1) : (meses.at(-1) ?? mesAtual);
  const mes = mesValido(sp.mes) && meses.includes(sp.mes!) ? sp.mes! : padrao;
  const metrica = METRICAS.some((m) => m.valor === sp.met) ? sp.met! : "docs";
  const janela = sp.jan === "ytd" ? "ytd" : "mes";
  const filtros = filtrosProducao(sp);

  const { data, error } = await supabase.rpc("corp_painel_geral", { p_mes: `${mes}-01`, ...filtros });
  const g = data as Geral | null;
  const c = g?.cartoes;

  // valor da métrica escolhida para um item (documentos, comissão ou ticket médio)
  const valor = (i: Item) => (metrica === "docs" ? i.docs : metrica === "com" ? i.com : (div(i.com, i.docs) ?? 0));
  const itens = (dim: string) =>
    (g?.quebras?.[janela]?.[dim] ?? [])
      .map((i) => ({ k: i.k || "(vazio)", v: valor(i) }))
      .filter((i) => i.v !== 0)
      .sort((a, b) => b.v - a.v);
  const formato = metrica === "docs" ? "numero" : "reais";
  const tituloMetrica = `${METRICAS.find((m) => m.valor === metrica)!.rotulo} · ${janela === "mes" ? "mês" : "acumulado no ano"}`;
  const base = "/producao/geral";

  const tm = (p?: Per) => div(p?.com, p?.docs);

  return (
    <>
      <AppHeader userEmail={user.email} logoutAction={signOut} />
      <main className="mx-auto max-w-7xl flex-1 space-y-5 p-8">
        <PageHeader icon={<IconChart />} titulo="Power BI - O2 Seguros" subtitulo={`Produção Geral · análise de performance de ${rotuloMesLongo(mes)}`} />
        <Abas ativa="/producao/geral" />
        <FiltrosCorp meses={meses} mes={mes} campos={camposProducao(opcoes)} />
        <FonteDados importadoEm={opcoes.importado_em} arquivoEm={opcoes.arquivo_modificado_em} />

        {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Não foi possível calcular ({error.message}).</p>}
        {temFiltro(filtros) && (
          <p className="rounded-lg border border-o2-coral/30 bg-o2-coral/5 p-3 text-sm text-o2-navy">Todos os quadros abaixo estão recortados pelos filtros escolhidos.</p>
        )}

        {c && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Cartao rotulo="Documentos mês" valor={num(c.mes.docs)} legenda="Apólices, faturas e endossos com início de vigência no mês (cada Nosso Nº conta uma vez, na regra de prioridade do cadastro de produtores).">
              <p>AH mês: {num(c.mes_ant.docs)} <Variacao v={ah(c.mes.docs, c.mes_ant.docs)} /></p>
              <p>AH ano: {num(c.ano_ant.docs)} <Variacao v={ah(c.mes.docs, c.ano_ant.docs)} /></p>
            </Cartao>
            <Cartao rotulo="Documentos YTD" valor={num(c.ytd.docs)} legenda="Acumulado de janeiro até o mês de referência.">
              <p>AH mês: {num(c.ytd_mes_ant.docs)} <Variacao v={ah(c.ytd.docs, c.ytd_mes_ant.docs)} /></p>
              <p>AH ano: {num(c.ytd_ano_ant.docs)} <Variacao v={ah(c.ytd.docs, c.ytd_ano_ant.docs)} /></p>
            </Cartao>
            <Cartao rotulo="Com. corret. mês" valor={compacto(c.mes.com)} legenda="Comissão da corretora (Vl. Com. do Corp) dos documentos do mês.">
              <p>AH mês: {compacto(c.mes_ant.com)} <Variacao v={ah(c.mes.com, c.mes_ant.com)} /></p>
              <p>AH ano: {compacto(c.ano_ant.com)} <Variacao v={ah(c.mes.com, c.ano_ant.com)} /></p>
            </Cartao>
            <Cartao rotulo="Com. corret. YTD" valor={compacto(c.ytd.com)}>
              <p>AH mês: {compacto(c.ytd_mes_ant.com)} <Variacao v={ah(c.ytd.com, c.ytd_mes_ant.com)} /></p>
              <p>AH ano: {compacto(c.ytd_ano_ant.com)} <Variacao v={ah(c.ytd.com, c.ytd_ano_ant.com)} /></p>
            </Cartao>
            <Cartao rotulo="Ticket médio mês" valor={reais(tm(c.mes))} legenda="Comissão da corretora ÷ documentos.">
              <p>AH mês: {reais(tm(c.mes_ant))} <Variacao v={ah(tm(c.mes), tm(c.mes_ant))} /></p>
              <p>AH ano: {reais(tm(c.ano_ant))} <Variacao v={ah(tm(c.mes), tm(c.ano_ant))} /></p>
            </Cartao>
            <Cartao rotulo="Ticket médio YTD" valor={reais(tm(c.ytd))}>
              <p>AH mês: {reais(tm(c.ytd_mes_ant))} <Variacao v={ah(tm(c.ytd), tm(c.ytd_mes_ant))} /></p>
              <p>AH ano: {reais(tm(c.ytd_ano_ant))} <Variacao v={ah(tm(c.ytd), tm(c.ytd_ano_ant))} /></p>
              <p>Mês vs YTD: <Variacao v={ah(tm(c.mes), tm(c.ytd))} /></p>
            </Cartao>
          </div>
        )}

        {g?.quebras && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-o2-navy">Quadros por:</span>
              <Alternador base={base} sp={sp} chave="met" opcoes={METRICAS} atual={metrica} />
              <Alternador base={base} sp={sp} chave="jan" opcoes={JANELAS} atual={janela} />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Quadro
                titulo={sp.q1 === "parc" ? "Faixa de parcelas" : "Vigente × cancelado"}
                acoes={<Alternador base={base} sp={sp} chave="q1" opcoes={[{ valor: "vig", rotulo: "Vigência" }, { valor: "parc", rotulo: "Parcelas" }]} atual={sp.q1 === "parc" ? "parc" : "vig"} />}
              >
                <BarrasH
                  formato={formato}
                  itens={sp.q1 === "parc" ? itens("parcelas").sort((a, b) => a.k.localeCompare(b.k)) : itens("cancelado").map((i) => ({ ...i, k: ROTULO_CANCELADO[i.k] ?? i.k }))}
                />
              </Quadro>
              <Quadro
                titulo={sp.q2 === "origem" ? "Origem do produtor" : "Tipo de operação"}
                acoes={<Alternador base={base} sp={sp} chave="q2" opcoes={[{ valor: "tipo", rotulo: "Tipo" }, { valor: "origem", rotulo: "Origem" }]} atual={sp.q2 === "origem" ? "origem" : "tipo"} />}
              >
                <BarrasH formato={formato} itens={sp.q2 === "origem" ? itens("origem") : itens("tipo").map((i) => ({ ...i, k: ROTULO_TIPO[i.k] ?? i.k }))} />
              </Quadro>
              <Quadro
                titulo={sp.q3 === "ramo" ? "Ramo" : "Grupo de ramo"}
                acoes={<Alternador base={base} sp={sp} chave="q3" opcoes={[{ valor: "grupo", rotulo: "Grupo" }, { valor: "ramo", rotulo: "Ramo" }]} atual={sp.q3 === "ramo" ? "ramo" : "grupo"} />}
              >
                <BarrasH formato={formato} itens={itens(sp.q3 === "ramo" ? "ramo" : "grupo")} />
              </Quadro>
              <Quadro titulo="Seguradora">
                <BarrasH formato={formato} itens={itens("seguradora")} />
              </Quadro>
              <div className="lg:col-span-2">
                <Quadro
                  titulo={sp.q4 === "produtor" ? "Produtor" : "Centralizador"}
                  legenda="Centralizador = parceiro que agrupa filiais e corretores (cadastro de produtores do SharePoint); sem centralizador, vale o próprio produtor."
                  acoes={<Alternador base={base} sp={sp} chave="q4" opcoes={[{ valor: "central", rotulo: "Centralizador" }, { valor: "produtor", rotulo: "Produtor" }]} atual={sp.q4 === "produtor" ? "produtor" : "central"} />}
                >
                  <BarrasH formato={formato} maxItens={20} itens={itens(sp.q4 === "produtor" ? "produtor" : "centralizador")} />
                </Quadro>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Quadros em: <b>{tituloMetrica}</b>. Percentual ao lado de cada barra = participação no total do quadro{metrica === "tm" ? " (no ticket médio, a participação é só indicativa)" : ""}.
              {c && ` Total do mês: ${num(c.mes.docs)} documentos, ${reais(c.mes.com)} de comissão, ${pct(div(c.mes.com, c.mes.pl))} de comissão sobre o prêmio líquido.`}
            </p>
          </>
        )}
      </main>
    </>
  );
}
