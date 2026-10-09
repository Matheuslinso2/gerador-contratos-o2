import Link from "next/link";
import { competenciasAtualEAnterior, montarRankingImobiliarias } from "@/lib/dashboardProducao";
import type { NumerosProduto } from "@/lib/rankingImobiliarias";

// Quadro "Ranking de imobiliárias" da aba de KPIs (pedido do Matheus,
// 09/10/2026). Top 10 por comissão efetivada somando Fiança + Capitalização +
// Ramos (novos). Origem e regras: lib/dashboardProducao.ts e
// lib/rankingImobiliarias.ts -- só números dos retratos dos painéis.

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function nomeMes(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  return `${MESES[mes - 1][0].toUpperCase()}${MESES[mes - 1].slice(1)}/${ano}`;
}

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

// Uma linha por produto com número (Fiança / Cap. / Ramos), embaixo do total.
function Detalhe({ f, c, r, campo, formatar }: { f: NumerosProduto; c: NumerosProduto; r: NumerosProduto; campo: keyof NumerosProduto; formatar: (n: number) => string }) {
  const itens = [
    { rotulo: "Fiança", n: f[campo] },
    { rotulo: "Cap.", n: c[campo] },
    { rotulo: "Ramos", n: r[campo] },
  ].filter((i) => i.n > 0);
  return (
    <div className="text-[11px] text-o2-cinza-medio">
      {itens.map((i) => (
        <div key={i.rotulo} className="whitespace-nowrap">
          {i.rotulo} {formatar(i.n)}
        </div>
      ))}
    </div>
  );
}

export default async function RankingImobiliarias({ mes }: { mes: "atual" | "anterior" }) {
  const { atual, anterior } = competenciasAtualEAnterior();
  const competencia = mes === "anterior" ? anterior : atual;
  const ranking = await montarRankingImobiliarias(competencia);

  const aba = (qual: "atual" | "anterior", texto: string) => (
    <Link
      href={qual === "atual" ? "/?aba=kpis" : "/?aba=kpis&rank=anterior"}
      scroll={false}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        mes === qual ? "bg-o2-navy text-white" : "bg-gray-100 text-o2-cinza-escuro hover:bg-gray-200"
      }`}
    >
      {texto}
    </Link>
  );

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-o2-navy">Ranking de imobiliárias</h2>
          <p className="text-xs text-o2-cinza-medio">
            As 10 que mais geraram comissão efetivada em {nomeMes(competencia)} — Fiança + Capitalização + Ramos Elementares
          </p>
        </div>
        <div className="flex gap-1.5">
          {aba("atual", `${nomeMes(atual).split("/")[0]} (em andamento)`)}
          {aba("anterior", `${nomeMes(anterior).split("/")[0]} (fechado)`)}
        </div>
      </div>

      {ranking.linhas.length === 0 ? (
        <p className="text-sm text-o2-cinza-medio">Nenhuma imobiliária com produção registrada nos painéis em {nomeMes(competencia)}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-[12.5px]">
            <thead>
              <tr className="text-[11.5px] text-o2-cinza-medio">
                <th className="px-2 py-1.5 text-left font-normal">Imobiliária</th>
                <th className="px-2 py-1.5 text-right font-normal">Cotações</th>
                <th className="px-2 py-1.5 text-right font-normal">Efetivadas</th>
                <th className="px-2 py-1.5 text-right font-normal">Comissão efetivada</th>
              </tr>
            </thead>
            <tbody>
              {ranking.linhas.map((l, i) => (
                <tr key={`${i}-${l.nome}`} className="border-t border-gray-100 align-top">
                  <td className="px-2 py-2 text-left font-medium text-o2-navy">
                    <span className="mr-2 inline-block w-5 text-right tabular-nums text-o2-cinza-medio">{i + 1}.</span>
                    {l.nome}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    <div className="text-o2-navy">{inteiro.format(l.cotacoes)}</div>
                    <Detalhe f={l.fianca} c={l.capitalizacao} r={l.ramos} campo="cotacoes" formatar={(n) => inteiro.format(n)} />
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    <div className="text-o2-navy">{inteiro.format(l.efetivadas)}</div>
                    <Detalhe f={l.fianca} c={l.capitalizacao} r={l.ramos} campo="efetivadas" formatar={(n) => inteiro.format(n)} />
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    <div className="font-medium text-o2-navy">{reais.format(l.comissao)}</div>
                    <Detalhe f={l.fianca} c={l.capitalizacao} r={l.ramos} campo="comissao" formatar={(n) => reais.format(n)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-o2-cinza-medio">
        Ordem: maior comissão efetivada; empate, mais efetivadas, depois mais cotações. Números dos retratos dos painéis, na mesma base de cada um (Fiança:
        efetivadas e comissão contam pelo mês em que aconteceram; Capitalização: títulos listados no painel do mês; Ramos: só os novos). O mesmo nome escrito de
        jeitos diferentes nos painéis é somado numa linha só; na dúvida (ex.: &ldquo;Adjuve&rdquo; sem a cidade), fica separado. <b>Seguro Auto não entra</b>: o painel
        dele não registra a imobiliária. Linhas sem imobiliária informada ficam de fora.
        {ranking.painelsSemRetrato.length > 0 && <> <b>Atenção:</b> sem retrato de {nomeMes(competencia)} em {ranking.painelsSemRetrato.join(", ")} — ranking incompleto.</>}
      </p>
    </section>
  );
}
