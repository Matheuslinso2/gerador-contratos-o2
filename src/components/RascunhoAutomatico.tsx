"use client";

import { useEffect, useRef, useState } from "react";

// Rascunho automático das fichas (pedido do Matheus, 25/10/2026). Enquanto a
// pessoa preenche, o navegador guarda uma cópia do que foi digitado (só no
// computador dela -- nada vai para o servidor). Se o envio falhar (ex.:
// sistema atualizado com a página aberta, internet caiu) ou a aba fechar, ao
// abrir a ficha de novo ela volta preenchida. O rascunho é apagado quando o
// envio dá certo (limparRascunho, chamado na tela de "enviada com sucesso")
// ou depois de DIAS_VALIDADE dias.
//
// Uso: <RascunhoAutomatico chave="ficha-fianca" /> como primeiro filho do
// <form>. Anexos (arquivos) não podem ser guardados pelo navegador: a pessoa
// escolhe de novo.

const DIAS_VALIDADE = 3;
const prefixo = (chave: string) => `rascunho:${chave}`;

type Valor = string | string[];
type Rascunho = { salvoEm: number; campos: Record<string, Valor> };

export function limparRascunho(chave: string) {
  try {
    window.localStorage.removeItem(prefixo(chave));
  } catch {
    // navegador sem armazenamento (modo privado restrito): nada a limpar
  }
}

function ler(chave: string): Rascunho | null {
  try {
    const bruto = window.localStorage.getItem(prefixo(chave));
    if (!bruto) return null;
    const r = JSON.parse(bruto) as Rascunho;
    if (!r?.campos || Date.now() - r.salvoEm > DIAS_VALIDADE * 86_400_000) {
      window.localStorage.removeItem(prefixo(chave));
      return null;
    }
    return Object.keys(r.campos).length ? r : null;
  } catch {
    return null;
  }
}

type Campo = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const IGNORAR = new Set(["file", "hidden", "password", "submit", "button", "reset", "image"]);

function camposDo(form: HTMLFormElement): Campo[] {
  return [...form.elements].filter(
    (el): el is Campo =>
      (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) &&
      !!el.name &&
      !(el instanceof HTMLInputElement && IGNORAR.has(el.type))
  );
}

function serializar(form: HTMLFormElement): Record<string, Valor> {
  const campos: Record<string, Valor> = {};
  for (const el of camposDo(form)) {
    if (el instanceof HTMLInputElement && el.type === "checkbox") {
      const lista = (campos[el.name] as string[] | undefined) ?? [];
      if (el.checked) lista.push(el.value);
      campos[el.name] = lista;
    } else if (el instanceof HTMLInputElement && el.type === "radio") {
      if (el.checked) campos[el.name] = el.value;
    } else if (el instanceof HTMLSelectElement && el.multiple) {
      campos[el.name] = [...el.selectedOptions].map((o) => o.value);
    } else if (el.value !== "") {
      campos[el.name] = el.value;
    }
  }
  for (const [nome, v] of Object.entries(campos)) if (Array.isArray(v) && !v.length) delete campos[nome];
  return campos;
}

// Põe o valor do jeito que o React percebe (campos controlados também).
function aplicar(el: Campo, valor: Valor): boolean {
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
    const marcar = Array.isArray(valor) ? valor.includes(el.value) : valor === el.value;
    if (el.checked !== marcar && (el.type === "checkbox" || marcar)) el.click();
    return true;
  }
  if (el instanceof HTMLSelectElement && el.multiple) {
    const lista = Array.isArray(valor) ? valor : [valor];
    for (const o of el.options) o.selected = lista.includes(o.value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  const texto = Array.isArray(valor) ? valor[0] ?? "" : valor;
  if (el.value === texto) return true;
  if (el instanceof HTMLSelectElement && ![...el.options].some((o) => o.value === texto)) return false; // opção ainda não existe
  const prototipo = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototipo, "value")?.set?.call(el, texto);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  if (!(el instanceof HTMLSelectElement)) el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function RascunhoAutomatico({ chave }: { chave: string }) {
  const ancora = useRef<HTMLSpanElement>(null);
  const [recuperadoEm, setRecuperadoEm] = useState<number | null>(null);
  const [temAnexo, setTemAnexo] = useState(false);

  useEffect(() => {
    const form = ancora.current?.closest("form");
    if (!form) return;
    let pronto = false;
    let cancelado = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const salvar = () => {
      if (!pronto) return;
      try {
        const campos = serializar(form);
        if (Object.keys(campos).length) window.localStorage.setItem(prefixo(chave), JSON.stringify({ salvoEm: Date.now(), campos } satisfies Rascunho));
        else window.localStorage.removeItem(prefixo(chave));
      } catch {
        // armazenamento cheio/bloqueado: segue sem rascunho
      }
    };
    const agendar = () => {
      clearTimeout(timer);
      timer = setTimeout(salvar, 400);
    };

    (async () => {
      const rascunho = ler(chave);
      if (rascunho) {
        // Em rodadas: escolher uma opção pode fazer aparecer outros campos
        // (ex.: "Pessoa Física" mostra os dados do locatário).
        const faltam = new Map(Object.entries(rascunho.campos));
        for (let rodada = 0; rodada < 8 && faltam.size && !cancelado; rodada++) {
          for (const el of camposDo(form)) {
            const v = faltam.get(el.name);
            if (v === undefined) continue;
            if (aplicar(el, v) && !(el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox"))) faltam.delete(el.name);
          }
          // Rádios/checkboxes de um mesmo nome: dá como aplicados depois da rodada.
          for (const el of camposDo(form)) if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")) faltam.delete(el.name);
          await espera(120);
        }
        if (!cancelado) {
          setRecuperadoEm(rascunho.salvoEm);
          setTemAnexo(!!form.querySelector('input[type="file"]'));
        }
      }
      pronto = true;
    })();

    form.addEventListener("input", agendar, true);
    form.addEventListener("change", agendar, true);
    form.addEventListener("submit", salvar, true);
    window.addEventListener("pagehide", salvar);
    return () => {
      cancelado = true;
      clearTimeout(timer);
      form.removeEventListener("input", agendar, true);
      form.removeEventListener("change", agendar, true);
      form.removeEventListener("submit", salvar, true);
      window.removeEventListener("pagehide", salvar);
    };
  }, [chave]);

  return (
    <span ref={ancora} className="block">
      {recuperadoEm && (
        <span className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <span>
            Recuperamos o que você tinha preenchido em{" "}
            {new Date(recuperadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}. Confira e continue de onde parou.
            {temAnexo && " Os anexos (arquivos) precisam ser escolhidos de novo."}
          </span>
          <button
            type="button"
            onClick={() => {
              limparRascunho(chave);
              window.location.reload();
            }}
            className="rounded-full border border-amber-400 px-3 py-1 text-xs font-medium hover:bg-amber-100"
          >
            Descartar e começar do zero
          </button>
        </span>
      )}
    </span>
  );
}
