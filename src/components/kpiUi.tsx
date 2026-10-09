// Peças visuais dos cartões de KPI (usadas pelo "Produção do mês" e pelo
// "Operação e marketing do mês" da página inicial).

const decimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export type Tom = "bom" | "ruim" | "neutro";

const TOM_CLASSE: Record<Tom, string> = {
  bom: "bg-green-50 text-green-700",
  ruim: "bg-red-50 text-red-700",
  neutro: "bg-gray-100 text-o2-cinza-escuro",
};

export function Variacao({ texto, tom }: { texto: string; tom: Tom }) {
  return <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${TOM_CLASSE[tom]}`}>{texto}</span>;
}

// Variação percentual do RITMO por dia (mês atual ainda está em andamento,
// então comparar o total cru com o mês fechado enganaria).
export function variacaoRitmo(atual: number, anterior: number): { texto: string; tom: Tom } {
  if (anterior === 0) return atual === 0 ? { texto: "sem variação", tom: "neutro" } : { texto: "sem base no mês anterior", tom: "neutro" };
  const v = (atual / anterior - 1) * 100;
  if (Math.abs(v) < 2) return { texto: `${v >= 0 ? "+" : "−"}${decimal.format(Math.abs(v))}% no ritmo`, tom: "neutro" };
  return { texto: `${v > 0 ? "+" : "−"}${decimal.format(Math.abs(v))}% no ritmo`, tom: v > 0 ? "bom" : "ruim" };
}

export function Cartao({ rotulo, valor, linhas, variacao }: { rotulo: string; valor: string; linhas: string[]; variacao?: { texto: string; tom: Tom } }) {
  return (
    <div className="rounded-xl bg-gray-50 p-4">
      <div className="text-xs text-o2-cinza-medio">{rotulo}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-o2-navy">{valor}</div>
      <div className="mt-1 space-y-0.5 text-[11.5px] leading-snug text-o2-cinza-medio">
        {linhas.map((l) => (
          <div key={l}>{l}</div>
        ))}
      </div>
      {variacao && <Variacao {...variacao} />}
    </div>
  );
}

