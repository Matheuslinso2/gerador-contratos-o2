import InfoLegenda from "@/components/InfoLegenda";
import type { QuadroDiario } from "@/lib/bitrix/seguroFianca";
import styles from "./seguro-fianca.module.css";

// Marcadores de tendência dos 3 quadros diários (análises diárias,
// contratos recebidos e efetivações) -- pedido do Matheus na reunião com a
// Patricia de 15/10/2026. Duas leituras, sempre contra o mês anterior na
// mesma régua de dias (mês em andamento contra mês fechado inteiro mostraria
// queda o tempo todo): o dia de hoje contra o mesmo dia do mês anterior, e o
// acumulado do mês até hoje contra o acumulado do mês anterior até o mesmo
// dia.

// Total por dia de um ou mais quadros diários (soma dia a dia quando há mais
// de um, ex: contratos recebidos = mês atual + herdados).
export function totaisPorDia(...quadros: QuadroDiario[]): number[] {
  const n = Math.max(0, ...quadros.map((q) => q.dias.length));
  return Array.from({ length: n }, (_, i) => quadros.reduce((a, q) => a + (q.dias[i]?.total ?? 0), 0));
}

function somaAte(v: number[], dia: number): number {
  let s = 0;
  for (let i = 0; i < Math.min(dia, v.length); i++) s += v[i];
  return s;
}

function Seta({ atual, anterior, contra }: { atual: number; anterior: number; contra: string }) {
  const dif = atual - anterior;
  if (dif === 0) {
    return (
      <span style={{ color: "var(--ink-faint)", fontWeight: 600 }}>
        — igual ({anterior}) {contra}
      </span>
    );
  }
  const subiu = dif > 0;
  const pct = anterior > 0 ? ` (${subiu ? "+" : "−"}${Math.round((Math.abs(dif) / anterior) * 100)}%)` : "";
  return (
    <span style={{ color: subiu ? "var(--info)" : "var(--negative)", fontWeight: 700 }}>
      {subiu ? "▲" : "▼"} {subiu ? "+" : "−"}
      {Math.abs(dif)}
      {pct} <span style={{ fontWeight: 400, color: "var(--ink-muted)" }}>{contra} ({anterior})</span>
    </span>
  );
}

export default function MarcadorTendencia({
  atual,
  anterior,
  ehCompetenciaAtual,
  diaHoje,
  competencia,
  competenciaAnterior,
  rotulo,
}: {
  atual: number[]; // total por dia do mês selecionado (índice 0 = dia 1)
  anterior: number[] | null; // idem do mês anterior (null = sem retrato salvo)
  ehCompetenciaAtual: boolean;
  diaHoje: number; // dia do mês em Brasília (só vale com ehCompetenciaAtual)
  competencia: string; // "YYYY-MM" do mês selecionado
  competenciaAnterior: string; // "YYYY-MM"
  rotulo: string; // ex: "análises", "contratos recebidos"
}) {
  if (!anterior) {
    return (
      <div className={styles.panelSub} style={{ marginBottom: 10 }}>
        Tendência indisponível: não há retrato salvo do mês anterior.
      </div>
    );
  }
  const dia = ehCompetenciaAtual ? Math.min(diaHoje, atual.length) : atual.length;
  const [aaAnt, mmAnt] = competenciaAnterior.split("-");
  const mmAtual = competencia.split("-")[1];
  const diaTxt = String(dia).padStart(2, "0");
  const acumulado = somaAte(atual, dia);
  const acumuladoAnt = somaAte(anterior, dia);

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "4px 22px",
        alignItems: "baseline",
        margin: "0 0 12px",
        padding: "8px 12px",
        borderRadius: 8,
        background: "var(--surface-2)",
        fontSize: 12.5,
      }}
    >
      <span>
        <strong>{ehCompetenciaAtual ? `Acumulado até o dia ${dia}` : "Total do mês"}: {acumulado}</strong>{" "}
        <Seta atual={acumulado} anterior={acumuladoAnt} contra={`vs. mês anterior até o dia ${dia}`} />
      </span>
      {ehCompetenciaAtual && (
        <span>
          <strong>Hoje ({diaTxt}/{mmAtual}, parcial): {atual[dia - 1] ?? 0}</strong>{" "}
          <Seta atual={atual[dia - 1] ?? 0} anterior={anterior[dia - 1] ?? 0} contra={`vs. ${diaTxt}/${mmAnt}`} />
        </span>
      )}
      <InfoLegenda titulo={`Tendência de ${rotulo}`} alinhar="direita">
        Compara com o mês anterior ({mmAnt}/{aaAnt}) usando a mesma régua de dias, para não comparar um mês em andamento com um mês fechado. Acumulado = soma do dia 1 até o dia {dia} deste mês contra a soma do dia 1 até o dia {dia} do mês anterior.
        {ehCompetenciaAtual && " Hoje = o dia de hoje (ainda em andamento, por isso parcial) contra o mesmo dia do mês anterior; fins de semana e feriados costumam ficar em zero dos dois lados."}
      </InfoLegenda>
    </div>
  );
}
