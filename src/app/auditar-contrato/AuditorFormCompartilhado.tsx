"use client";

import type { TipoDocumentoAuditoria } from "@/lib/auditorContrato";

// Peças pequenas e estáveis reaproveitadas pelos dois formulários do
// Auditor -- o logado (AuditorForm.tsx) e o público, sem login
// (AuditorFormPublico.tsx). A diferença real entre os dois está em como
// cada um envia/trata o resultado, não nessa parte.
export const BUCKET_TEMP = "auditoria-temp";
export const ACCEPT_ARQUIVOS = ".docx,.doc,.pdf,.png,.jpg,.jpeg,.webp,.gif";

export const ROTULO_TIPO: Record<TipoDocumentoAuditoria, string> = {
  contrato: "Contrato/Aditivo",
  cotacao: "Cotação/Proposta",
  certificado: "Certificado de assinatura",
  outro: "Outro (contexto)",
};

export type ItemDocumento = {
  id: string;
  tipo: TipoDocumentoAuditoria;
  origem: "arquivo" | "texto";
  arquivo?: File;
  texto?: string;
};

// Um mesmo upload pode ser contrato + aditivo, cotação, certificado etc --
// tudo numa lista só em vez de 3 campos fixos, porque um contrato real pode
// vir em qualquer combinação dessas peças (às vezes mais de um arquivo pro
// próprio contrato, ex: original + aditivo). O nome do arquivo só dá um
// palpite inicial do tipo -- quem confirma é a pessoa, pelo <select> de cada
// linha.
export function adivinharTipo(nomeArquivo: string): TipoDocumentoAuditoria {
  const n = nomeArquivo.toLowerCase();
  if (/(cota[cç][aã]o|proposta)/.test(n)) return "cotacao";
  if (/(certificado|assinatura|clicksign|zapsign|d4sign|docusign)/.test(n)) return "certificado";
  if (/(vistoria|laudo)/.test(n)) return "outro";
  return "contrato";
}

export function IconeUpload() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

export function IconeRemover() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

export function LinhaDocumento({
  item,
  onTipoChange,
  onRemover,
}: {
  item: ItemDocumento;
  onTipoChange: (id: string, tipo: TipoDocumentoAuditoria) => void;
  onRemover: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
      <select
        value={item.tipo}
        onChange={(e) => onTipoChange(item.id, e.target.value as TipoDocumentoAuditoria)}
        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-o2-navy focus:border-o2-coral focus:outline-none"
      >
        {(Object.keys(ROTULO_TIPO) as TipoDocumentoAuditoria[]).map((t) => (
          <option key={t} value={t}>
            {ROTULO_TIPO[t]}
          </option>
        ))}
      </select>
      <span className="flex-1 truncate text-sm text-gray-700">
        {item.origem === "arquivo" ? item.arquivo?.name : `Texto colado (${item.texto?.length ?? 0} caracteres)`}
      </span>
      <button
        type="button"
        onClick={() => onRemover(item.id)}
        className="rounded-full p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
        aria-label="Remover documento"
      >
        <IconeRemover />
      </button>
    </div>
  );
}
