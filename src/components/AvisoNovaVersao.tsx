"use client";

import { useEffect, useState } from "react";

// A cada publicação (deploy) o Next.js troca o código interno dos botões e
// formulários. Quem deixou uma aba aberta antes da publicação e clica depois
// recebe "An unexpected response was received from the server" (visto em
// 14/10/2026, avisos internos). Aqui a página descobre sozinha que o sistema
// foi atualizado e avisa ANTES da pessoa clicar, em vez de falhar depois.
const VERSAO_DESTA_PAGINA = process.env.NEXT_PUBLIC_BUILD_ID ?? "local";
const A_CADA_MS = 2 * 60 * 1000;

export default function AvisoNovaVersao() {
  const [desatualizada, setDesatualizada] = useState(false);

  useEffect(() => {
    // Rodando local (sem id de publicação) não há o que comparar.
    if (VERSAO_DESTA_PAGINA === "local") return;
    let ativo = true;

    async function conferir() {
      try {
        const resposta = await fetch("/api/versao", { cache: "no-store" });
        if (!resposta.ok) return;
        const { id } = (await resposta.json()) as { id?: string };
        if (ativo && id && id !== "local" && id !== VERSAO_DESTA_PAGINA) setDesatualizada(true);
      } catch {
        // sem internet / instabilidade: tenta de novo na próxima
      }
    }

    const timer = setInterval(conferir, A_CADA_MS);
    const aoVoltarParaAba = () => {
      if (document.visibilityState === "visible") conferir();
    };
    document.addEventListener("visibilitychange", aoVoltarParaAba);
    return () => {
      ativo = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", aoVoltarParaAba);
    };
  }, []);

  if (!desatualizada) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3 rounded-xl border border-o2-coral bg-white px-4 py-3 text-sm text-o2-navy shadow-lg print:hidden"
    >
      <span>
        <strong>O sistema foi atualizado.</strong> Se estiver preenchendo algo, copie o que escreveu e recarregue a página antes de continuar.
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-full bg-o2-coral px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
      >
        Recarregar agora
      </button>
    </div>
  );
}
