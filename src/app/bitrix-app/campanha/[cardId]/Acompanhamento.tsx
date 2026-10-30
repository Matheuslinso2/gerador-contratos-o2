"use client";

import { useState, useTransition } from "react";
import { salvarAcompanhamento } from "./actions";

const campo = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none";

export default function Acompanhamento({
  cardId,
  passe,
  proximaAcaoInicial,
  observacaoInicial,
  ultimaEdicao,
}: {
  cardId: number;
  passe: string;
  proximaAcaoInicial: string;
  observacaoInicial: string;
  ultimaEdicao: string | null;
}) {
  const [proxima, setProxima] = useState(proximaAcaoInicial);
  const [obs, setObs] = useState(observacaoInicial);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [edicao, setEdicao] = useState(ultimaEdicao);
  const [pendente, iniciar] = useTransition();

  function salvar() {
    setAviso(null);
    iniciar(async () => {
      const r = await salvarAcompanhamento(cardId, passe, { proximaAcao: proxima, observacao: obs });
      if (r.ok) {
        setEdicao(`${r.por} em ${new Date(r.em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}`);
        setAviso({ tipo: "ok", texto: "Salvo." });
      } else setAviso({ tipo: "erro", texto: r.erro });
    });
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Próxima ação com esta imobiliária</label>
        <input value={proxima} onChange={(e) => setProxima(e.target.value)} maxLength={300} placeholder="Ex: ligar na segunda para fechar as 3 cotações abertas" className={campo} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">Observações da equipe</label>
        <textarea value={obs} onChange={(e) => setObs(e.target.value)} maxLength={2000} rows={4} className={campo} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={salvar} disabled={pendente} className="rounded-full bg-o2-coral px-5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60">
          {pendente ? "Salvando..." : "Salvar"}
        </button>
        {aviso && <span className={`text-sm ${aviso.tipo === "ok" ? "text-green-700" : "text-red-700"}`}>{aviso.texto}</span>}
        {edicao && <span className="text-xs text-gray-500">Última edição: {edicao}</span>}
      </div>
    </div>
  );
}
