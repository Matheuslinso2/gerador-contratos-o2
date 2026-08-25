"use client";

import { useState } from "react";
import type { AnaliseFianca } from "@/lib/assistenteFianca";

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

function TituloEtapa({ numero, titulo, subtitulo }: { numero: string; titulo: string; subtitulo: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-o2-navy text-sm font-semibold text-white">
        {numero}
      </span>
      <div>
        <h2 className="text-base font-semibold text-o2-navy">{titulo}</h2>
        <p className="text-xs text-gray-500">{subtitulo}</p>
      </div>
    </div>
  );
}

export default function ResultadoAnalise({ resultado }: { resultado: AnaliseFianca }) {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <TituloEtapa numero="1" titulo="Parecer analítico" subtitulo="Uso interno — comparativo e leitura do caso" />

        <div className="space-y-4 rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
          {resultado.opcoes.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-o2-gray/30 text-xs text-gray-500">
                    <th className="px-3 py-2 font-medium">Seguradora / Plano</th>
                    <th className="px-3 py-2 font-medium">Estrutura</th>
                    <th className="px-3 py-2 font-medium">Taxa</th>
                    <th className="px-3 py-2 font-medium">Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.opcoes.map((o, i) => (
                    <tr key={i} className="border-b border-gray-50 align-top last:border-0">
                      <td className="px-3 py-2 font-medium text-gray-800">
                        {o.seguradora} · {o.plano}
                      </td>
                      <td className="px-3 py-2 text-gray-700">{o.estrutura}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{o.taxa}</td>
                      <td className="px-3 py-2 text-xs text-amber-700">{o.observacao}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-sm text-gray-800">{resultado.parecer_abordagem_comercial}</p>
        </div>
      </section>

      <section className="space-y-3">
        <TituloEtapa numero="2" titulo="Visão comercial" subtitulo="Mensagem pronta para copiar e enviar ao cliente/imobiliária" />

        <div className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-sm font-semibold text-o2-navy">WhatsApp</p>
            <BotaoCopiar texto={resultado.mensagem_whatsapp} />
          </div>
          <p className="whitespace-pre-wrap text-sm text-gray-800">{resultado.mensagem_whatsapp}</p>
        </div>
      </section>
    </div>
  );
}
