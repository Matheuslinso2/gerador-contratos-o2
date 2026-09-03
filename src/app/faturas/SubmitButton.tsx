"use client";

import { useState } from "react";
import { IconSpinner } from "./icons";

// Botão de submit com sinalização de carregando. Usa estado local (não
// useFormStatus) de propósito -- precisa funcionar tanto em forms de
// Server Action quanto em forms de navegação comum (action="/algum/caminho",
// ex: o filtro), onde useFormStatus não detecta o "pending".
//
// Importante: NUNCA usar o atributo `disabled` nativo pra sinalizar "já
// cliquei" -- alguns navegadores cancelam o próprio submit em andamento se
// o botão que disparou vira disabled ainda dentro do mesmo evento de
// clique (foi exatamente isso que travou a tela em "Abrindo prévia..." sem
// navegar pra lugar nenhum). Em vez disso, só bloqueia clique repetido via
// onClick + pointer-events-none visual -- o primeiro clique sempre chega
// intacto no navegador pra disparar o submit de verdade.
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
      disabled={disabled}
      aria-disabled={clicado}
      onClick={(e) => {
        if (clicado) {
          e.preventDefault();
          return;
        }
        setClicado(true);
      }}
      className={`${className ?? ""} ${clicado ? "pointer-events-none opacity-70" : ""}`}
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
