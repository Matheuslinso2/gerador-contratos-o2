"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

// Cobre falhas no layout raiz (fora do alcance do error.tsx normal).
// Precisa definir <html>/<body> porque substitui o layout inteiro quando ativo.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <main style={{ display: "flex", flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem", padding: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Algo deu errado</h1>
          <p style={{ fontSize: "0.875rem", color: "#4b5563" }}>
            {error.message || "Ocorreu um erro inesperado. Tente novamente."}
          </p>
          <button
            onClick={() => reset()}
            style={{ borderRadius: "9999px", background: "#ff6b57", padding: "0.625rem 1.5rem", fontWeight: 500, color: "#fff" }}
          >
            Tentar novamente
          </button>
        </main>
      </body>
    </html>
  );
}
