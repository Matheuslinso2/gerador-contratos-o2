"use client";

import { useState } from "react";
import type { AnaliseFianca, StatusAprovacao } from "@/lib/assistenteFianca";

const ROTULO_STATUS: Record<StatusAprovacao, string> = {
  cotado: "Cotado",
  pre_aprovado: "Pré-aprovado",
  aprovado: "Aprovado",
  pendente: "Pendente",
  recusado: "Recusado",
};

const COR_STATUS: Record<StatusAprovacao, string> = {
  cotado: "bg-gray-100 text-gray-700",
  pre_aprovado: "bg-blue-100 text-blue-800",
  aprovado: "bg-green-100 text-green-700",
  pendente: "bg-yellow-100 text-yellow-800",
  recusado: "bg-red-100 text-red-700",
};

function BotaoCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(texto);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
      }}
      className="rounded-full border border-o2-navy px-3 py-1 text-xs font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white"
    >
      {copiado ? "Copiado!" : "Copiar"}
    </button>
  );
}

export default function ResultadoAnalise({ resultado }: { resultado: AnaliseFianca }) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Pacote de locação</p>
        <p className="mb-3 text-lg font-semibold text-o2-navy">{resultado.pacote_locacao}</p>
        <p className="text-sm text-gray-700">{resultado.resumo_executivo}</p>
      </div>

      {resultado.pendencias.length > 0 && (
        <div className="rounded-xl border border-yellow-300 bg-yellow-50 p-4">
          <p className="mb-1.5 text-sm font-semibold text-yellow-800">Confirmar antes de recomendar ou emitir</p>
          <ul className="list-inside list-disc space-y-0.5 text-sm text-yellow-800">
            {resultado.pendencias.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {resultado.opcoes.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-o2-navy/10 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-o2-gray/30 text-xs text-gray-500">
                <th className="px-3 py-2 font-medium">Seguradora / Plano</th>
                <th className="px-3 py-2 font-medium">Estrutura</th>
                <th className="px-3 py-2 font-medium">Parcelas</th>
                <th className="px-3 py-2 font-medium">% pacote</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Leitura</th>
              </tr>
            </thead>
            <tbody>
              {resultado.opcoes.map((o, i) => (
                <tr key={i} className="border-b border-gray-50 align-top last:border-0">
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-800">
                      {o.seguradora} · {o.plano}
                    </p>
                    <p className="text-xs text-gray-500">
                      {o.valor_parcela} ({o.parcelas}) · total {o.valor_total}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {o.estrutura === "nao_informado" ? "—" : `${o.estrutura} ${o.multiplicador}`}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{o.parcelas}</td>
                  <td className="px-3 py-2 font-medium text-gray-800">{o.percentual_pacote}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${COR_STATUS[o.status_aprovacao]}`}>
                      {ROTULO_STATUS[o.status_aprovacao]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">
                    <p>{o.pontos_fortes}</p>
                    {o.pontos_atencao && <p className="mt-0.5 text-amber-700">⚠ {o.pontos_atencao}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {resultado.comparativo_planos && (
        <div className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
          <p className="mb-1 text-sm font-semibold text-o2-navy">Básico x Completo</p>
          <p className="text-sm text-gray-700">{resultado.comparativo_planos}</p>
        </div>
      )}

      {resultado.explicacao_lmi_lmg && (
        <div className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
          <p className="mb-1 text-sm font-semibold text-o2-navy">LMI x LMG</p>
          <p className="text-sm text-gray-700">{resultado.explicacao_lmi_lmg}</p>
        </div>
      )}

      {resultado.capitalizacao_aplicavel && (
        <div className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
          <p className="mb-1 text-sm font-semibold text-o2-navy">Título de capitalização</p>
          <p className="text-sm text-gray-700">{resultado.capitalizacao_resumo}</p>
        </div>
      )}

      <div className="rounded-xl border border-o2-coral/30 bg-o2-coral/5 p-4">
        <p className="mb-1 text-sm font-semibold text-o2-navy">Leitura consultiva</p>
        <p className="text-sm text-gray-800">{resultado.leitura_consultiva}</p>
        <p className="mt-2 text-sm font-medium text-o2-navy">Próximo passo: {resultado.proximo_passo}</p>
      </div>

      <div className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-sm font-semibold text-o2-navy">Mensagem pronta — WhatsApp</p>
          <BotaoCopiar texto={resultado.mensagem_whatsapp} />
        </div>
        <p className="whitespace-pre-wrap text-sm text-gray-800">{resultado.mensagem_whatsapp}</p>
      </div>

      <div className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-sm font-semibold text-o2-navy">Mensagem pronta — E-mail</p>
          <BotaoCopiar texto={resultado.mensagem_email} />
        </div>
        <p className="whitespace-pre-wrap text-sm text-gray-800">{resultado.mensagem_email}</p>
      </div>
    </div>
  );
}
