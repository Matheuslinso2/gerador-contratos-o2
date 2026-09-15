"use client";

import { useFormStatus } from "react-dom";

// src/components/SubmitButton.tsx não tem confirmação embutida (é o botão
// simples usado em login/signup/social-media) -- disparo de campanha é
// irreversível uma vez iniciado, então esse botão dedicado pede
// window.confirm() antes de deixar o submit passar.
export function ConfirmarDisparoButton({
  mensagemConfirmacao,
  children,
  className = "",
  textoCarregando = "Disparando...",
}: {
  mensagemConfirmacao: string;
  children: React.ReactNode;
  className?: string;
  textoCarregando?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${className} disabled:cursor-wait disabled:opacity-70`}
      onClick={(e) => {
        if (!window.confirm(mensagemConfirmacao)) e.preventDefault();
      }}
    >
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
