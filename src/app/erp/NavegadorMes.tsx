import Link from "next/link";
import { periodoDoMes } from "@/lib/erp/periodo";

// Navegação de período padrão do ERP: abre sempre no mês corrente; setas de mês e de ano; "Mês atual" volta.
// Mantém os demais filtros da URL (só troca ?mes=).
export default function NavegadorMes({ caminho, mes, params = {} }: { caminho: string; mes?: string | null; params?: Record<string, string | undefined> }) {
  const p = periodoDoMes(mes);
  const href = (m: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "mes") q.set(k, v);
    if (m !== p.mesAtual) q.set("mes", m);
    const s = q.toString();
    return s ? `${caminho}?${s}` : caminho;
  };
  const botao = "rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-o2-navy hover:bg-gray-50";
  return (
    <nav aria-label="Período" className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm">
      <Link href={href(p.anoAnterior)} className={botao} title="Mesmo mês, ano anterior">«</Link>
      <Link href={href(p.anterior)} className={botao} title="Mês anterior">‹</Link>
      <span className="min-w-40 text-center text-sm font-semibold capitalize text-o2-navy">{p.rotulo}</span>
      <Link href={href(p.proximo)} className={botao} title="Próximo mês">›</Link>
      <Link href={href(p.anoProximo)} className={botao} title="Mesmo mês, ano seguinte">»</Link>
      {!p.ehMesAtual && (
        <Link href={href(p.mesAtual)} className="rounded-md bg-o2-navy px-3 py-1 text-sm font-medium text-white hover:bg-o2-indigo">Mês atual</Link>
      )}
      <span className="ml-auto text-[11px] text-gray-500">
        {p.ehMesAtual ? "Mês aberto: os números se atualizam durante o mês." : p.fechado ? "Mês fechado: números congelados no retrato do fechamento." : "Mês futuro."}
      </span>
    </nav>
  );
}
