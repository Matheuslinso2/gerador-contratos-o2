"use client";

import { useFormStatus } from "react-dom";

// Botão de formulário (Server Action) que avisa visualmente que o clique
// registrou — sem isso, uma ação que demora alguns segundos (gerar post com
// IA, por exemplo) parece não ter feito nada até o resultado aparecer.
export default function SubmitButton({
  children,
  textoCarregando = "Carregando…",
  className = "",
}: {
  children: React.ReactNode;
  textoCarregando?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={`${className} disabled:cursor-wait disabled:opacity-70`}>
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {textoCarregando}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
