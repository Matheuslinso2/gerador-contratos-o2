// Ficha de visita (Matheus, 03/11/2026): antes de visitar uma imobiliária, ver
// (1) o aluguel que se pratica na região dela, (2) quanto ficaria o seguro de
// Fiança pelo perfil de aluguel dela e (3) a margem atual e o potencial.
// Dados prontos em supabase/schema_ficha_visita.sql e schema_analise_margem.sql
// (função ficha_visita, só colaborador O2). Regra do Matheus: com endereços
// suficientes da própria imobiliária (30+ cotações com CEP em 24 meses) usa os
// dados dela; com pouca produção usa o estudo dos bairros onde ela atua; sem
// endereço, a cidade da ficha. Aluguel = carteira da O2, não o mercado inteiro.
import type { ReactNode } from "react";
import InfoLegenda from "@/components/InfoLegenda";

export type FichaVisitaDados = {
  base: "propria" | "bairros" | "cidade" | "sem_dados";
  cotacoes_24m: number | null;
  cotacoes_cep_24m: number | null;
  regiao: { fonte: string; n?: number; p25?: number; mediana?: number; p75?: number; cidade?: string };
  areas: { cep5: string; bairro: string | null; cidade: string | null; n: number; mediana_imob: number; n_regiao: number; mediana_regiao: number }[];
  aluguel_ref: number | null;
  precos: { seguradora: string; apolices: number; premio_alugueis: number; premio_anual: number; parcela_mensal: number; parcela_pct_aluguel: number }[];
  margem: { produto: string; apolices: number; comissao: number; repasse: number; margem: number; margem_apolice: number | null }[];
  potencial: { conv_atual: number | null; conv_esperada: number | null; decididas_24m: number | null; apolices_extras_ano: number; margem_apolice_fianca: number | null; margem_extra_ano: number };
  atualizado_em: string | null;
};

const num = (v: number) => Math.round(v).toLocaleString("pt-BR");
const reais = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }));
const pct1 = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const capitalizar = (s: string | null) => (s ? s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : "—");

const ROTULO_BASE: Record<FichaVisitaDados["base"], (f: FichaVisitaDados) => string> = {
  propria: (f) => `Base: os dados da própria imobiliária (${num(f.cotacoes_cep_24m ?? 0)} cotações de Fiança com endereço nos últimos 24 meses).`,
  bairros: (f) =>
    `Base: estudo dos bairros onde ela atua. Ela tem poucos endereços (${num(f.cotacoes_cep_24m ?? 0)} cotações com CEP em 24 meses; o corte é 30), então usamos a carteira da O2 nos mesmos bairros (${num(f.regiao.n ?? 0)} cotações).`,
  cidade: (f) => `Base: cidade da ficha (${capitalizar(f.regiao.cidade ?? null)}). Não há endereços dela nas cotações; usamos a carteira da O2 na cidade (${num(f.regiao.n ?? 0)} cotações).`,
  sem_dados: () => "Sem dados: não há cotações com endereço dela nem cidade com cotações suficientes na carteira da O2.",
};

function Painel({ titulo, legenda, children }: { titulo: string; legenda?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <h3 className="flex items-center gap-1 text-sm font-semibold uppercase tracking-wide text-o2-navy">
        {titulo}
        {legenda && <InfoLegenda titulo={titulo}>{legenda}</InfoLegenda>}
      </h3>
      {children}
    </div>
  );
}

export default function FichaVisita({ ficha, erro }: { ficha: FichaVisitaDados | null; erro?: string | null }) {
  return (
    <section className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50/60 p-5" style={{ borderTop: "4px solid #F8540D" }}>
      <h2 className="flex items-center gap-1 text-lg font-bold text-o2-navy">
        Ficha de visita
        <InfoLegenda titulo="Ficha de visita">
          Resumo para levar à visita: aluguel que se pratica na região dela, quanto ficaria o seguro de Fiança pelo perfil de aluguel dela e a margem atual e potencial. O
          aluguel vem das cotações de Fiança da carteira da O2 (últimos 24 meses), não do mercado inteiro.
        </InfoLegenda>
      </h2>
      {erro || !ficha ? (
        <p className="text-sm text-red-700">Não foi possível montar a ficha agora{erro ? ` (${erro})` : ""}.</p>
      ) : (
        <Corpo f={ficha} />
      )}
    </section>
  );
}

function Corpo({ f }: { f: FichaVisitaDados }) {
  const r = f.regiao;
  return (
    <>
      <p className="rounded-lg bg-white px-3 py-2 text-xs text-gray-600">{ROTULO_BASE[f.base](f)}</p>
      <div className="grid gap-4 lg:grid-cols-3">
        <Painel
          titulo="1. Aluguel na região"
          legenda="Aluguel das cotações de Fiança (contratação nova, 24 meses) da carteira da O2. Mostra o aluguel típico (mediana) e a faixa em que cai metade dos contratos (25% a 75%)."
        >
          {r.mediana == null ? (
            <p className="text-sm text-gray-500">Sem dados de aluguel para esta imobiliária.</p>
          ) : (
            <>
              <p className="text-2xl font-bold tabular-nums text-o2-navy">{reais(r.mediana)}</p>
              <p className="text-xs text-gray-500">
                aluguel mediano · metade dos contratos entre {reais(r.p25)} e {reais(r.p75)}
              </p>
              {f.areas.length > 0 && (
                <table className="w-full text-xs">
                  <thead className="text-left uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="py-1">Região (CEP)</th>
                      <th className="py-1 text-right">Dela</th>
                      <th className="py-1 text-right">Região*</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.areas.slice(0, 6).map((a) => (
                      <tr key={a.cep5} className="border-t border-gray-100">
                        <td className="py-1">
                          {capitalizar(a.bairro) !== "—" ? capitalizar(a.bairro) : `CEP ${a.cep5}-***`}
                          <span className="block text-[10px] text-gray-400">
                            {capitalizar(a.cidade)} · {num(a.n)} cotações dela
                          </span>
                        </td>
                        <td className="py-1 text-right tabular-nums">{reais(a.mediana_imob)}</td>
                        <td className="py-1 text-right tabular-nums">
                          {reais(a.mediana_regiao)}
                          <span className="block text-[10px] text-gray-400">{num(a.n_regiao)} cot.</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="text-[10px] text-gray-400">*Mediana da carteira da O2 na região (todas as imobiliárias). Não é o mercado inteiro.</p>
            </>
          )}
        </Painel>

        <Painel
          titulo="2. Quanto ficaria o seguro"
          legenda="Prêmio anual = aluguel de referência × quantos aluguéis cada seguradora cobra (mediana das apólices de Fiança fechadas de 2024 em diante). Parcela mensal = prêmio ÷ 12. É uma estimativa pelo preço médio praticado, não uma cotação."
        >
          {f.aluguel_ref == null || f.precos.length === 0 ? (
            <p className="text-sm text-gray-500">Sem aluguel de referência para simular.</p>
          ) : (
            <>
              <p className="text-xs text-gray-500">Para um aluguel de {reais(f.aluguel_ref)} (mediano dela):</p>
              <table className="w-full text-xs">
                <thead className="text-left uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="py-1">Seguradora</th>
                    <th className="py-1 text-right">Prêmio/ano</th>
                    <th className="py-1 text-right">Parcela</th>
                  </tr>
                </thead>
                <tbody>
                  {f.precos.map((p) => (
                    <tr key={p.seguradora} className="border-t border-gray-100">
                      <td className="py-1">
                        {p.seguradora}
                        <span className="block text-[10px] text-gray-400">
                          {p.premio_alugueis.toLocaleString("pt-BR")} aluguéis · {num(p.apolices)} apólices
                        </span>
                      </td>
                      <td className="py-1 text-right tabular-nums">{reais(p.premio_anual)}</td>
                      <td className="py-1 text-right tabular-nums">
                        {reais(p.parcela_mensal)}
                        <span className="block text-[10px] text-gray-400">{pct1(p.parcela_pct_aluguel)} do aluguel</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Painel>

        <Painel
          titulo="3. Margem"
          legenda="Margem = comissão da apólice − repasse previsto à imobiliária (inclui o pró-labore, que é repasse negociado). Apólices vigentes ou vencidas, 2025 e 2026. Não desconta custos nem impostos. O potencial da Fiança supõe que ela fechasse na taxa média da O2 para o perfil de aluguel dela; é uma hipótese, não uma previsão."
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Atual (2025-2026)</p>
          {f.margem.length === 0 ? (
            <p className="text-sm text-gray-500">Nenhuma apólice dela no período.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-left uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="py-1">Produto</th>
                  <th className="py-1 text-right">Apólices</th>
                  <th className="py-1 text-right">Margem</th>
                </tr>
              </thead>
              <tbody>
                {f.margem.slice(0, 5).map((m) => (
                  <tr key={m.produto} className="border-t border-gray-100">
                    <td className="py-1">{m.produto}</td>
                    <td className="py-1 text-right tabular-nums">{num(m.apolices)}</td>
                    <td className="py-1 text-right tabular-nums">
                      {reais(m.margem)}
                      <span className="block text-[10px] text-gray-400">{reais(m.margem_apolice)} por apólice</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Potencial na Fiança</p>
          {f.potencial.conv_atual == null || f.potencial.conv_esperada == null ? (
            <p className="text-sm text-gray-500">Sem cotações decididas suficientes para estimar.</p>
          ) : (
            <div className="space-y-1 text-xs text-gray-700">
              <p>
                Fecha hoje <b>{pct1(f.potencial.conv_atual)}</b> das cotações decididas; com o perfil de aluguel dela, a O2 fecha em média <b>{pct1(f.potencial.conv_esperada)}</b>.
              </p>
              {f.potencial.apolices_extras_ano > 0 ? (
                <p className="text-sm font-semibold text-o2-navy">
                  ≈ {f.potencial.apolices_extras_ano.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} apólices a mais por ano ≈ {reais(f.potencial.margem_extra_ano)} de margem
                  <span className="block text-[10px] font-normal text-gray-400">a {reais(f.potencial.margem_apolice_fianca)} de margem por apólice de Fiança (média O2)</span>
                </p>
              ) : (
                <p>Ela já fecha acima da média da O2 para esse perfil.</p>
              )}
            </div>
          )}
        </Painel>
      </div>
    </>
  );
}
