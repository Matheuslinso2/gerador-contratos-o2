"use client";

import { useState } from "react";
import type { AnaliseFianca, StatusAprovacao, StatusPilar } from "@/lib/assistenteFianca";

const STATUS_GERAL_ESTILO: Record<AnaliseFianca["status_geral"], string> = {
  PRONTO_PARA_RECOMENDAR: "border-green-300 bg-green-50 text-green-700",
  RECOMENDAR_COM_RESSALVAS: "border-yellow-300 bg-yellow-50 text-yellow-800",
  FALTAM_DADOS_ESSENCIAIS: "border-red-300 bg-red-50 text-red-700",
};

const STATUS_GERAL_ROTULO: Record<AnaliseFianca["status_geral"], string> = {
  PRONTO_PARA_RECOMENDAR: "✅ Pronto para recomendar",
  RECOMENDAR_COM_RESSALVAS: "⚠️ Recomendar com ressalvas",
  FALTAM_DADOS_ESSENCIAIS: "❌ Faltam dados essenciais",
};

const ICONE_PILAR: Record<StatusPilar, string> = {
  ok: "✅",
  atencao: "⚠️",
  problema: "❌",
  nao_avaliado: "➖",
};

const COR_PILAR: Record<StatusPilar, string> = {
  ok: "text-green-700",
  atencao: "text-yellow-800",
  problema: "text-red-700",
  nao_avaliado: "text-gray-400",
};

const ROTULO_STATUS_OPCAO: Record<StatusAprovacao, string> = {
  cotado: "Cotado",
  pre_aprovado: "Pré-aprovado",
  aprovado: "Aprovado",
  pendente: "Pendente",
  recusado: "Recusado",
};

const COR_STATUS_OPCAO: Record<StatusAprovacao, string> = {
  cotado: "bg-gray-100 text-gray-700",
  pre_aprovado: "bg-blue-100 text-blue-800",
  aprovado: "bg-green-100 text-green-700",
  pendente: "bg-yellow-100 text-yellow-800",
  recusado: "bg-red-100 text-red-700",
};

function LinhaPilar({ titulo, status, resumo }: { titulo: string; status: StatusPilar; resumo: string }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className={`mt-0.5 ${COR_PILAR[status]}`}>{ICONE_PILAR[status]}</span>
      <div>
        <span className="font-medium text-o2-navy">{titulo}: </span>
        <span className="text-gray-700">{resumo}</span>
      </div>
    </div>
  );
}

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
        <TituloEtapa numero="1" titulo="Parecer analítico" subtitulo="Uso interno — 5 pilares, no mesmo formato do Auditor de Contratos" />

        <div className="space-y-3 rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
          <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${STATUS_GERAL_ESTILO[resultado.status_geral]}`}>
            {STATUS_GERAL_ROTULO[resultado.status_geral]}
          </span>

          <div className="space-y-1.5 rounded-lg border border-gray-200 bg-white p-3">
            <LinhaPilar titulo="Dados do caso" status={resultado.dados_caso_status} resumo={resultado.dados_caso_resumo} />
            <LinhaPilar titulo="Cobertura e estrutura" status={resultado.cobertura_estrutura_status} resumo={resultado.cobertura_estrutura_resumo} />
            <LinhaPilar titulo="Comparação entre opções" status={resultado.comparacao_opcoes_status} resumo={resultado.comparacao_opcoes_resumo} />
            <LinhaPilar titulo="Aprovação e alternativas" status={resultado.aprovacao_alternativas_status} resumo={resultado.aprovacao_alternativas_resumo} />
            <LinhaPilar titulo="Viabilidade comercial" status={resultado.viabilidade_comercial_status} resumo={resultado.viabilidade_comercial_resumo} />
          </div>

          {resultado.pontos_criticos.length > 0 && (
            <div>
              <p className="mb-1.5 text-sm font-semibold text-o2-navy">Confirmar antes de recomendar ou emitir</p>
              <ul className="list-inside list-disc space-y-1 text-sm text-gray-700">
                {resultado.pontos_criticos.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          {resultado.opcoes.length > 0 && (
            <div>
              <p className="mb-1.5 text-sm font-semibold text-o2-navy">Cotações comparadas</p>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-o2-gray/30 text-xs text-gray-500">
                      <th className="px-3 py-2 font-medium">Seguradora / Plano</th>
                      <th className="px-3 py-2 font-medium">Estrutura</th>
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
                        </td>
                        <td className="px-3 py-2 text-gray-700">
                          {o.estrutura === "nao_informado" ? "—" : `${o.estrutura} ${o.multiplicador}`}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${COR_STATUS_OPCAO[o.status_aprovacao]}`}>
                            {ROTULO_STATUS_OPCAO[o.status_aprovacao]}
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
            </div>
          )}

          <div className="rounded-lg border border-o2-coral/30 bg-o2-coral/5 p-3">
            <p className="text-sm font-medium text-o2-navy">Próximo passo: {resultado.proximo_passo}</p>
          </div>
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
