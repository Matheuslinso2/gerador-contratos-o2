import { createClient } from "@/lib/supabase/server";
import InfoLegenda from "@/components/InfoLegenda";
import { Cartao } from "./kpiUi";

// Aba "Dados estatísticos O2" do Início (Matheus, 03/11/2026): visão de mercado dos
// seguros da nossa carteira, a partir do que foi levantado na análise de preços e
// fechamento (Fiança) e de margem por apólice. Tudo vem de tabelas prontas analise_*
// (supabase/schema_*.sql), remontadas 1x por dia — a tela só lê. É a carteira da O2,
// não o mercado inteiro. A parte de margem (comissão − repasse) só aparece para admin.

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dec2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const pct = (a: number, b: number) => (b > 0 ? (100 * a) / b : null);
const fp = (v: number | null) => (v == null ? "—" : `${dec1.format(v)}%`);
const titulo = (s: string | null) => (s ? s.toLowerCase().replace(/(^|\s|-)\S/g, (c) => c.toUpperCase()) : "—");

type Mes = { mes: string; cotacoes: number; decididas: number; fechadas: number; recusadas: number; perdidas: number; atualizado_em: string };
type Faixa = { faixa: string; ordem: number; decididas: number; fechadas: number; recusadas: number; perdidas: number };
type Preco = { seguradora: string; apolices: number; premio_alugueis_mediana: number; premio_alugueis_p25: number; premio_alugueis_p75: number };
type Part = { ano: number; seguradora: string; apolices: number; pct: number };
type Regiao = { cep5?: string; cidade: string | null; uf?: string | null; bairro?: string | null; n: number; p25: number; mediana: number; p75: number };
type Imob = { chave: string; decididas_24m: number; fechadas_24m: number; base: string };
type Margem = { produto: string; seguradora: string; ano: number; apolices: number; comissao: number; repasse: number };

function Secao({ titulo: t, legenda, children }: { titulo: string; legenda?: string; children: React.ReactNode }) {
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

export default async function DashboardEstatisticas({ verMargem }: { verMargem: boolean }) {
  const sb = await createClient();
  const [mes, faixa, preco, part, cidades, ceps, imobs, margem] = await Promise.all([
    sb.from("analise_mercado_mes").select("*").order("mes"),
    sb.from("analise_mercado_faixa").select("*").order("ordem"),
    sb.from("analise_preco_seguradora").select("*").order("premio_alugueis_mediana"),
    sb.from("analise_mercado_seguradora_ano").select("*").gte("ano", 2022).order("ano"),
    sb.from("analise_aluguel_cidade").select("*").order("n", { ascending: false }).limit(10),
    sb.from("analise_aluguel_cep5").select("*").gte("n", 30).order("n", { ascending: false }).limit(10),
    sb.from("analise_visita_imob").select("chave, decididas_24m, fechadas_24m, base").eq("tipo", "i").gte("decididas_24m", 100),
    verMargem ? sb.from("analise_margem").select("produto, seguradora, ano, apolices, comissao, repasse").in("ano", [2025, 2026]) : Promise.resolve({ data: [] as Margem[], error: null }),
  ]);
  const erro = [mes, faixa, preco, part, cidades, ceps, imobs, margem].find((r) => r.error)?.error?.message;
  const meses = (mes.data ?? []) as Mes[];
  if (erro || meses.length === 0) {
    return <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Não foi possível carregar os dados estatísticos agora{erro ? ` (${erro})` : ""}.</p>;
  }
  const faixas = (faixa.data ?? []) as Faixa[];
  const precos = (preco.data ?? []) as Preco[];
  const parts = (part.data ?? []) as Part[];
  const dCid = (cidades.data ?? []) as Regiao[];
  const dCep = (ceps.data ?? []) as Regiao[];
  const dImob = (imobs.data ?? []) as Imob[];
  const dMarg = ((margem.data ?? []) as Margem[]).map((m) => ({ ...m, comissao: Number(m.comissao), repasse: Number(m.repasse) }));

  // Cartões: últimos 24 meses (mesma janela da tabela por faixa).
  const tot = faixas.reduce((t, f) => ({ d: t.d + f.decididas, f: t.f + f.fechadas, r: t.r + f.recusadas, p: t.p + f.perdidas }), { d: 0, f: 0, r: 0, p: 0 });
  const apolicesPreco = precos.reduce((t, p) => t + p.apolices, 0);
  const premioTipico = apolicesPreco ? precos.reduce((t, p) => t + p.premio_alugueis_mediana * p.apolices, 0) / apolicesPreco : null;

  // Série mensal (36 últimos meses com 100+ decididas).
  // Os 2 meses mais recentes ficam de fora: ainda há cotações em andamento e a taxa aparece artificialmente baixa.
  const corte = new Date();
  corte.setDate(1);
  corte.setMonth(corte.getMonth() - 2);
  const serie = meses.filter((m) => m.decididas >= 100 && new Date(m.mes + "T12:00:00") <= corte).slice(-36);

  // Imobiliárias: nomes do banco único.
  const ordenadas = dImob.map((i) => ({ ...i, conv: (100 * i.fechadas_24m) / i.decididas_24m })).sort((a, b) => b.conv - a.conv);
  const destaques = [...ordenadas.slice(0, 5), ...ordenadas.slice(-5)];
  const { data: nomesRows } = destaques.length ? await sb.from("imobiliarias").select("id, nome, apelido").in("id", destaques.map((d) => d.chave)) : { data: [] };
  const nome = new Map((nomesRows ?? []).map((r: { id: string; nome: string; apelido: string | null }) => [r.id, r.apelido || r.nome]));

  // Margem (admin): por produto e Fiança por seguradora.
  const porProduto = new Map<string, { ap: number; com: number; rep: number }>();
  const fiancaSeg = new Map<string, { ap: number; com: number; rep: number }>();
  for (const m of dMarg) {
    const a = porProduto.get(m.produto) ?? { ap: 0, com: 0, rep: 0 };
    a.ap += m.apolices; a.com += m.comissao; a.rep += m.repasse; porProduto.set(m.produto, a);
    if (m.produto === "Fiança") {
      const b = fiancaSeg.get(m.seguradora) ?? { ap: 0, com: 0, rep: 0 };
      b.ap += m.apolices; b.com += m.comissao; b.rep += m.repasse; fiancaSeg.set(m.seguradora, b);
    }
  }
  const produtos = [...porProduto.entries()].map(([p, v]) => ({ p, ...v, margem: v.com - v.rep })).sort((a, b) => b.margem - a.margem).filter((x) => x.ap >= 20);
  const fiancaMargemApolice = porProduto.get("Fiança") ? (porProduto.get("Fiança")!.com - porProduto.get("Fiança")!.rep) / porProduto.get("Fiança")!.ap : null;
  const atualizado = meses[meses.length - 1]?.atualizado_em;

  const anos = [...new Set(parts.map((p) => p.ano))];
  const segs = [...new Set(parts.map((p) => p.seguradora))].sort((a, b) => (parts.find((p) => p.seguradora === b && p.ano === anos.at(-1))?.pct ?? 0) - (parts.find((p) => p.seguradora === a && p.ano === anos.at(-1))?.pct ?? 0));
  const maxFaixa = Math.max(...faixas.map((f) => pct(f.fechadas, f.decididas) ?? 0), 1);
  const maxSerie = Math.max(...serie.map((m) => pct(m.fechadas, m.decididas) ?? 0), 1);

  return (
    <div className="space-y-5">
      <p className="text-xs text-o2-cinza-medio">
        Visão de mercado dos seguros da <b>nossa carteira</b> (Fiança de contratação nova; não é o mercado inteiro). Últimos 24 meses, salvo onde indicado.
        {atualizado ? ` Atualizado em ${new Date(atualizado).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.` : ""}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao rotulo="Cotações que fecham" valor={fp(pct(tot.f, tot.d))} linhas={[`${inteiro.format(tot.f)} de ${inteiro.format(tot.d)} decididas`]} />
        <Cartao rotulo="Recusadas pela seguradora" valor={fp(pct(tot.r, tot.d))} linhas={[`${inteiro.format(tot.r)} recusas`]} />
        <Cartao rotulo="Fecham se aprovadas" valor={fp(pct(tot.f, tot.f + tot.p))} linhas={[`${inteiro.format(tot.p)} aprovadas que não fecharam`]} />
        <Cartao
          rotulo="Prêmio típico do ano"
          valor={premioTipico == null ? "—" : `${dec2.format(premioTipico)} aluguéis`}
          linhas={premioTipico == null ? [] : [`parcela mensal ≈ ${fp(((premioTipico / 12) * 100))} do aluguel`]}
        />
      </div>

      <Secao
        titulo="Fechamento por faixa de aluguel"
        legenda="Das cotações de Fiança (contratação nova) já decididas nos últimos 24 meses, quantas fecharam, por faixa de aluguel. Quanto maior o aluguel, menos fecha. A recusa pela seguradora tem formato de U: maior nos aluguéis muito baixos e muito altos."
      >
        <div className="space-y-2">
          {faixas.map((f) => (
            <div key={f.faixa} className="grid grid-cols-[6.5rem_1fr_9rem] items-center gap-3 text-xs">
              <span className="text-o2-cinza-escuro">R$ {f.faixa}</span>
              <Barra valor={pct(f.fechadas, f.decididas) ?? 0} max={maxFaixa} />
              <span className="tabular-nums text-o2-navy">
                <b>{fp(pct(f.fechadas, f.decididas))}</b> fecha · <span className="text-o2-cinza-medio">{fp(pct(f.recusadas, f.decididas))} recusa</span>
              </span>
            </div>
          ))}
        </div>
      </Secao>

      <Secao
        titulo="Fechamento mês a mês"
        legenda="% das cotações decididas que fecharam, por mês em que a cotação ENTROU (difere do painel da Fiança, que conta cada evento no mês em que acontece). Só meses com 100 ou mais decididas; os 2 meses mais recentes ficam de fora, porque ainda há cotações em andamento e a taxa apareceria baixa demais."
      >
        <div className="flex h-28 items-end gap-0.5">
          {serie.map((m) => {
            const v = pct(m.fechadas, m.decididas) ?? 0;
            const d = new Date(m.mes + "T12:00:00");
            return (
              <div key={m.mes} className="group flex h-full flex-1 flex-col justify-end" title={`${MES[d.getMonth()]}/${d.getFullYear()}: ${dec1.format(v)}% (${m.fechadas} de ${m.decididas})`}>
                <div className="rounded-t bg-o2-navy/80 group-hover:bg-o2-coral" style={{ height: `${(v / maxSerie) * 100}%` }} />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[10px] text-o2-cinza-medio">
          <span>{serie[0] ? `${MES[new Date(serie[0].mes + "T12:00:00").getMonth()]}/${new Date(serie[0].mes + "T12:00:00").getFullYear()}` : ""}</span>
          <span>passe o mouse nas barras para ver o mês</span>
          <span>{serie.at(-1) ? `${MES[new Date(serie.at(-1)!.mes + "T12:00:00").getMonth()]}/${new Date(serie.at(-1)!.mes + "T12:00:00").getFullYear()}` : ""}</span>
        </div>
      </Secao>

      <Secao
        titulo="Preço praticado por seguradora"
        legenda="Prêmio anual em número de aluguéis (mediana das apólices de Fiança fechadas de 2024 em diante; metade fica entre o 25% e o 75%). A parcela mensal é o prêmio ÷ 12. O preço de cada seguradora é o que ela efetivamente cobrou nas apólices fechadas, não uma tabela."
      >
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
        <Secao titulo="Participação de cada seguradora nas apólices fechadas" legenda="% das cotações de Fiança fechadas em cada ano (pelo ano da cotação) por seguradora. Mostra a migração da carteira entre seguradoras.">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left uppercase tracking-wide text-o2-cinza-medio">
                <tr>
                  <th className="py-1">Seguradora</th>
                  {anos.map((a) => (
                    <th key={a} className="py-1 text-right">{a}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {segs.map((s) => (
                  <tr key={s} className="border-t border-gray-100">
                    <td className="py-1.5 font-medium text-o2-navy">{s}</td>
                    {anos.map((a) => {
                      const v = parts.find((p) => p.seguradora === s && p.ano === a)?.pct;
                      return (
                        <td key={a} className="py-1.5 text-right tabular-nums text-o2-cinza-escuro">{v == null ? "—" : fp(v)}</td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Secao>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Secao titulo="Aluguel por cidade" legenda="Aluguel das cotações de Fiança (contratação nova, 24 meses) da carteira da O2 nas 10 cidades com mais cotações. Mediana e faixa em que cai metade dos contratos (25% a 75%).">
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
        <Secao titulo="Aluguel por bairro (CEP)" legenda="Mesma base, agrupada pelos 5 primeiros dígitos do CEP (bairro). Só regiões com 30 ou mais cotações; o nome do bairro é o mais frequente nas cotações.">
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

      {destaques.length > 0 && (
        <Secao titulo="Imobiliárias: quem mais e quem menos fecha" legenda="Imobiliárias com 100 ou mais cotações de Fiança decididas em 24 meses, ordenadas pela taxa de fechamento. O número depende também do perfil de aluguel e da recusa pela seguradora de cada uma.">
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
      )}

      {verMargem && produtos.length > 0 && (
        <Secao
          titulo="Margem por apólice vendida (2025-2026)"
          legenda="Margem = comissão da apólice − repasse previsto à imobiliária (inclui o pró-labore, que é repasse negociado). Apólices vigentes ou vencidas, pelo início da vigência, 2025 e 2026 até agora. É margem de comissão: não desconta custos nem impostos. Só administradores veem."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {produtos.slice(0, 3).map((p) => (
              <Cartao key={p.p} rotulo={p.p} valor={reais.format(p.com - p.rep)} linhas={[`${inteiro.format(p.ap)} apólices`, `${reais.format((p.com - p.rep) / p.ap)} por apólice`, `repasse = ${fp(pct(p.rep, p.com))} da comissão`]} />
            ))}
          </div>
          {fiancaSeg.size > 0 && (
            <table className="w-full text-xs">
              <thead className="text-left uppercase tracking-wide text-o2-cinza-medio">
                <tr>
                  <th className="py-1">Fiança por seguradora</th>
                  <th className="py-1 text-right">Apólices</th>
                  <th className="py-1 text-right">Margem</th>
                  <th className="py-1 text-right">Por apólice</th>
                  <th className="py-1 text-right">Repasse / comissão</th>
                </tr>
              </thead>
              <tbody>
                {[...fiancaSeg.entries()]
                  .filter(([, v]) => v.ap >= 30)
                  .sort((a, b) => b[1].com - b[1].rep - (a[1].com - a[1].rep))
                  .map(([s, v]) => (
                    <tr key={s} className="border-t border-gray-100">
                      <td className="py-1.5 font-medium text-o2-navy">{titulo(s)}</td>
                      <td className="py-1.5 text-right tabular-nums">{inteiro.format(v.ap)}</td>
                      <td className="py-1.5 text-right tabular-nums">{reais.format(v.com - v.rep)}</td>
                      <td className="py-1.5 text-right tabular-nums">{reais.format((v.com - v.rep) / v.ap)}</td>
                      <td className="py-1.5 text-right tabular-nums text-o2-cinza-medio">{fp(pct(v.rep, v.com))}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
          {fiancaMargemApolice != null && <p className="text-[11px] text-o2-cinza-medio">Margem média por apólice de Fiança: {reais.format(fiancaMargemApolice)}.</p>}
        </Secao>
      )}
    </div>
  );
}
