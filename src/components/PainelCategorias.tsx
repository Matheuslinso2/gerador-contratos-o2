"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

type Item = {
  href: string;
  titulo: string;
  descricao: string;
  icone: ReactNode;
  pendente?: boolean;
};

type Accent = "navy" | "orange" | "blue" | "gray";

type Categoria = {
  id: string;
  label: string;
  accent: Accent;
  icone: ReactNode;
  itens: Item[];
  restrita?: boolean;
};

const ACCENT_BADGE: Record<Accent, string> = {
  navy: "bg-o2-navy/10 text-o2-navy",
  orange: "bg-o2-coral/10 text-o2-coral",
  blue: "bg-o2-blue/10 text-o2-blue",
  gray: "bg-o2-gray text-gray-600",
};

const ACCENT_DOT: Record<Accent, string> = {
  navy: "bg-o2-navy",
  orange: "bg-o2-coral",
  blue: "bg-o2-blue",
  gray: "bg-gray-500",
};

function Cartao({ item, accent }: { item: Item; accent: Accent }) {
  return (
    <Link
      href={item.href}
      className="flex items-start gap-3 rounded-2xl border border-o2-navy/10 bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl ${ACCENT_BADGE[accent]}`}>
        {item.icone}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-o2-navy">{item.titulo}</span>
          {item.pendente && (
            <span className="flex-none rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-800">
              cadastro pendente
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{item.descricao}</span>
      </span>
    </Link>
  );
}

export default function PainelCategorias({ categorias }: { categorias: Categoria[] }) {
  const [selecionada, setSelecionada] = useState<string>("todos");
  const total = categorias.reduce((soma, c) => soma + c.itens.length, 0);
  const atual = categorias.find((c) => c.id === selecionada);

  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
      <nav className="flex flex-none flex-row gap-1 overflow-x-auto sm:w-52 sm:flex-col sm:overflow-visible">
        <button
          type="button"
          onClick={() => setSelecionada("todos")}
          className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${
            selecionada === "todos" ? "bg-o2-navy text-white" : "text-gray-600 hover:bg-o2-gray/60"
          }`}
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 flex-none" stroke="currentColor" strokeWidth="1.6">
            <rect x="4" y="4" width="6" height="6" rx="1.2" />
            <rect x="14" y="4" width="6" height="6" rx="1.2" />
            <rect x="4" y="14" width="6" height="6" rx="1.2" />
            <rect x="14" y="14" width="6" height="6" rx="1.2" />
          </svg>
          Tudo
          <span
            className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${
              selecionada === "todos" ? "bg-white/20 text-white" : "bg-o2-gray text-gray-500"
            }`}
          >
            {total}
          </span>
        </button>

        <div className="my-1 hidden h-px bg-o2-navy/10 sm:block" />

        {categorias.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setSelecionada(c.id)}
            className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${
              selecionada === c.id ? "bg-o2-navy text-white" : "text-gray-600 hover:bg-o2-gray/60"
            }`}
          >
            <span className="h-4 w-4 flex-none">{c.icone}</span>
            {c.label}
            <span
              className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${
                selecionada === c.id ? "bg-white/20 text-white" : "bg-o2-gray text-gray-500"
              }`}
            >
              {c.itens.length}
            </span>
          </button>
        ))}
      </nav>

      <div className="min-w-0 flex-1">
        {selecionada === "todos" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {categorias.flatMap((c) => c.itens.map((item) => <Cartao key={item.href} item={item} accent={c.accent} />))}
          </div>
        ) : atual ? (
          <>
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              <span className={`h-1.5 w-1.5 rounded-full ${ACCENT_DOT[atual.accent]}`} />
              {atual.label}
              {atual.restrita && <span className="font-normal normal-case text-gray-400">· só admin/colaborador</span>}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {atual.itens.map((item) => (
                <Cartao key={item.href} item={item} accent={atual.accent} />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
