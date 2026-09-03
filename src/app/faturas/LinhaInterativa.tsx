"use client";

import Link from "next/link";

// A linha do vínculo inteira é um <summary> clicável (abre/fecha o
// dropdown de detalhes). O checkbox de seleção e o link de duplicata
// precisam ficar dentro dela mas SEM abrir o dropdown ao clicar --
// exige onClick, que não pode existir num Server Component, daí esse
// wrapper isolado (a página em si continua sendo Server Component).

export function CheckboxSelecaoLinha({
  imobiliariaId,
}: {
  imobiliariaId: string;
}) {
  return (
    <input
      type="checkbox"
      name="imob"
      value={imobiliariaId}
      defaultChecked
      onClick={(e) => e.stopPropagation()}
    />
  );
}

// Marca/desmarca de uma vez todas as caixinhas "imob" visíveis na página
// (só existem pra quem já está pronto pra envio e tem e-mail cadastrado --
// as outras linhas nem têm checkbox). Com 100+ faturas numa leva, clicar
// uma por uma não é viável.
export function SelecionarTodas() {
  function alternar(e: React.ChangeEvent<HTMLInputElement>) {
    const marcado = e.target.checked;
    document.querySelectorAll<HTMLInputElement>('input[name="imob"]').forEach((cb) => {
      cb.checked = marcado;
    });
  }
  return (
    <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
      <input type="checkbox" onChange={alternar} />
      Selecionar todas
    </label>
  );
}

export function LinkDuplicata({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link href={href} onClick={(e) => e.stopPropagation()} className={className}>
      {children}
    </Link>
  );
}
