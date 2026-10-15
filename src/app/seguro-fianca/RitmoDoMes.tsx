import InfoLegenda from "@/components/InfoLegenda";
import ExportarQuadro from "@/components/ExportarQuadro";
import type { QuadroDiario } from "@/lib/bitrix/seguroFianca";
import styles from "./seguro-fianca.module.css";

// Setas de tendência do ritmo do mês (pedido do Matheus na reunião com a
// Patricia de 15/10/2026): para análises, contratos recebidos e efetivações,
// compara (a) o dia de hoje com o MESMO dia do mês anterior e (b) o acumulado
// do mês até hoje com o acumulado do mês anterior até o mesmo dia. Comparar o
// mês fechado inteiro contra o mês em andamento sempre mostra queda no meio
// do mês, por isso a régua é "até o mesmo dia".

export type SerieRitmo = {
  chave: string;
  titulo: string;
  legenda: string;
  atual: number[]; // total por dia do mês selecionado (índice 0 = dia 1)
  anterior: number[] | null; // idem para o mês anterior (null = sem retrato salvo)
};

export function serieDeQuadro(q: QuadroDiario | null | undefined): number[] | null {
  return q ? q.dias.map((d) => d.total) : null;
}

export function somarSeries(a: number[] | null, b: number[] | null): number[] | null {
  if (!a || !b) return null;
  const n = Math.max(a.length, b.length);
  return Array.from({ length: n }, (_, i) => (a[i] ?? 0) + (b[i] ?? 0));
}

function soma(v: number[], ate: number): number {
  let s = 0;
  for (let i = 0; i < Math.min(ate, v.length); i++) s += v[i];
  return s;
}

function Seta({ atual, anterior, rotuloBase }: { atual: number; anterior: number | null; rotuloBase: string }) {
  if (anterior === null) {
    return <span style={{ color: "var(--ink-faint)" }}>sem retrato do mês anterior</span>;
  }
  const dif = atual - anterior;
  if (dif === 0) {
    return (
      <span style={{ color: "var(--ink-faint)", fontWeight: 600 }}>
        — igual ao {rotuloBase} ({anterior})
      </span>
    );
  }
  const subiu = dif > 0;
  const pct = anterior > 0 ? ` (${subiu ? "+" : "−"}${Math.round((Math.abs(dif) / anterior) * 100)}%)` : "";
  return (
    <span style={{ color: subiu ? "var(--info)" : "var(--negative)", fontWeight: 700 }}>
      {subiu ? "▲" : "▼"} {subiu ? "+" : "−"}
      {Math.abs(dif)}
      {pct} <span style={{ fontWeight: 400, color: "var(--ink-muted)" }}>vs. {rotuloBase} ({anterior})</span>
    </span>
  );
}

export default function RitmoDoMes({
  id,
  titulo,
  competencia,
  competenciaAnterior,
  ehCompetenciaAtual,
  diaHoje,
  series,
}: {
  id: string;
  titulo: string;
  competencia: string;
  competenciaAnterior: string;
  ehCompetenciaAtual: boolean;
  diaHoje: number; // dia do mês em Brasília (só vale quando ehCompetenciaAtual)
  series: SerieRitmo[];
}) {
  const diasDoMes = series[0]?.atual.length ?? 0;
  const dia = ehCompetenciaAtual ? Math.min(diaHoje, diasDoMes) : diasDoMes;
  const [aa, mm] = competencia.split("-");
  const [aaAnt, mmAnt] = competenciaAnterior.split("-");
  const fmtDia = (d: number, a: string, m: string) => `${String(d).padStart(2, "0")}/${m}/${a}`;
  const rotuloAcumuladoAnt = `mês anterior até dia ${dia}`;

  const dadosExcel = series.map((s) => ({
    indicador: s.titulo,
    [`acumulado até dia ${dia}`]: soma(s.atual, dia),
    [`acumulado do mês anterior até dia ${dia}`]: s.anterior ? soma(s.anterior, dia) : "",
    ...(ehCompetenciaAtual
      ? { [`dia ${dia}`]: s.atual[dia - 1] ?? 0, [`mesmo dia do mês anterior`]: s.anterior ? (s.anterior[dia - 1] ?? 0) : "" }
      : {}),
  }));

  return (
    <section id={id} className={styles.section}>
      <div className={styles.sectionHead}>
        <h2>
          {titulo}
          <InfoLegenda titulo="Como as setas são calculadas">
            Compara com o mês anterior usando a mesma régua de dias, para não comparar um mês em andamento com um mês fechado. Acumulado = soma do dia 1 até o dia {dia} deste mês contra a soma do dia 1 até o dia {dia} do mês anterior.
            {ehCompetenciaAtual && " Hoje = o dia de hoje contra o mesmo dia do mês anterior (fins de semana e feriados costumam ficar em zero nos dois lados)."}
            {" "}Análises = cards criados no dia. Contratos recebidos = cards que entraram em Contrato Recebido no dia, de qualquer origem. Efetivações = contratos efetivados no dia.
          </InfoLegenda>
        </h2>
        <div className={styles.note}>
          {ehCompetenciaAtual
            ? `até hoje, dia ${dia} — comparado ao mês anterior (${mmAnt}/${aaAnt}) até o mesmo dia`
            : `mês completo — comparado ao mês anterior (${mmAnt}/${aaAnt})`}
        </div>
        <ExportarQuadro
          quadroId={id}
          corFundo="#f7f8fa"
          nomeArquivo={`seguro-fianca-ritmo-${id}-${competencia}`}
          dadosExcel={dadosExcel}
          nomeAbaExcel="Ritmo do mês"
        />
      </div>
      <div className={styles.kpis}>
        {series.map((s) => {
          const acumulado = soma(s.atual, dia);
          const acumuladoAnt = s.anterior ? soma(s.anterior, dia) : null;
          const hoje = s.atual[dia - 1] ?? 0;
          const hojeAnt = s.anterior ? (s.anterior[dia - 1] ?? 0) : null;
          return (
            <div key={s.chave} className={styles.kpi}>
              <div className={styles.kpiLabel}>
                {s.titulo}
                <InfoLegenda titulo={s.titulo}>{s.legenda}</InfoLegenda>
              </div>
              <div className={`${styles.kpiValue} ${styles.num} ${styles.info}`}>{acumulado}</div>
              <div className={styles.kpiSub}>
                {ehCompetenciaAtual ? `acumulado do mês até o dia ${dia}` : "total do mês"}
              </div>
              <div className={styles.kpiSub}>
                <Seta atual={acumulado} anterior={acumuladoAnt} rotuloBase={rotuloAcumuladoAnt} />
              </div>
              {ehCompetenciaAtual && (
                <div className={styles.kpiSub} style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--line)" }}>
                  <strong>Hoje ({fmtDia(dia, aa, mm)}, parcial): {hoje}</strong>
                  <br />
                  <Seta atual={hoje} anterior={hojeAnt} rotuloBase={fmtDia(dia, aaAnt, mmAnt).slice(0, 5)} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
