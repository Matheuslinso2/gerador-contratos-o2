"use client";

import { useState } from "react";
import { analisar } from "./actions";
import ResultadoAnalise from "./ResultadoAnalise";
import type { AnaliseFianca } from "@/lib/assistenteFianca";

export default function PanoramaForm() {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<AnaliseFianca | null>(null);
  const [nomeImagem, setNomeImagem] = useState<string | null>(null);

  async function aoEnviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    setResultado(null);

    const dados = new FormData(e.currentTarget);
    try {
      const analise = await analisar(dados);
      setResultado(analise);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao analisar o panorama.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={aoEnviar} className="space-y-3 rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
        <div>
          <label className="mb-1 block text-sm font-medium text-o2-navy">Panorama do caso</label>
          <p className="mb-2 text-xs text-gray-500">
            Cole os dados da locação (aluguel, condomínio, IPTU) e as cotações recebidas (seguradora, plano, parcelas,
            valor, LMI/LMG, status de aprovação). Quanto mais completo, mais precisa a leitura.
          </p>
          <textarea
            name="panorama"
            rows={8}
            placeholder={"Ex:\nAluguel R$ 1.550 + IPTU R$ 231\nPottencial / Básico / 30x R$ 93,90 / LMI 30x / Aprovado\nTokio / Completo / 30x R$ 138,00 / LMI 30x / Aprovado"}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-o2-coral focus:outline-none"
          />
        </div>

        <details>
          <summary className="cursor-pointer text-xs text-gray-500 hover:text-o2-coral">
            ou anexar um print do sistema/seguradora em vez de colar texto
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-o2-navy px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">
              Selecionar imagem
              <input
                name="imagem"
                type="file"
                accept=".png,.jpg,.jpeg,.gif,.webp"
                className="sr-only"
                onChange={(e) => setNomeImagem(e.target.files?.[0]?.name ?? null)}
              />
            </label>
            <span className="text-sm text-gray-600">{nomeImagem ?? "Nenhuma imagem selecionada"}</span>
          </div>
        </details>

        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        <button
          type="submit"
          disabled={enviando}
          className="rounded-full bg-o2-coral px-6 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {enviando ? "Analisando... (pode levar até 1 minuto)" : "Analisar caso"}
        </button>
      </form>

      {resultado && <ResultadoAnalise resultado={resultado} />}
    </div>
  );
}
