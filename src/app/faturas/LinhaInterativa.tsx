"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconSpinner } from "@/components/icons";

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

// Achado real (POTTENCIAL, ~50 imobiliárias pendentes numa aba só): o
// formulário grande de "Enviar selecionadas" engloba a lista inteira,
// inclusive os botões de lixeira (excluir boleto/demonstrativo) de cada
// linha, que usam `formAction` (Server Action) pra não precisar de um
// <form> aninhado. O Next injeta, pra CADA um desses botões, um campo
// escondido com a referência codificada da ação ($ACTION_N). Como tudo
// fica dentro do mesmo <form>, o envio nativo (navegação por URL) desse
// botão varria TODOS os campos do formulário -- inclusive os dezenas de
// campos escondidos dos botões de lixeira de TODAS as outras linhas --
// gerando uma URL de dezenas de KB que travou a tela (timeout de 60s no
// /faturas/enviar/confirmar, visto em produção).
//
// Corrigido lendo as caixinhas marcadas em JS e navegando direto, sem
// depender da varredura nativa do formulário -- os botões de lixeira
// continuam funcionando exatamente como antes (formAction, sem mudança).
export function EnviarSelecionadasButton({
  hrefBase,
  disabled,
  className,
  children,
  textoCarregando = "Abrindo prévia...",
}: {
  /** URL até o "?", já com seguradora/competencia -- os "imob" e
   * "modo_teste" são acrescentados aqui na hora do clique. */
  hrefBase: string;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
  textoCarregando?: string;
}) {
  const router = useRouter();
  const [carregando, setCarregando] = useState(false);

  function aoClicar() {
    if (carregando) return;
    const marcadas = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="imob"]:checked')
    ).map((el) => el.value);
    if (!marcadas.length) return;
    const modoTeste = document.querySelector<HTMLInputElement>('input[name="modo_teste"]')?.checked;

    const params = new URLSearchParams();
    for (const id of marcadas) params.append("imob", id);
    if (modoTeste) params.set("modo_teste", "1");

    setCarregando(true);
    router.push(`${hrefBase}&${params.toString()}`);
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={aoClicar}
      className={`${className ?? ""} ${carregando ? "pointer-events-none opacity-70" : ""}`}
    >
      {carregando ? (
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
