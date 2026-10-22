"use client";

import { useState } from "react";

// Colunas mês a mês (empilhadas quando há mais de uma série). Cores
// validadas com o validador da skill dataviz (azul #2E6FB7 + laranja O2
// #F8540D passam em todas as checagens, inclusive daltonismo); um eixo só;
// barra fina (≤ 24px) com ponta arredondada e 2px de folga entre segmentos;
// valor no hover em vez de número em cada barra.
export type SerieBarra = { chave: string; rotulo: string; cor: string };
export type PontoBarra = { mes: string; valores: Record<string, number> };

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (m: string) => {
  const [a, mm] = m.split("-");
  return `${MESES[Number(mm) - 1]}/${a.slice(2)}`;
};

export default function BarrasMensais({
  pontos,
  series,
  formato = "numero",
  altura = 150,
}: {
  pontos: PontoBarra[];
  series: SerieBarra[];
  formato?: "numero" | "reais";
  altura?: number;
}) {
  const formatar = (v: number) =>
    formato === "reais" ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : v.toLocaleString("pt-BR");
  const [foco, setFoco] = useState<number | null>(null);
  const largura = 380;
  const margem = { topo: 10, dir: 16, base: 22, esq: 16 };
  const areaH = altura - margem.topo - margem.base;
  const banda = (largura - margem.esq - margem.dir) / pontos.length;
  const barra = Math.min(12, banda * 0.6);
  const total = (p: PontoBarra) => series.reduce((t, s) => t + (p.valores[s.chave] ?? 0), 0);
  const max = Math.max(1, ...pontos.map(total));
  const escala = (v: number) => (v / max) * areaH;
  const base = margem.topo + areaH;

  return (
    <div className="relative">
      {/* Só para o Excel do quadro (ExportarEste); não aparece na tela. */}
      <table hidden data-export-tabela="Por mês">
        <tbody>
          <tr>
            <th>Mês</th>
            {series.map((s) => (
              <th key={s.chave}>{s.rotulo}</th>
            ))}
            {series.length > 1 && <th>Total</th>}
          </tr>
          {pontos.map((p) => (
            <tr key={p.mes}>
              <td>{rotuloMes(p.mes)}</td>
              {series.map((s) => (
                <td key={s.chave}>{formatar(p.valores[s.chave] ?? 0)}</td>
              ))}
              {series.length > 1 && <td>{formatar(total(p))}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {series.length > 1 && (
        <div className="mb-1 flex gap-4 text-xs text-gray-600">
          {series.map((s) => (
            <span key={s.chave} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.cor }} />
              {s.rotulo}
            </span>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${largura} ${altura}`} className="w-full" role="img" onMouseLeave={() => setFoco(null)}>
        <line x1={margem.esq} x2={largura - margem.dir} y1={base} y2={base} stroke="#e5e7eb" strokeWidth={1} />
        {pontos.map((p, i) => {
          const cx = margem.esq + banda * i + banda / 2;
          let topo = base;
          const segs = series.map((s, si) => {
            const v = p.valores[s.chave] ?? 0;
            const h = escala(v);
            const ultimo = series.slice(si + 1).every((x) => (p.valores[x.chave] ?? 0) === 0);
            const y = topo - h;
            // Folga de 2px entre segmentos empilhados.
            const hDesenho = Math.max(0, h - (si > 0 && h > 0 ? 2 : 0));
            topo = y;
            if (h <= 0) return null;
            const r = ultimo ? Math.min(4, hDesenho / 2, barra / 2) : 0;
            const x0 = cx - barra / 2;
            const caminho = r
              ? `M${x0},${y + hDesenho} V${y + r} Q${x0},${y} ${x0 + r},${y} H${x0 + barra - r} Q${x0 + barra},${y} ${x0 + barra},${y + r} V${y + hDesenho} Z`
              : `M${x0},${y + hDesenho} V${y} H${x0 + barra} V${y + hDesenho} Z`;
            return <path key={s.chave} d={caminho} fill={s.cor} opacity={foco === null || foco === i ? 1 : 0.45} />;
          });
          return (
            <g key={p.mes}>
              {segs}
              {(pontos.length - 1 - i) % (pontos.length <= 8 ? 1 : pontos.length <= 18 ? 2 : pontos.length <= 36 ? 3 : Math.ceil(pontos.length / 12)) === 0 && (
                <text x={cx} y={altura - 6} textAnchor="middle" fontSize={10} fill="#6b7280">
                  {rotuloMes(p.mes)}
                </text>
              )}
              {/* Área de hover maior que a barra. */}
              <rect
                x={cx - banda / 2}
                y={margem.topo}
                width={banda}
                height={areaH}
                fill="transparent"
                onMouseEnter={() => setFoco(i)}
                onFocus={() => setFoco(i)}
                tabIndex={0}
                aria-label={`${rotuloMes(p.mes)}: ${series.map((s) => `${s.rotulo} ${formatar(p.valores[s.chave] ?? 0)}`).join(", ")}`}
              />
            </g>
          );
        })}
      </svg>
      {foco !== null && (
        <div
          className="pointer-events-none absolute top-6 z-10 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow"
          style={{ left: `min(calc(${((foco + 0.5) / pontos.length) * 100}% + 8px), calc(100% - 170px))` }}
        >
          <p className="font-semibold text-o2-navy">{rotuloMes(pontos[foco].mes)}</p>
          {series.map((s) => (
            <p key={s.chave} className="flex items-center gap-1.5 text-gray-700">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.cor }} />
              {s.rotulo}: <b>{formatar(pontos[foco].valores[s.chave] ?? 0)}</b>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
