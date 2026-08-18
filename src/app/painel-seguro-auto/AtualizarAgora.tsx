"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export default function AtualizarAgora() {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();

  return (
    <button
      type="button"
      onClick={() => iniciar(() => router.refresh())}
      disabled={pendente}
      style={{
        background: "none",
        border: "1px solid var(--line)",
        color: "var(--accent-ink)",
        borderRadius: 6,
        padding: "6px 12px",
        fontSize: 12.5,
        cursor: pendente ? "default" : "pointer",
        opacity: pendente ? 0.6 : 1,
      }}
    >
      {pendente ? "Atualizando…" : "Atualizar agora"}
    </button>
  );
}
