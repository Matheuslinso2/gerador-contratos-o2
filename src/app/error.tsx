"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    fetch("/api/erro-cliente", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mensagem: error.message,
        digest: error.digest,
        url: window.location.href,
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold text-o2-navy">Algo deu errado</h1>
      <p className="text-sm text-gray-600">
        {error.message || "Ocorreu um erro inesperado. Tente novamente."}
      </p>
      <div className="flex gap-3">
        <button
          onClick={() => reset()}
          className="rounded-full bg-o2-coral px-6 py-2.5 font-medium text-white transition hover:opacity-90"
        >
          Tentar novamente
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
