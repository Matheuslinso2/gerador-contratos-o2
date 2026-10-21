import type { ReactNode } from "react";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconChart } from "@/components/icons";
import { signOut } from "../../actions";
import { Abas, ah, Cartao, compacto, div, FonteDados, mesValido, num, pct, Quadro, rotuloMesLongo, somarMeses, Variacao } from "../_corp/comum";
import { abrirPainel, prontoOuCalcula } from "../_corp/dados";
import FiltrosCorp from "../_corp/FiltrosCorp";

export const dynamic = "force-dynamic";

// Power BI - O2 Seguros › Flash Report ("FLASH REPORT: Análise Consolidada"
// do Power BI). Produção = comissão da corretora; metas da lista "Base de
// Metas" do SharePoint, supermeta = meta × 1,1 (regra do PBI); premiação não
// tem meta (pendência em branco). Endossos = documentos de endosso (Clientes
// com Documentos); Retransmissão/Segimob/Superlógica = produção desses
// produtores antes da deduplicação; Renascença = centralizador RENASCENÇA.
// Docs cancelados = tipo de operação CANCELADO; sinistralidade = nº de
// sinistros com ocorrência no mês; análises/recusas da lista do SharePoint.

type Linha = { ramo_flash: string; mes_com: number | null; aa_com: number | null; ytd_com: number | null; ytd_aa_com: number | null; docs: number | null; pl: number | null; meta_mes: number; meta_ytd: number };
type LinhaBloco = { chave: string; mes_com: number | null; aa_com: number | null; docs: number | null; pl: number | null };
type Flash = {
  cartoes: Record<string, number | null>;
  por_ramo: Linha[];
  blocos: Record<string, LinhaBloco[]>;
};

const SM = 1.1;
const n0 = (v: number | null | undefined) => v ?? 0;
const nzero = (v: number | null | undefined) => (v ? num(v) : "");

function Celula({ children, forte }: { children: ReactNode; forte?: boolean }) {
  return <td className={`px-1.5 py-1 ${forte ? "font-semibold text-o2-navy" : ""}`}>{children}</td>;
}

function TabelaBloco({ titulo, linhas, comPl }: { titulo: string; linhas: LinhaBloco[]; comPl: boolean }) {
  const vis = linhas.filter((l) => l.mes_com || l.aa_com || l.docs);
  const t = vis.reduce((a, l) => ({ mes: a.mes + n0(l.mes_com), aa: a.aa + n0(l.aa_com), docs: a.docs + n0(l.docs), pl: a.pl + n0(l.pl) }), { mes: 0, aa: 0, docs: 0, pl: 0 });
  return (
    <Quadro titulo={titulo}>
      {vis.length ? (
        <table className="w-full text-right text-[11px] tabular-nums">
          <thead className="border-b border-o2-coral/40 text-[10px] uppercase text-gray-500">
            <tr>
              <th className="px-1.5 text-left">Ramo</th>
              <th className="px-1.5">Mês</th>
              <th className="px-1.5">AA</th>
              <th className="px-1.5">% AH</th>
              <th className="px-1.5">Doc</th>
              {comPl && <th className="px-1.5">PL</th>}
            </tr>
          </thead>
          <tbody>
            {vis.map((l) => (
              <tr key={l.chave} className="border-b border-gray-100">
                <td className="px-1.5 py-1 text-left">{l.chave}</td>
                <Celula>{num(l.mes_com)}</Celula>
                <Celula>{num(l.aa_com)}</Celula>
                <Celula>{pct(ah(l.mes_com, l.aa_com))}</Celula>
                <Celula>{nzero(l.docs)}</Celula>
                {comPl && <Celula>{num(l.pl)}</Celula>}
              </tr>
            ))}
            <tr className="font-semibold text-o2-navy">
              <td className="px-1.5 py-1 text-left">TOTAL</td>
              <Celula>{num(t.mes)}</Celula>
              <Celula>{num(t.aa)}</Celula>
              <Celula>{pct(ah(t.mes, t.aa))}</Celula>
              <Celula>{nzero(t.docs)}</Celula>
              {comPl && <Celula>{num(t.pl)}</Celula>}
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-gray-400">Sem produção no mês nem no mesmo mês do ano anterior.</p>
      )}
    </Quadro>
  );
}

export default async function FlashPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, user, opcoes } = await abrirPainel();
  const mesAtual = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
  const meses = (opcoes.meses ?? []).filter((m) => m <= mesAtual);
  const mes = mesValido(sp.mes) && meses.includes(sp.mes!) ? sp.mes! : (meses.at(-1) ?? mesAtual);
  const ramos = (sp.rflash ?? "").split("|").filter(Boolean);

  const { data: f, error } = await prontoOuCalcula<Flash>(supabase, ramos.length ? null : `flash:${mes}`, () =>
    supabase.rpc("corp_painel_flash", { p_mes: `${mes}-01`, p_ramo_flash: ramos.length ? ramos : null })
  );
  const c = f?.cartoes ?? {};
  const linhas = f?.por_ramo ?? [];
  const metaMes = linhas.reduce((t, l) => t + n0(l.meta_mes), 0);
  const metaYtd = linhas.reduce((t, l) => t + n0(l.meta_ytd), 0);
  const tot = linhas.reduce(
    (a, l) => ({ mes: a.mes + n0(l.mes_com), aa: a.aa + n0(l.aa_com), ytd: a.ytd + n0(l.ytd_com), docs: a.docs + n0(l.docs), pl: a.pl + n0(l.pl) }),
    { mes: 0, aa: 0, ytd: 0, docs: 0, pl: 0 }
  );
  const semMeta = (r: string) => r === "PREMIAÇÃO";
  const fila = (rotulo: string, l: { mes: number; aa: number; ytd: number; docs: number; pl: number; meta_mes: number; meta_ytd: number }, total = false) => {
    const pend = (a: number, b: number) => (!total && semMeta(rotulo) ? "" : num(a - b));
    return (
      <tr key={rotulo} className={total ? "font-semibold text-o2-navy" : "border-b border-gray-100"}>
        <td className="px-1.5 py-1 text-left">{rotulo}</td>
        <Celula forte>{num(l.mes)}</Celula>
        <Celula>{num(l.aa)}</Celula>
        <Celula>{pct(ah(l.mes, l.aa))}</Celula>
        <Celula>{num(l.meta_mes)}</Celula>
        <Celula>{pend(l.mes, l.meta_mes)}</Celula>
        <Celula>{pct(div(l.mes, l.meta_mes))}</Celula>
        <Celula>{num(l.meta_mes * SM)}</Celula>
        <Celula>{pend(l.mes, l.meta_mes * SM)}</Celula>
        <Celula>{pct(div(l.mes, l.meta_mes * SM))}</Celula>
        <Celula forte>{num(l.ytd)}</Celula>
        <Celula>{num(l.meta_ytd)}</Celula>
        <Celula>{pend(l.ytd, l.meta_ytd)}</Celula>
        <Celula>{pct(div(l.ytd, l.meta_ytd))}</Celula>
        <Celula>{num(l.meta_ytd * SM)}</Celula>
        <Celula>{pend(l.ytd, l.meta_ytd * SM)}</Celula>
        <Celula>{pct(div(l.ytd, l.meta_ytd * SM))}</Celula>
        <Celula>{nzero(l.docs)}</Celula>
        <Celula>{num(l.pl)}</Celula>
      </tr>
    );
  };

  return (
    <>
      <AppHeader userEmail={user.email} logoutAction={signOut} />
      <main className="mx-auto max-w-7xl flex-1 space-y-5 p-8">
        <PageHeader icon={<IconChart />} titulo="Power BI - O2 Seguros" subtitulo={`Flash Report · análise consolidada de ${rotuloMesLongo(mes)}`} />
        <Abas ativa="/producao/flash" />
        <FiltrosCorp
          meses={meses}
          mes={mes}
          campos={[{ chave: "rflash", rotulo: "Ramo", opcoes: (opcoes.ramos_flash ?? []).map((r) => ({ valor: r, rotulo: r })) }]}
        />
        <FonteDados importadoEm={opcoes.importado_em} arquivoEm={opcoes.arquivo_modificado_em} />
        {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">Não foi possível calcular ({error.message}).</p>}
        {mes === mesAtual && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            {rotuloMesLongo(mes)} ainda está em aberto: os números crescem até o fim do mês.
          </p>
        )}

        {f && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
              <Cartao rotulo="Produção mês" valor={compacto(c.com_mes)} legenda="Comissão da corretora do mês. Meta = soma das metas dos ramos (lista Base de Metas); SM = supermeta (meta × 1,1).">
                <p>AH mês: {compacto(c.com_mes_ant)} <Variacao v={ah(c.com_mes, c.com_mes_ant)} /></p>
                <p>AH ano: {compacto(c.com_ano_ant)} <Variacao v={ah(c.com_mes, c.com_ano_ant)} /></p>
                <p>Meta: {compacto(metaMes)} {pct(div(c.com_mes, metaMes))}</p>
                <p>SM: {compacto(metaMes * SM)} {pct(div(c.com_mes, metaMes * SM))}</p>
              </Cartao>
              <Cartao rotulo="Produção YTD" valor={compacto(c.com_ytd)}>
                <p>AH mês: {compacto(c.com_ytd_mes_ant)} <Variacao v={ah(c.com_ytd, c.com_ytd_mes_ant)} /></p>
                <p>AH ano: {compacto(c.com_ytd_ano_ant)} <Variacao v={ah(c.com_ytd, c.com_ytd_ano_ant)} /></p>
                <p>Meta: {compacto(metaYtd)} {pct(div(c.com_ytd, metaYtd))}</p>
                <p>SM: {compacto(metaYtd * SM)} {pct(div(c.com_ytd, metaYtd * SM))}</p>
              </Cartao>
              <Cartao rotulo="PL capitalização" valor={compacto(c.pl_cap_mes)} legenda="Prêmio líquido do agrupamento Capitalização no mês.">
                <p>AH mês: {compacto(c.pl_cap_mes_ant)}</p>
                <p>AH ano: {compacto(c.pl_cap_ano_ant)}</p>
              </Cartao>
              <Cartao rotulo="Docs cadastrados" valor={num(c.docs_mes)}>
                <p>AH mês: {num(c.docs_mes_ant)} <Variacao v={ah(c.docs_mes, c.docs_mes_ant)} /></p>
                <p>AH ano: {num(c.docs_ano_ant)} <Variacao v={ah(c.docs_mes, c.docs_ano_ant)} /></p>
              </Cartao>
              <Cartao rotulo="Docs cancelados" valor={num(c.canc_mes)} legenda="Documentos com tipo de operação CANCELADO no mês.">
                <p>AH mês: {num(c.canc_mes_ant)} <Variacao v={ah(c.canc_mes, c.canc_mes_ant)} /></p>
                <p>AH ano: {num(c.canc_ano_ant)} <Variacao v={ah(c.canc_mes, c.canc_ano_ant)} /></p>
              </Cartao>
              <Cartao rotulo="Sinistralidade" valor={num(c.sin_mes)} legenda="Número de sinistros com data de ocorrência no mês (todos os ramos).">
                <p>AH mês: {num(c.sin_mes_ant)} <Variacao v={ah(c.sin_mes, c.sin_mes_ant)} /></p>
                <p>AH ano: {num(c.sin_ano_ant)} <Variacao v={ah(c.sin_mes, c.sin_ano_ant)} /></p>
              </Cartao>
              <Cartao rotulo="Total análise" valor={num(c.analise_mes)} legenda="Análises e recusas de Seguro Fiança informadas na lista &quot;Análise e Recusado&quot; do SharePoint (lançamento do mês).">
                <p>Recusado: {num(c.recusado_mes)} {pct(div(c.recusado_mes, c.analise_mes))}</p>
                <p>AH mês: {c.analise_mes_ant ? num(c.analise_mes_ant) : "—"} <Variacao v={ah(c.analise_mes, c.analise_mes_ant)} /></p>
                <p>AH ano: {c.analise_ano_ant ? num(c.analise_ano_ant) : "—"}</p>
              </Cartao>
            </div>

            <Quadro titulo="Produção total" legenda="Mês e YTD = comissão da corretora. AA = mesmo mês do ano anterior. MM = meta do mês; SM-M = supermeta do mês; MY = meta YTD; SM-Y = supermeta YTD. Δ = realizado − meta.">
              <div className="overflow-x-auto">
                <table className="w-full text-right text-[11px] tabular-nums">
                  <thead className="border-b border-o2-coral/40 text-[10px] uppercase text-gray-500">
                    <tr>
                      {["Ramo", "Mês", "AA", "% AH", "Meta mês", "Δ MM", "% meta", "SM-M", "Δ SM-M", "% SM-M", "YTD", "Meta YTD", "Δ MY", "% YTD", "SM-Y", "Δ SM-Y", "% SM-Y", "Docs", "PL"].map((h, i) => (
                        <th key={h} className={`px-1.5 py-1 ${i === 0 ? "text-left" : ""}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) =>
                      fila(l.ramo_flash, { mes: n0(l.mes_com), aa: n0(l.aa_com), ytd: n0(l.ytd_com), docs: n0(l.docs), pl: n0(l.pl), meta_mes: n0(l.meta_mes), meta_ytd: n0(l.meta_ytd) })
                    )}
                    {fila("TOTAL", { ...tot, meta_mes: metaMes, meta_ytd: metaYtd }, true)}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-gray-500">
                AA: Ano anterior · AH: Análise horizontal · Δ: diferença (realizado − meta) · MM: Meta mês · SM-M: Super meta mês · YTD: acumulado no ano · MY: Meta YTD · SM-Y: Super meta YTD
              </p>
            </Quadro>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <TabelaBloco titulo="Endossos" linhas={f.blocos.endossos ?? []} comPl={false} />
              <TabelaBloco titulo="Retransmissão" linhas={f.blocos.retransmissao ?? []} comPl={false} />
              <TabelaBloco titulo="Renascença" linhas={f.blocos.renascenca ?? []} comPl />
              <TabelaBloco titulo="Segimob" linhas={f.blocos.segimob ?? []} comPl />
              <TabelaBloco titulo="Superlógica" linhas={f.blocos.superlogica ?? []} comPl />
            </div>
            <p className="text-xs text-gray-500">
              Mês anterior para comparação: {rotuloMesLongo(somarMeses(mes, -1))}; ano anterior: {rotuloMesLongo(somarMeses(mes, -12))}.
            </p>
          </>
        )}
      </main>
    </>
  );
}
