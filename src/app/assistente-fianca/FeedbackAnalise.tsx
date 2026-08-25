"use client";

import { useState } from "react";
import { enviarFeedback } from "./actions";

function Estrelas({ valor, onChange }: { valor: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-label={`${n} de 5`}
          className={`text-xl leading-none transition ${n <= valor ? "text-o2-coral" : "text-gray-300 hover:text-gray-400"}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export default function FeedbackAnalise({ analiseId }: { analiseId: string }) {
  const [precisao, setPrecisao] = useState(0);
  const [utilidade, setUtilidade] = useState(0);
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (enviado) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700">
        Obrigado pelo feedback! Isso ajuda a melhorar as próximas análises.
      </div>
    );
  }

  async function enviar() {
    setErro(null);
    if (precisao === 0 || utilidade === 0) {
      setErro("Avalie precisão e utilidade antes de enviar.");
      return;
    }
    setEnviando(true);
    try {
      const dados = new FormData();
      dados.set("id", analiseId);
      dados.set("precisao", String(precisao));
      dados.set("utilidade", String(utilidade));
      dados.set("comentario", comentario);
      await enviarFeedback(dados);
      setEnviado(true);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao enviar feedback.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-o2-navy">Como foi essa análise?</p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-gray-700">Quão precisa foi a leitura?</span>
        <Estrelas valor={precisao} onChange={setPrecisao} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-gray-700">O quanto ela ajudou na negociação?</span>
        <Estrelas valor={utilidade} onChange={setUtilidade} />
      </div>

      <textarea
        value={comentario}
        onChange={(e) => setComentario(e.target.value)}
        rows={2}
        placeholder="O que poderia melhorar? (opcional)"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none"
      />

      {erro && <p className="text-sm text-red-700">{erro}</p>}

      <button
        type="button"
        onClick={enviar}
        disabled={enviando}
        className="rounded-full bg-o2-navy px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {enviando ? "Enviando..." : "Enviar feedback"}
      </button>
    </div>
  );
}
