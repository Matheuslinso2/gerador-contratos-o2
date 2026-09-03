"use client";

import { useState } from "react";
import { IconSpinner } from "./icons";

// Botão de submit com sinalização de carregando. Usa estado local (não
// useFormStatus) de propósito -- precisa funcionar tanto em forms de
// Server Action quanto em forms de navegação comum (action="/algum/caminho",
// ex: o filtro), onde useFormStatus não detecta o "pending". Todo destino
// dessas ações sempre termina em redirect() (mesmo nos caminhos de erro),
// então a página troca inteira em seguida -- não fica travado clicado pra
// sempre.
export function SubmitButton({
  children,
  textoCarregando = "Enviando...",
  className,
  disabled,
}: {
  children: React.ReactNode;
  textoCarregando?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [clicado, setClicado] = useState(false);
  return (
    <button
      type="submit"
      disabled={disabled || clicado}
      onClick={() => setClicado(true)}
      className={className}
    >
      {clicado ? (
        <span className="inline-flex items-center gap-1.5">
          <IconSpinner className="h-3.5 w-3.5" />
          {textoCarregando}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
