"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CADASTROS, ETAPAS } from "@/lib/erp/processo";

// Menu do ERP O2 — aplicativo à parte do Workspace (Matheus 25/10) organizado pela lógica do processo, da esquerda
// para a direita (26/10). Etapas ainda não construídas aparecem apagadas ("em breve"); Cadastros à direita.
export default function ErpNav({ mostrarBaixa = true }: { mostrarBaixa?: boolean }) {
  const pathname = usePathname();
  const ativo = (href: string, rotas: string[] = []) => [href, ...rotas].some((r) => pathname === r || pathname.startsWith(r + "/"));
  const classe = (on: boolean) =>
    `whitespace-nowrap border-b-2 px-0.5 py-2.5 text-[13px] font-medium transition ${on ? "border-o2-coral text-white" : "border-transparent text-white/60 hover:text-white"}`;
  return (
    <nav className="flex items-center gap-3 overflow-x-auto">
      <Link href="/erp" className={classe(pathname === "/erp")}>
        Início
      </Link>
      <span className="text-white/20">|</span>
      {ETAPAS.map((e, i) =>
        !mostrarBaixa && e.chave === "baixa" ? null : e.href ? (
          <Link key={e.chave} href={e.href} target={e.externo ? "_blank" : undefined} className={classe(!e.externo && ativo(e.href, e.rotas))} title={e.descricao}>
            <span className="mr-1 text-white/40">{i + 1}</span>
            {e.curto}
            {e.externo ? " ↗" : ""}
          </Link>
        ) : (
          <span key={e.chave} className="cursor-default whitespace-nowrap px-0.5 py-2.5 text-[13px] text-white/30" title={e.descricao}>
            <span className="mr-1">{i + 1}</span>
            {e.curto}
          </span>
        )
      )}
      <span className="ml-auto text-white/20">|</span>
      {CADASTROS.map((c) => (
        <Link key={c.href} href={c.href} className={classe(ativo(c.href))}>
          {c.label}
        </Link>
      ))}
    </nav>
  );
}
