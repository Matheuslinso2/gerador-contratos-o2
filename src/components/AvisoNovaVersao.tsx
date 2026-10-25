"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

// A cada publicação (deploy) o Next.js troca o código interno dos botões e
// formulários. Quem deixou uma aba aberta antes da publicação e clica depois
// pode receber "An unexpected response was received from the server" (visto
// em 14/10/2026, avisos internos).
//
// Até 25/10/2026 isso virava um aviso fixo na tela assim que saía versão nova
// -- e atrapalhava quem estava no meio de uma tarefa (pedido do Matheus).
// Agora a conferência é silenciosa:
// - ao trocar de página (link ou navegação interna), a página nova é
//   carregada inteira, já na versão nova -- ninguém precisa fazer nada;
// - o aviso só aparece se algo FALHAR por causa da versão antiga (ex.: salvar
//   um formulário), pedindo para recarregar e tentar de novo.
const VERSAO_DESTA_PAGINA = process.env.NEXT_PUBLIC_BUILD_ID ?? "local";
const A_CADA_MS = 2 * 60 * 1000;

// Erros que o Next.js dá quando a aba está numa versão que não existe mais.
const ERRO_DE_VERSAO = /unexpected response was received from the server|Failed to find Server Action|ChunkLoadError|Loading chunk .* failed/i;

export default function AvisoNovaVersao() {
  const desatualizada = useRef(false);
  const [falhou, setFalhou] = useState(false);
  const pathname = usePathname();
  const caminhoInicial = useRef(pathname);

  // Conferência em segundo plano (sem mostrar nada).
  useEffect(() => {
    // Rodando local (sem id de publicação) não há o que comparar.
    if (VERSAO_DESTA_PAGINA === "local") return;
    let ativo = true;

    async function conferir() {
      if (desatualizada.current) return;
      try {
        const resposta = await fetch("/api/versao", { cache: "no-store" });
        if (!resposta.ok) return;
        const { id } = (await resposta.json()) as { id?: string };
        if (ativo && id && id !== "local" && id !== VERSAO_DESTA_PAGINA) desatualizada.current = true;
      } catch {
        // sem internet / instabilidade: tenta de novo na próxima
      }
    }

    // Clique num link interno com a versão antiga: abre a página nova
    // carregando tudo de novo (em vez da navegação interna do Next).
    function aoClicar(e: MouseEvent) {
      if (!desatualizada.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const destino = new URL(link.href, window.location.href);
      if (destino.origin !== window.location.origin) return;
      if (destino.pathname === window.location.pathname && destino.search === window.location.search) return; // só âncora (#)
      e.preventDefault();
      e.stopPropagation();
      window.location.assign(destino.href);
    }

    // Falha causada pela versão antiga (ex.: salvar formulário): aí sim avisa.
    function aoFalhar(motivo: unknown) {
      const texto = motivo instanceof Error ? `${motivo.name} ${motivo.message}` : String(motivo ?? "");
      if (ERRO_DE_VERSAO.test(texto)) setFalhou(true);
    }
    const aoErro = (e: ErrorEvent) => aoFalhar(e.error ?? e.message);
    const aoRejeitar = (e: PromiseRejectionEvent) => aoFalhar(e.reason);

    const timer = setInterval(conferir, A_CADA_MS);
    const aoVoltarParaAba = () => {
      if (document.visibilityState === "visible") conferir();
    };
    document.addEventListener("visibilitychange", aoVoltarParaAba);
    document.addEventListener("click", aoClicar, true);
    window.addEventListener("error", aoErro);
    window.addEventListener("unhandledrejection", aoRejeitar);
    return () => {
      ativo = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", aoVoltarParaAba);
      document.removeEventListener("click", aoClicar, true);
      window.removeEventListener("error", aoErro);
      window.removeEventListener("unhandledrejection", aoRejeitar);
    };
  }, []);

  // Navegação interna que não passou por um link (ex.: botão que muda de
  // página): já desatualizada, recarrega a página nova inteira.
  useEffect(() => {
    if (pathname !== caminhoInicial.current && desatualizada.current) window.location.reload();
    caminhoInicial.current = pathname;
  }, [pathname]);

  if (!falhou) return null;

  return (
    <div
      role="alert"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3 rounded-xl border border-o2-coral bg-white px-4 py-3 text-sm text-o2-navy shadow-lg print:hidden"
    >
      <span>
        <strong>O sistema foi atualizado e não conseguiu concluir esta ação.</strong> Copie o que escreveu, recarregue a página e tente de novo.
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
