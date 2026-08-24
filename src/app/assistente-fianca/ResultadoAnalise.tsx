"use client";

import { useState } from "react";
import type { AnaliseFianca, StatusPilar } from "@/lib/assistenteFianca";

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

function BlocoPilar({
  numero,
  titulo,
  status,
  resumo,
  hierarquia,
}: {
  numero: string;
  titulo: string;
  status: StatusPilar;
  resumo: string;
  hierarquia?: string;
}) {
  return (
    <div className="space-y-1.5 border-b border-gray-100 pb-4 last:border-0 last:pb-0">
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 shrink-0 ${COR_PILAR[status]}`}>{ICONE_PILAR[status]}</span>
        <p className="text-sm font-semibold text-o2-navy">
          {numero}. {titulo}
        </p>
      </div>
      <p className="pl-6 text-sm text-gray-700">{resumo}</p>
      {hierarquia && <p className="whitespace-pre-wrap pl-6 text-sm text-gray-700">{hierarquia}</p>}
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
        <TituloEtapa numero="1" titulo="Parecer analítico" subtitulo="Uso interno — 5 pilares de leitura do caso" />

        <div className="space-y-4 rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
          <span className={`inline-flex rounded-full border px-3 py-1 text-sm font-semibold ${STATUS_GERAL_ESTILO[resultado.status_geral]}`}>
            {STATUS_GERAL_ROTULO[resultado.status_geral]}
          </span>

          <BlocoPilar
            numero="1"
            titulo="Visão geral"
            status={resultado.visao_geral_status}
            resumo={resultado.visao_geral_resumo}
            hierarquia={resultado.visao_geral_hierarquia_taxas}
          />
          <BlocoPilar
            numero="2"
            titulo="Cobertura e estrutura"
            status={resultado.cobertura_estrutura_status}
            resumo={resultado.cobertura_estrutura_resumo}
            hierarquia={resultado.cobertura_estrutura_hierarquia}
          />
          <BlocoPilar
            numero="3"
            titulo="Melhor custo-benefício"
            status={resultado.custo_beneficio_status}
            resumo={resultado.custo_beneficio_resumo}
          />
          <BlocoPilar
            numero="4"
            titulo="Perfil e abordagem"
            status={resultado.perfil_abordagem_status}
            resumo={resultado.perfil_abordagem_resumo}
          />
          <BlocoPilar
            numero="5"
            titulo="Parecer global"
            status={resultado.parecer_global_status}
            resumo={resultado.parecer_global_resumo}
          />

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
