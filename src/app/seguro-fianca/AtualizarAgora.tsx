"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export default function AtualizarAgora() {
  const router = useRouter();
  const pathname = usePathname();
  const parametros = useSearchParams();
  const [pendente, iniciar] = useTransition();

  // A página usa um retrato salvo de até 10 min; este botão pede a busca ao
  // vivo mandando a hora do clique (ver pediuAtualizacao em page.tsx).
  function atualizar() {
    const novos = new URLSearchParams(parametros.toString());
    novos.set("atualizar", String(Date.now()));
    iniciar(() => router.push(`${pathname}?${novos.toString()}`));
  }

  return (
    <button
      type="button"
      onClick={atualizar}
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
