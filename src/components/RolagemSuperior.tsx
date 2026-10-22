"use client";

import { useEffect, useRef, useState } from "react";

// Barra de rolagem horizontal EM CIMA de um quadro largo (pedido do Matheus,
// 22/10/2026): sem ela, para ver as colunas da direita era preciso descer
// até o fim da tabela para achar a barra de baixo. Espelha a rolagem do
// elemento `alvoId` (o container com overflow-x) nos dois sentidos e fica
// grudada no topo da tela enquanto a tabela é lida.
export default function RolagemSuperior({ alvoId }: { alvoId: string }) {
  const barraRef = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(0);
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    const alvo = document.getElementById(alvoId);
    const barra = barraRef.current;
    if (!alvo || !barra) return;

    const medir = () => {
      setLargura(alvo.scrollWidth);
      setVisivel(alvo.scrollWidth > alvo.clientWidth + 1);
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(alvo);
    if (alvo.firstElementChild) observador.observe(alvo.firstElementChild);

    // Só copia quando a posição difere: evita o "eco" (uma rolagem
    // disparando a outra sem parar) sem precisar de trava.
    const doAlvo = () => {
      if (Math.abs(barra.scrollLeft - alvo.scrollLeft) > 1) barra.scrollLeft = alvo.scrollLeft;
    };
    const daBarra = () => {
      if (Math.abs(alvo.scrollLeft - barra.scrollLeft) > 1) alvo.scrollLeft = barra.scrollLeft;
    };
    alvo.addEventListener("scroll", doAlvo, { passive: true });
    barra.addEventListener("scroll", daBarra, { passive: true });
    return () => {
      observador.disconnect();
      alvo.removeEventListener("scroll", doAlvo);
      barra.removeEventListener("scroll", daBarra);
    };
  }, [alvoId]);

  return (
    <div
      ref={barraRef}
      aria-hidden="true"
      data-export-ignore="true"
      className={`sticky top-0 z-10 overflow-x-auto overflow-y-hidden rounded-t-lg bg-white/90 backdrop-blur ${visivel ? "" : "hidden"}`}
    >
      <div style={{ width: largura, height: 12 }} />
    </div>
  );
}
