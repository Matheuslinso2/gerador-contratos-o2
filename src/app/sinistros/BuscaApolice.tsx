"use client";

import { useRef, useState, useTransition } from "react";
import { buscarApolices, type ApoliceEncontrada } from "./operacao";
import { rotuloProduto } from "@/lib/sinistros/produtos";

const dataBr = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const docBr = (d: string) =>
  d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
/** CEP no texto do local de risco lido da apólice ("22795450", "22795-450", "28.895-178"). */
const cepDoTexto = (t: string | null) => {
  const m = t?.match(/\b(\d{2})\.?(\d{3})-?(\d{3})\b/);
  return m ? `${m[1]}${m[2]}-${m[3]}` : null;
};
// Campo preenchido com dado lido do PDF da apólice: destaque em amarelo + dica.
const MARCA_APOLICE = ["ring-2", "ring-amber-400", "bg-amber-50"];
type DaApolice = { arquivoId: string | null; local: string | null; locatarios: NonNullable<ApoliceEncontrada["locatarios_apolice"]> };

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
  const [daApolice, setDaApolice] = useState<DaApolice | null>(null);
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
    const lidosDaApolice: string[] = [];
    const definir = (nome: string, valor: string | null | undefined, sempre = false, criarOpcao = true, daApolice = false) => {
      if (!valor) return;
      const el = form.elements.namedItem(nome) as HTMLInputElement | HTMLSelectElement | null;
      if (!el || !("value" in el)) return;
      if (!sempre && el.value) return;
      if (daApolice) {
        el.classList.add(...MARCA_APOLICE);
        el.title = "Lido da apólice (PDF) — confira";
        lidosDaApolice.push(nome);
      }
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
    // Ajuste da equipe (23/10/2026): o cliente do Corp é o segurado. Na
    // Capitalização o cliente é o titular do título (campos de "locatário").
    if (a.produto === "capitalizacao") {
      definir("locatario_nome", a.cliente_nome);
      definir("locatario_documento", a.cliente_documento);
      definir("locatario_email", a.cliente_email);
      definir("locatario_telefone", a.cliente_telefone);
    } else {
      definir("locador_nome", a.cliente_nome);
      definir("locador_documento", a.cliente_documento);
      // Garantido (locatário): não vem do Corp; vem do PDF da apólice quando ele foi
      // lido e ligado com certeza à apólice (23/10/2026). O 1º vai para os campos; todos no quadro abaixo.
      const loc = a.locatarios_apolice?.[0];
      if (loc) {
        definir("locatario_nome", loc.nome, false, true, true);
        definir("locatario_documento", docBr(loc.documento), false, true, true);
        definir("locatario_telefone", loc.telefone, false, true, true);
        definir("locatario_email", loc.email, false, true, true);
      }
    }
    // Local de risco: o do Corp; sem ele, o CEP lido da apólice (o formulário completa rua/bairro/cidade pelo CEP).
    if (a.imovel_cep || a.imovel_logradouro) {
      definir("cep", a.imovel_cep);
      definir("logradouro", a.imovel_logradouro);
      definir("numero", a.imovel_numero);
      definir("complemento", a.imovel_complemento);
      definir("bairro", a.imovel_bairro);
      definir("cidade", a.imovel_cidade);
      definir("uf", a.imovel_uf);
    } else definir("cep", cepDoTexto(a.apolice_local_risco), false, true, true);
    if (a.imobiliaria_id) definir("imobiliaria_id", a.imobiliaria_id);
    setResultados(null);
    const temLocatario = !!a.locatarios_apolice?.length;
    setDaApolice(temLocatario || a.apolice_local_risco ? { arquivoId: a.apolice_arquivo_id, local: a.apolice_local_risco, locatarios: a.locatarios_apolice ?? [] } : null);
    setAviso(
      `Preenchido a partir do Nosso Nº ${a.nosso_numero} (${preenchidos.length} campo(s)).` +
        (lidosDaApolice.length ? " Os campos em amarelo foram lidos da apólice em PDF." : "") +
        (a.produto === "fianca" && !temLocatario ? " O garantido (locatário) não vem do Corp e não há apólice em PDF lida para este Nosso Nº: preencha à mão." : "") +
        " Confira e complete o resto."
    );
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
          placeholder="Nosso Nº, código do cliente no Corp, CPF/CNPJ ou nome do segurado ou do inquilino"
          className="min-w-64 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        />
        <button type="button" onClick={buscar} disabled={carregando || termo.trim().length < 3} className="rounded-full bg-o2-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {carregando ? "Buscando…" : "Buscar"}
        </button>
      </div>
      {aviso && <p className="text-xs text-blue-900">{aviso}</p>}
      {daApolice && (
        <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">Lido da apólice (PDF)</p>
          {daApolice.locatarios.length > 0 && (
            <ul className="space-y-0.5">
              {daApolice.locatarios.map((l) => (
                <li key={l.documento}>
                  {l.ordem}º locatário: <span className="font-medium">{l.nome ?? "(nome não lido)"}</span> — {docBr(l.documento)}
                  {l.ordem > 1 ? " (não vai para os campos acima; registre no sinistro se precisar)" : ""}
                </li>
              ))}
            </ul>
          )}
          {daApolice.local && <p>Local de risco: {daApolice.local}</p>}
          {daApolice.arquivoId && (
            <a href={`https://drive.google.com/file/d/${daApolice.arquivoId}/view`} target="_blank" rel="noreferrer" className="font-semibold underline">
              Abrir a apólice em PDF (Drive)
            </a>
          )}
        </div>
      )}
      {resultados && resultados.length > 0 && (
        <ul className="divide-y divide-blue-100 overflow-hidden rounded-lg border border-blue-100 bg-white">
          {resultados.map((a) => (
            <li key={`${a.nosso_numero}-${a.produto}`}>
              <button type="button" onClick={() => preencher(a)} className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50">
                <span className="font-semibold text-o2-navy">{a.cliente_nome ?? "—"}</span>
                <span className="text-gray-600">
                  {" "}
                  · {rotuloProduto(a.produto)} · {a.seguradora ?? "—"}{a.numero_apolice ? ` · apólice ${a.numero_apolice}` : ""} · Nosso Nº {a.nosso_numero}
                </span>
                <span className="block text-xs text-gray-500">
                  Vigência {dataBr(a.vigencia_inicio)} a {dataBr(a.vigencia_fim)} · {a.imobiliaria_texto ?? "sem imobiliária"}
                  {a.imovel_logradouro ? ` · ${a.imovel_logradouro}${a.imovel_numero ? `, ${a.imovel_numero}` : ""}` : ""}
                  {a.status ? ` · ${a.status}` : ""}
                </span>
                {(!!a.apolice_arquivo_id || !!a.locatarios_apolice?.length) && (
                  <span className="mt-0.5 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                    Apólice em PDF lida{a.locatarios_apolice?.length ? ` · ${a.locatarios_apolice.length} locatário(s)` : ""}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
