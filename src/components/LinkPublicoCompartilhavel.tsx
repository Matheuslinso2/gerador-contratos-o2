"use client";

import { useState } from "react";

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
      // o link já está visível e selecionável no texto, então a pessoa
      // ainda consegue copiar manualmente mesmo se isso não funcionar.
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-xs text-gray-600">
      <p className="font-medium text-gray-700">Link público desta ficha (sem login) — compartilhe com quem precisar:</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <code className="flex-1 break-all rounded bg-white px-2 py-1 text-gray-800">{url}</code>
        <button
          type="button"
          onClick={copiar}
          className="shrink-0 rounded-full border border-gray-300 px-3 py-1 font-medium text-gray-700 transition hover:bg-white"
        >
          {copiado ? "Copiado! ✅" : "Copiar link"}
        </button>
      </div>
    </div>
  );
}
