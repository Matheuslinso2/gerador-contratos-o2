"use client";

import { useState } from "react";
import { analisar } from "./actions";
import ResultadoAnalise from "./ResultadoAnalise";
import FeedbackAnalise from "./FeedbackAnalise";
import type { AnaliseFianca } from "@/lib/assistenteFianca";

const EXTENSOES_ACEITAS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf"];

function extensaoValida(nome: string): boolean {
  const nomeLower = nome.toLowerCase();
  return EXTENSOES_ACEITAS.some((ext) => nomeLower.endsWith(ext));
}

function IconeUpload() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

export default function PanoramaForm() {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resposta, setResposta] = useState<{ id: string; analise: AnaliseFianca } | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [arrastando, setArrastando] = useState(false);

  function selecionarArquivo(f: File | null) {
    if (f && !extensaoValida(f.name)) {
      setErro("Envie uma imagem (.png, .jpg, .jpeg, .gif, .webp) ou um PDF.");
      return;
    }
    setErro(null);
    setArquivo(f);
  }

  async function aoEnviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    setResposta(null);

    const dados = new FormData(e.currentTarget);
    if (arquivo) dados.set("arquivo", arquivo);

    try {
      const resultado = await analisar(dados);
      setResposta(resultado);
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

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastando(false);
            selecionarArquivo(e.dataTransfer.files?.[0] ?? null);
          }}
          className={`rounded-lg border p-3 transition ${
            arrastando ? "border-o2-coral bg-o2-coral/5" : "border-gray-200"
          }`}
        >
          <p className="mb-1 text-sm font-medium text-o2-navy">Ou anexe um print ou PDF (opcional)</p>
          <p className="mb-2 text-xs text-gray-500">
            Print do sistema/seguradora ou PDF da cotação — a IA lê os dados direto do arquivo, sem precisar digitar
            nada. Em grades com várias colunas de multiplicador (18x/24x/30x lado a lado), um PDF costuma ler melhor
            que um print comprimido; se ainda assim usar print, vale recortar/ampliar só a linha aprovada, ou colar
            os dados em texto acima. Também dá pra arrastar o arquivo direto pra esta área.
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-o2-navy px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">
              <IconeUpload />
              Selecionar arquivo
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.gif,.webp,.pdf"
                className="sr-only"
                onChange={(e) => selecionarArquivo(e.target.files?.[0] ?? null)}
              />
            </label>
            <span className="text-sm text-gray-600">{arquivo?.name ?? "Nenhum arquivo selecionado (ou arraste aqui)"}</span>
          </div>
        </div>

        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        <button
          type="submit"
          disabled={enviando}
          className="rounded-full bg-o2-coral px-6 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {enviando ? "Analisando... (pode levar até 1 minuto)" : "Analisar caso"}
        </button>
      </form>

      {resposta && (
        <>
          <ResultadoAnalise resultado={resposta.analise} />
          <FeedbackAnalise analiseId={resposta.id} />
        </>
      )}
    </div>
  );
}
