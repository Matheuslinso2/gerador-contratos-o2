// Layout único das telas do ERP O2 (Matheus, 03/11/2026: "o ERP tem que ter um layout único", independente do Corp e do Nibo).
// Toda tela do ERP usa PaginaErp (largura, margem e espaçamento) e TituloErp (título + legenda + ações). Padrões:
//  - largura 1200 px, margem lateral e vertical p-8, blocos separados por space-y-6; "formulario" (720 px) só para cadastros curtos;
//  - título em text-xl semibold navy; subtítulo em text-xs cinza; legenda ⓘ via InfoLegenda ao lado do título;
//  - período: <NavegadorMes> (mês corrente por padrão; setas de mês e ano) — nunca navegador próprio;
//  - filtros e sub-abas: pílulas (rounded-full border px-3 py-1 text-xs; ativa = border-o2-navy bg-o2-navy text-white);
//  - quadros e tabelas dentro de <CartaoErp> (rounded-xl border border-gray-200 bg-white); KPI em <KpiErp>.
import type { ReactNode } from "react";

export default function PaginaErp({ children, largura = "padrao" }: { children: ReactNode; largura?: "padrao" | "formulario" }) {
  return <main className={`mx-auto w-full ${largura === "formulario" ? "max-w-[720px]" : "max-w-[1200px]"} flex-1 space-y-6 p-8`}>{children}</main>;
}

export function TituloErp({ titulo, subtitulo, acoes, legenda }: { titulo: ReactNode; subtitulo?: ReactNode; acoes?: ReactNode; legenda?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-o2-navy">
          {titulo}
          {legenda}
        </h1>
        {subtitulo ? <p className="mt-0.5 text-xs text-gray-500">{subtitulo}</p> : null}
      </div>
      {acoes ? <div className="flex items-center gap-2">{acoes}</div> : null}
    </div>
  );
}

export function CartaoErp({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-gray-200 bg-white ${className}`}>{children}</section>;
}

export function KpiErp({ nome, valor, detalhe, negativo }: { nome: string; valor: ReactNode; detalhe?: ReactNode; negativo?: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{nome}</p>
      <p className={`text-lg font-semibold ${negativo ? "text-red-600" : "text-o2-navy"}`}>{valor}</p>
      {detalhe ? <p className="text-[11px] text-gray-500">{detalhe}</p> : null}
    </div>
  );
}
