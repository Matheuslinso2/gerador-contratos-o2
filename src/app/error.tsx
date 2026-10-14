"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

// Mensagem genérica que o Next mostra quando um botão/formulário (server action)
// recebe do servidor algo que não é a resposta esperada: página aberta há muito
// tempo e o sistema foi atualizado nesse meio-tempo, sessão (login) vencida, ou
// arquivo grande demais. Nos 3 casos a saída é recarregar -- diz isso em vez
// de só repetir a mensagem em inglês.
const RESPOSTA_INESPERADA = /unexpected response was received from the server/i;

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
    fetch("/api/erro-cliente", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mensagem: RESPOSTA_INESPERADA.test(error.message)
          ? `${error.message} (página aberta há ${Math.round(performance.now() / 60000)} min; ${navigator.onLine ? "com" : "SEM"} internet)`
          : error.message,
        digest: error.digest,
        url: window.location.href,
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold text-o2-navy">Algo deu errado</h1>
      <p className="text-sm text-gray-600">
        {RESPOSTA_INESPERADA.test(error.message)
          ? "A página ficou aberta por muito tempo (ou o sistema foi atualizado) e não conseguiu concluir a ação. Recarregue a página, entre de novo se pedir, e refaça. Se o problema repetir com um arquivo ou imagem grande, use um menor."
          : error.message || "Ocorreu um erro inesperado. Tente novamente."}
      </p>
      <div className="flex gap-3">
        <button
          onClick={() => (RESPOSTA_INESPERADA.test(error.message) ? window.location.reload() : reset())}
          className="rounded-full bg-o2-coral px-6 py-2.5 font-medium text-white transition hover:opacity-90"
        >
          {RESPOSTA_INESPERADA.test(error.message) ? "Recarregar a página" : "Tentar novamente"}
        </button>
        <Link
          href="/"
          className="rounded-full border border-o2-navy px-6 py-2.5 font-medium text-o2-navy transition hover:bg-gray-50"
        >
          Voltar para o início
        </Link>
      </div>
    </main>
  );
}
