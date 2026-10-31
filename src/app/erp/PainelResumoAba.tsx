import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import InfoLegenda from "@/components/InfoLegenda";

// Painel recolhido de KPIs e gráficos no topo de cada aba do ERP (Matheus 31/10): fica FECHADO e é o primeiro conteúdo da página;
// o que já existia na aba vem depois. Lê só a função erp_resumo_<aba> pelo erp_retrato (cache de 15 min), nunca recalcula a cada abertura.
type Linha = { bloco: string; rotulo: string; serie: string; valor: number | string; ordem: number };

const COR: Record<string, string> = {
  Efetivadas: "#01192e",
  Emitidas: "#2f9e57",
  Pendentes: "#F8540D",
  Paga: "#2f9e57",
  "A vencer": "#3b82c4",
  "Atenção ou urgente": "#e0a21a",
  "Risco de cancelamento": "#c0392b",
  "Aguardando comissão": "#8d8683",
  "Com prova": "#2f9e57",
  "Sem prova": "#c0392b",
};
const corDe = (serie: string) => COR[serie] ?? "#01192e";
const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

type Props = { funcao: string; titulo?: string; legendas?: Record<string, string> };

// Entra em streaming: a página abre na hora e o painel (cache de 15 min; o primeiro cálculo de Parcelas leva alguns segundos) aparece quando ficar pronto.
export default function PainelResumoAba(props: Props) {
  return (
    <Suspense fallback={<div className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs text-gray-400">Carregando indicadores e gráficos…</div>}>
      <Conteudo {...props} />
    </Suspense>
  );
}

async function Conteudo({ funcao, titulo = "Resumo da aba", legendas = {} }: Props) {
  const supabase = await createClient();
  const hoje = new Date().toISOString().slice(0, 10);
  const { data } = await supabase.rpc("erp_retrato", { p_funcao: funcao, p_de: hoje, p_ate: hoje });
  const linhas = ((data ?? []) as Linha[]).map((l) => ({ ...l, valor: Number(l.valor) }));
  if (!linhas.length) return null;

  const kpis = linhas.filter((l) => l.bloco.startsWith("kpi|")).sort((a, b) => a.ordem - b.ordem);
  const titulos = [...new Set(linhas.filter((l) => l.bloco.startsWith("graf|")).map((l) => l.bloco))];

  return (
    <details className="group rounded-xl border border-gray-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-semibold text-o2-navy">
        <span className="inline-block transition group-open:rotate-90">▸</span>
        {titulo}: indicadores e gráficos
        <span className="text-[11px] font-normal text-gray-400">(clique para abrir ou recolher)</span>
        <InfoLegenda titulo={`${titulo}: indicadores e gráficos`}>
          Resumo dos números desta aba, recolhido por padrão. Os indicadores e os gráficos leem as mesmas tabelas prontas da tela e são atualizados a cada 15 minutos, sem recalcular a cada abertura. Abaixo dele vem o conteúdo normal da aba.
        </InfoLegenda>
      </summary>
      <div className="space-y-4 border-t border-gray-100 p-4">
        {kpis.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {kpis.map((k) => (
              <div key={k.bloco} className="rounded-lg border border-gray-200 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-gray-500">{k.bloco.slice(4)}</div>
                <div className="text-xl font-semibold text-o2-navy">{fmt(k.valor as number)}</div>
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-3">
          {titulos.map((t) => {
            const ls = linhas.filter((l) => l.bloco === t);
            const cats = [...new Map(ls.sort((a, b) => a.ordem - b.ordem).map((l) => [l.rotulo, l.ordem])).keys()];
            const series = [...new Set(ls.map((l) => l.serie))];
            const max = Math.max(...ls.map((l) => l.valor as number), 1);
            const nome = t.slice(5);
            return (
              <div key={t} className="rounded-lg border border-gray-200 p-3">
                <div className="mb-2 flex items-center text-xs font-semibold text-o2-navy">
                  {nome}
                  {legendas[nome] && <InfoLegenda titulo={nome}>{legendas[nome]}</InfoLegenda>}
                </div>
                {series.length > 1 && (
                  <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-600">
                    {series.map((s) => (
                      <span key={s} className="inline-flex items-center gap-1">
                        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: corDe(s) }} />
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                <div className="space-y-2">
                  {cats.map((c) => (
                    <div key={c} className="text-[11px]">
                      <div className="mb-0.5 text-gray-600">{c}</div>
                      {series.map((s) => {
                        const v = ls.find((l) => l.rotulo === c && l.serie === s);
                        if (!v) return null;
                        return (
                          <div key={s} className="flex items-center gap-2">
                            <div className="h-2.5 rounded-sm" style={{ width: `${Math.max(2, ((v.valor as number) / max) * 100)}%`, background: corDe(s), maxWidth: "calc(100% - 3rem)" }} />
                            <span className="text-gray-700">{fmt(v.valor as number)}</span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}
