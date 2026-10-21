"use client";

import { useRef, useState, useTransition } from "react";
import { buscarApolices, type ApoliceEncontrada } from "./operacao";
import { rotuloProduto } from "@/lib/sinistros/produtos";

const dataBr = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");

// Busca a apólice na base de produção (Nosso Nº, CPF/CNPJ ou nome do
// locatário) e preenche o formulário em volta -- evita redigitar o que o
// Workspace já sabe (21/10/2026). Só preenche campos vazios, exceto os
// ocultos de vínculo (Nosso Nº).
export default function BuscaApolice({ nossoNumeroInicial }: { nossoNumeroInicial?: string | null }) {
  // O Nosso Nº fica num campo oculto controlado aqui: com defaultValue o React
  // reaplica o valor original a cada redesenho e apagava o preenchido.
  const [nossoNumero, setNossoNumero] = useState(nossoNumeroInicial ?? "");
  const caixa = useRef<HTMLDivElement>(null);
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<ApoliceEncontrada[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [carregando, iniciar] = useTransition();

  function buscar() {
    setAviso(null);
    iniciar(async () => {
      const r = await buscarApolices(termo);
      setResultados(r);
      if (!r.length) setAviso("Nada encontrado. Confira o número ou digite o nome do locatário.");
    });
  }

  function preencher(a: ApoliceEncontrada) {
    const form = caixa.current?.closest("form");
    if (!form) return;
    const preenchidos: string[] = [];
    const definir = (nome: string, valor: string | null | undefined, sempre = false, criarOpcao = true) => {
      if (!valor) return;
      const el = form.elements.namedItem(nome) as HTMLInputElement | HTMLSelectElement | null;
      if (!el || !("value" in el)) return;
      if (!sempre && el.value) return;
      // Valor pelo setter nativo + evento: o formulário (React) fica sabendo da mudança.
      const definirValor = (alvo: HTMLInputElement | HTMLSelectElement, v: string) => {
        const proto = alvo instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(alvo, v);
        alvo.dispatchEvent(new Event(alvo instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
      };
      if (el instanceof HTMLSelectElement) {
        const alvo = valor.toLowerCase();
        const opcao = Array.from(el.options).find((o) => o.value && (o.value.toLowerCase() === alvo || alvo.includes(o.value.toLowerCase()) || o.value.toLowerCase().includes(alvo)));
        if (opcao) definirValor(el, opcao.value);
        else if (!criarOpcao) return;
        else {
          const nova = new Option(valor, valor);
          el.add(nova);
          definirValor(el, valor);
        }
      } else definirValor(el, valor);
      preenchidos.push(nome);
    };
    setNossoNumero(a.nosso_numero);
    definir("produto", a.produto, true, false);
    definir("seguradora", a.seguradora);
    definir("numero_apolice", a.numero_apolice);
    definir("vigencia_inicio", a.vigencia_inicio?.slice(0, 10));
    definir("vigencia_fim", a.vigencia_fim?.slice(0, 10));
    definir("locatario_nome", a.locatario_nome);
    definir("locatario_documento", a.locatario_documento);
    definir("locatario_email", a.locatario_email);
    definir("locatario_telefone", a.locatario_telefone);
    if (a.imobiliaria_id) definir("imobiliaria_id", a.imobiliaria_id);
    setResultados(null);
    setAviso(`Preenchido a partir do Nosso Nº ${a.nosso_numero} (${preenchidos.length} campo(s)). Confira e complete o resto.`);
  }

  return (
    <div ref={caixa} className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-4">
      <input type="hidden" name="nosso_numero" value={nossoNumero} />
      <p className="text-sm font-semibold text-o2-navy">Buscar a apólice e preencher automaticamente</p>
      <div className="flex flex-wrap gap-2">
        <input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              buscar();
            }
          }}
          placeholder="Nosso Nº, código do cliente no Corp, CPF/CNPJ ou nome do locatário"
          className="min-w-64 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        />
        <button type="button" onClick={buscar} disabled={carregando || termo.trim().length < 3} className="rounded-full bg-o2-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {carregando ? "Buscando…" : "Buscar"}
        </button>
      </div>
      {aviso && <p className="text-xs text-blue-900">{aviso}</p>}
      {resultados && resultados.length > 0 && (
        <ul className="divide-y divide-blue-100 overflow-hidden rounded-lg border border-blue-100 bg-white">
          {resultados.map((a) => (
            <li key={`${a.nosso_numero}-${a.produto}`}>
              <button type="button" onClick={() => preencher(a)} className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50">
                <span className="font-semibold text-o2-navy">{a.locatario_nome ?? "—"}</span>
                <span className="text-gray-600">
                  {" "}
                  · {rotuloProduto(a.produto)} · {a.seguradora ?? "—"}{a.numero_apolice ? ` · apólice ${a.numero_apolice}` : ""} · Nosso Nº {a.nosso_numero}
                </span>
                <span className="block text-xs text-gray-500">
                  Vigência {dataBr(a.vigencia_inicio)} a {dataBr(a.vigencia_fim)} · {a.imobiliaria_texto ?? "sem imobiliária"}
                  {a.status ? ` · ${a.status}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
