import type { SupabaseClient } from "@supabase/supabase-js";

// Quadro "Impacto da campanha" (03/11/2026): foto de partida CONGELADA de cada participante
// (tendência de produção, baseline do que produziria sem a campanha, engajamento prévio) e a
// leitura provisória do efeito. Dropdown sempre fechado: só abre pelo clique. Fica escondido
// se a campanha não tem foto de partida (campanhas_foto_partida).

type Dados = {
  tendencia: { tendencia: string; ultimos12m: number; anteriores12m: number; variacao: number | null; mesesHistorico: number; motivo: string | null };
  baseline: { usado: number; intervalo: [number, number]; mesmoPeriodoAnoAnterior: number; ritmoRecente: number; criterio: string };
  ambicao: number | null;
  engajamento: { nivelResposta: string; nivelEsforco: string } | null;
  matriz: { quadrante: string; acao: string };
  controles: { qtd: number; medianaVariacao: number | null; qtdClassificaveis: number };
  provisorio: { ate: string; realizado: number; esperadoAteAgora: number; diasDecorridos: number; diasPeriodo: number };
};
type Linha = { unidade: string; nome: string; periodo_inicio: string; periodo_fim: string; meta: number | null; tendencia: string; dados: Dados; criado_em: string };
type Agregado = { ate: string; elite: { ano_anterior: number; atual: number }; comparacao: { ano_anterior: number; atual: number; unidades: number }; razao: number | null; intervalo: [number, number] | null };

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const pct = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`);
const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

const COR_TENDENCIA: Record<string, string> = {
  Crescimento: "bg-green-100 text-green-800",
  "Estagnação": "bg-gray-100 text-gray-700",
  Queda: "bg-red-100 text-red-800",
  "Dados insuficientes": "bg-amber-50 text-amber-800",
};

function leituraDoAgregado(a: Agregado): string {
  if (!a.razao || !a.intervalo) return "Ainda não há casos suficientes para comparar.";
  if (a.intervalo[0] > 1) return "Indício de efeito positivo: o Elite cresceu mais que a carteira de comparação, e a diferença é maior que o acaso.";
  if (a.intervalo[1] < 1) return "Indício de efeito negativo: o Elite cresceu menos que a carteira de comparação.";
  return "Ainda não dá para afirmar que há efeito da campanha: a diferença está dentro da margem do acaso (o intervalo inclui 1).";
}

export default async function ImpactoCampanha({ campanhaId, db }: { campanhaId: string; db: SupabaseClient }) {
  const { data } = await db.from("campanhas_foto_partida").select("unidade, nome, periodo_inicio, periodo_fim, meta, tendencia, dados, criado_em").eq("campanha_id", campanhaId);
  const todas = (data ?? []) as (Omit<Linha, "dados"> & { dados: Dados | Agregado })[];
  if (!todas.length) return null;
  const agregado = todas.find((l) => l.unidade === "__agregado__")?.dados as Agregado | undefined;
  const linhas = (todas.filter((l) => l.unidade !== "__agregado__") as Linha[]).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const contagem = (t: string) => linhas.filter((l) => l.tendencia === t).length;
  const criada = linhas.reduce((m, l) => (l.criado_em > m ? l.criado_em : m), "");

  return (
    <details id="impacto" className="group rounded-2xl border border-o2-navy/10 bg-quadro shadow-sm">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 p-4 text-sm font-semibold text-o2-navy">
        <span>
          Impacto da campanha <span className="font-normal text-gray-500">— foto de partida e leitura provisória</span>
        </span>
        <span className="text-xs font-normal text-gray-500 group-open:hidden">clique para abrir</span>
        <span className="hidden text-xs font-normal text-gray-500 group-open:inline">clique para fechar</span>
      </summary>

      <div className="space-y-4 border-t border-o2-navy/10 p-4">
        {agregado && (
          <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm text-o2-navy">
            <p className="font-semibold">Leitura provisória do efeito (até {dmy(agregado.ate)})</p>
            <p className="mt-1">
              Contratações novas de Fiança e Capitalização nas mesmas datas do ano anterior: <strong>Elite {agregado.elite.ano_anterior} → {agregado.elite.atual}</strong>
              {agregado.elite.ano_anterior ? ` (${pct(agregado.elite.atual / agregado.elite.ano_anterior - 1)})` : ""} e{" "}
              <strong>
                carteira de comparação ({agregado.comparacao.unidades} imobiliárias ativas fora da campanha) {agregado.comparacao.ano_anterior} → {agregado.comparacao.atual}
              </strong>
              {agregado.comparacao.ano_anterior ? ` (${pct(agregado.comparacao.atual / agregado.comparacao.ano_anterior - 1)})` : ""}.
            </p>
            {agregado.razao && agregado.intervalo && (
              <p className="mt-1">
                Razão entre as duas variações: <strong>{agregado.razao.toFixed(2).replace(".", ",")}</strong> (intervalo de 95%: {agregado.intervalo[0].toFixed(2).replace(".", ",")} a{" "}
                {agregado.intervalo[1].toFixed(2).replace(".", ",")}).
              </p>
            )}
            <p className="mt-1 font-medium">{leituraDoAgregado(agregado)}</p>
            <p className="mt-1 text-xs text-gray-500">Poucos dias e poucos casos: é um indício, não uma conclusão. O Elite foi escolhido entre as imobiliárias mais engajadas, o que pode inflar a diferença.</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 text-xs">
          {["Crescimento", "Estagnação", "Queda", "Dados insuficientes"].map((t) => (
            <span key={t} className={`rounded-full px-2.5 py-1 font-medium ${COR_TENDENCIA[t]}`}>
              {contagem(t)} {t === "Dados insuficientes" ? "sem dados suficientes" : t === "Crescimento" ? "em crescimento" : t === "Estagnação" ? "estagnadas" : "em queda"}
            </span>
          ))}
        </div>

        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b bg-gray-50 text-gray-500">
                <th className="px-2 py-2">Imobiliária</th>
                <th className="px-2 py-2">Período</th>
                <th className="px-2 py-2">Tendência (12 meses)</th>
                <th className="px-2 py-2 text-right">Sem a campanha (baseline)</th>
                <th className="px-2 py-2 text-right">Meta ÷ baseline</th>
                <th className="px-2 py-2">Engajamento prévio</th>
                <th className="px-2 py-2">Leitura</th>
                <th className="px-2 py-2 text-right">Na data da foto</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const d = l.dados;
                return (
                  <tr key={l.unidade} className="border-b align-top last:border-0">
                    <td className="px-2 py-2 font-medium text-o2-navy">{l.nome}</td>
                    <td className="whitespace-nowrap px-2 py-2">
                      {dm(l.periodo_inicio)} a {dm(l.periodo_fim)}
                    </td>
                    <td className="px-2 py-2">
                      <span className={`rounded-full px-2 py-0.5 font-medium ${COR_TENDENCIA[l.tendencia] ?? "bg-gray-100 text-gray-700"}`}>{l.tendencia}</span>
                      <div className="mt-1 text-gray-500">
                        {d.tendencia.anteriores12m} → {d.tendencia.ultimos12m} ({pct(d.tendencia.variacao)})
                        {d.tendencia.motivo ? <div className="text-amber-700">{d.tendencia.motivo}</div> : null}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      <strong>{num(d.baseline.usado)}</strong>
                      <div className="text-gray-500">
                        margem {num(d.baseline.intervalo[0])}–{num(d.baseline.intervalo[1])}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{d.ambicao === null ? "—" : `${num(d.ambicao)}×`}</td>
                    <td className="px-2 py-2">{d.engajamento ? `resposta ${d.engajamento.nivelResposta} · esforço ${d.engajamento.nivelEsforco}` : "indisponível"}</td>
                    <td className="px-2 py-2 text-gray-700">
                      <div className="font-medium">{d.matriz.quadrante}</div>
                      <div className="text-gray-500">{d.matriz.acao}</div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                      {d.provisorio.realizado} <span className="text-gray-500">de {num(d.provisorio.esperadoAteAgora)} esperadas</span>
                      <div className="text-gray-500">em {dm(d.provisorio.ate)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <details className="rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600">
          <summary className="cursor-pointer font-medium text-o2-navy">Como ler este quadro</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>Tendência:</strong> contratações novas de Fiança e Capitalização nos 12 meses antes do início da campanha contra os 12 meses anteriores. Entre -20% e +20% é estagnação; acima, crescimento; abaixo, queda. Com menos de 18 meses de histórico ou menos de 10 contratações em 24 meses, fica “dados insuficientes”.
            </li>
            <li>
              <strong>Baseline:</strong> o que a imobiliária produziria sem a campanha no mesmo período: a média entre o mesmo período do ano anterior e o ritmo dos últimos 12 meses. A margem mostra a incerteza (poucos casos = margem grande).
            </li>
            <li>
              <strong>Meta ÷ baseline:</strong> quantas vezes a meta é maior que o baseline. Perto de 1 é meta no nível do histórico; muito acima de 3 é meta distante do que a imobiliária costuma fazer.
            </li>
            <li>
              <strong>Engajamento prévio:</strong> últimos 90 dias antes da campanha. Resposta = a imobiliária procurou ou respondeu a O2; esforço = a O2 procurou a imobiliária. Níveis pelo percentil na carteira ativa.
            </li>
            <li>
              <strong>Leitura:</strong> cruza a tendência com o engajamento e sugere a ação. A foto é <strong>congelada</strong> (gerada em {criada ? dmy(criada.slice(0, 10)) : "—"}) e não recalcula; o efeito só pode ser afirmado quando a campanha avançar e a comparação superar o acaso.
            </li>
          </ul>
        </details>
      </div>
    </details>
  );
}
