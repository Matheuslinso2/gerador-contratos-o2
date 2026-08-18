"use client";

import { useState } from "react";

const O2_LARANJA = "#F8540D";
const O2_NAVY = "#01192e";
const O2_VERDE_OK = "#2e7d4f";

// Mostrado só pra quem está logado (colaborador da O2 vendo a própria
// landing page pública por dentro do Workspace) -- ajuda a pegar o link
// certo pra compartilhar sem precisar digitar/lembrar a URL. Some sozinho
// pro visitante real (a página nem renderiza esse componente nesse caso).
export default function LinkPublicoCompartilhavel({ path }: { path: string }) {
  const [copiado, setCopiado] = useState(false);
  const url = typeof window !== "undefined" ? `${window.location.origin}${path}` : path;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Clipboard API pode falhar (sem permissão, contexto não seguro) --
      // o link já está visível no texto, então dá pra copiar na mão.
    }
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      style={{ background: "#FFF4EE", border: "1px solid #FCD9C4" }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
          style={{ background: O2_LARANJA }}
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
            <path d="M10 14l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path
              d="M11.5 6.5l1-1a3.6 3.6 0 015 5l-1 1"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M12.5 17.5l-1 1a3.6 3.6 0 01-5-5l1-1"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold" style={{ color: O2_NAVY }}>
            Link público desta ficha — sem login, pode compartilhar
          </p>
          <p className="truncate text-xs text-gray-500">{url}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={copiar}
        className="flex shrink-0 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
        style={{ background: copiado ? O2_VERDE_OK : O2_LARANJA }}
      >
        {copiado ? (
          <>
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
              <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Copiado
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
              <rect x="8.5" y="8.5" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
              <path d="M5.5 14.5v-8a2 2 0 012-2h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Copiar link
          </>
        )}
      </button>
    </div>
  );
}
