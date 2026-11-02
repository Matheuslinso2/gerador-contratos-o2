"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CADASTROS, ETAPAS } from "@/lib/erp/processo";

// Menu do ERP O2 — aplicativo à parte do Workspace (Matheus 25/10), organizado pela lógica do processo, da esquerda
// para a direita (26/10). Guia de estilo (03/11/2026): no máximo 7 itens visíveis. As 9 etapas ficam agrupadas por fase
// (Entrada · Carteira · Dinheiro), Sinistro leva ao Workspace e os cadastros ficam num grupo à direita. Etapas ainda não
// construídas aparecem apagadas ("em breve"). A numeração das etapas (1 a 9) não muda.
const GRUPOS = [
  { chave: "entrada", rotulo: "Entrada", etapas: ["emissao", "faturas", "envio"] },
  { chave: "carteira", rotulo: "Carteira", etapas: ["apolices", "parcelas", "renovacao"] },
  { chave: "dinheiro", rotulo: "Dinheiro", etapas: ["baixa", "repasses"], nibo: true },
];

type Item = { chave: string; href: string | null; rotulo: string; numero?: number; externo?: boolean; ativo: boolean; descricao?: string };

const classe = (on: boolean) =>
  `whitespace-nowrap border-b-2 px-0.5 py-2.5 text-sm font-medium transition ${on ? "border-o2-coral text-white" : "border-transparent text-white/60 hover:text-white"}`;

function Grupo({ rotulo, itens, direita = false }: { rotulo: string; itens: Item[]; direita?: boolean }) {
  const algumAtivo = itens.some((i) => i.ativo);
  return (
    <div className="group relative">
      <button type="button" className={classe(algumAtivo)} aria-haspopup="true">
        {rotulo} <span className="text-xs text-white/40">▾</span>
      </button>
      <div
        className={`invisible absolute ${direita ? "right-0" : "left-0"} top-full z-30 min-w-52 rounded-lg border border-white/10 bg-o2-navy py-1 opacity-0 shadow-lg transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100`}
      >
        {itens.map((i) =>
          i.href ? (
            <Link key={i.chave} href={i.href} target={i.externo ? "_blank" : undefined} title={i.descricao} className={`block px-4 py-2 text-sm ${i.ativo ? "bg-white/10 font-semibold text-white" : "text-white/70 hover:bg-white/5 hover:text-white"}`}>
              {i.numero ? <span className="mr-2 text-white/40">{i.numero}</span> : null}
              {i.rotulo}
              {i.externo ? " ↗" : ""}
            </Link>
          ) : (
            <span key={i.chave} title={i.descricao} className="block cursor-default px-4 py-2 text-sm text-white/30">
              <span className="mr-2">{i.numero}</span>
              {i.rotulo} <span className="text-xs">(em breve)</span>
            </span>
          )
        )}
      </div>
    </div>
  );
}

export default function ErpNav({ mostrarBaixa = true, mostrarNibo = false }: { mostrarBaixa?: boolean; mostrarNibo?: boolean }) {
  const pathname = usePathname();
  const ativo = (href: string, rotas: string[] = []) => [href, ...rotas].some((r) => pathname === r || pathname.startsWith(r + "/"));
  const etapaDe = (chave: string) => ETAPAS.findIndex((e) => e.chave === chave);

  const itensDoGrupo = (g: (typeof GRUPOS)[number]): Item[] => {
    const itens: Item[] = g.etapas
      .filter((c) => mostrarBaixa || c !== "baixa")
      .map((c) => {
        const i = etapaDe(c);
        const e = ETAPAS[i];
        return { chave: c, href: e.href, rotulo: e.curto, numero: i + 1, externo: e.externo, ativo: !!e.href && !e.externo && ativo(e.href, e.rotas), descricao: e.descricao };
      });
    if (g.nibo && mostrarNibo) itens.push({ chave: "nibo", href: "/erp/nibo", rotulo: "Nibo", ativo: ativo("/erp/nibo"), descricao: "Espelho do Painel de Acompanhamento do Nibo (as duas empresas e o consolidado)" });
    return itens;
  };

  const sinistro = ETAPAS[etapaDe("sinistro")];
  const cadastros: Item[] = CADASTROS.map((c) => ({ chave: c.href, href: c.href, rotulo: c.label, ativo: ativo(c.href) }));

  return (
    <nav className="flex flex-wrap items-center gap-x-6">
      <Link href="/erp" className={classe(pathname === "/erp")}>
        Início
      </Link>
      {GRUPOS.map((g) => (
        <Grupo key={g.chave} rotulo={g.rotulo} itens={itensDoGrupo(g)} />
      ))}
      {sinistro?.href ? (
        <Link href={sinistro.href} target="_blank" title={sinistro.descricao} className={classe(false)}>
          <span className="mr-1 text-white/40">{etapaDe("sinistro") + 1}</span>
          {sinistro.curto} ↗
        </Link>
      ) : null}
      <div className="ml-auto">
        <Grupo rotulo="Cadastros" itens={cadastros} direita />
      </div>
    </nav>
  );
}
