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
