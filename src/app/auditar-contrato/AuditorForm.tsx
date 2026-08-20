"use client";

import { useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { auditar } from "./actions";

const BUCKET_TEMP = "auditoria-temp";

async function enviarArquivo(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  arquivo: File
): Promise<string> {
  const ext = arquivo.name.split(".").pop() || "bin";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET_TEMP)
    .upload(path, arquivo, { contentType: arquivo.type });
  if (error) throw new Error(`Falha ao enviar "${arquivo.name}": ${error.message}`);
  return path;
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

// Upload é o jeito rotineiro de mandar cada documento -- por isso vira um
// botão de verdade em destaque, e colar texto manualmente fica escondido
// atrás de um <details>, só pra não desaparecer de vez (útil pra um trecho
// avulso), sem tomar o espaço da tela por padrão.
function CampoUpload({
  label,
  ajuda,
  nomeCampoArquivo,
  nomeCampoTexto,
  accept,
  placeholderTexto,
  nomeArquivo,
  onArquivoChange,
}: {
  label: string;
  ajuda: string;
  nomeCampoArquivo: string;
  nomeCampoTexto: string;
  accept: string;
  placeholderTexto: string;
  nomeArquivo: string | null;
  onArquivoChange: (nome: string | null) => void;
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <p className="mb-1 text-sm font-medium text-o2-navy">{label}</p>
      <p className="mb-2 text-xs text-gray-500">{ajuda}</p>

      <div className="flex flex-wrap items-center gap-2.5">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-o2-navy px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">
          <IconeUpload />
          Selecionar arquivo
          <input
            name={nomeCampoArquivo}
            type="file"
            accept={accept}
            className="sr-only"
            onChange={(e) => onArquivoChange(e.target.files?.[0]?.name ?? null)}
          />
        </label>
        <span className="text-sm text-gray-600">
          {nomeArquivo ?? "Nenhum arquivo selecionado"}
        </span>
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-gray-500 hover:text-o2-coral">
          ou cole o texto manualmente
        </summary>
        <textarea
          name={nomeCampoTexto}
          rows={4}
          placeholder={placeholderTexto}
          className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-o2-coral focus:outline-none"
        />
      </details>
    </div>
  );
}

export default function AuditorForm({ userId }: { userId: string }) {
  const [etapa, setEtapa] = useState<"parado" | "enviando" | "analisando">("parado");
  const [erro, setErro] = useState<string | null>(null);
  const [nomeArquivoContrato, setNomeArquivoContrato] = useState<string | null>(null);
  const [nomeArquivoCotacao, setNomeArquivoCotacao] = useState<string | null>(null);
  const [nomeArquivoCertificado, setNomeArquivoCertificado] = useState<string | null>(null);
  const enviando = etapa !== "parado";

  async function aoEnviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);

    const form = e.currentTarget;
    const dados = new FormData(form);
    const arquivo = dados.get("arquivo") as File | null;
    const arquivoCotacao = dados.get("arquivo_cotacao") as File | null;
    const arquivoCertificado = dados.get("arquivo_certificado") as File | null;
    dados.delete("arquivo");
    dados.delete("arquivo_cotacao");
    dados.delete("arquivo_certificado");

    try {
      setEtapa("enviando");
      const supabase = createClient();

      if (arquivo && arquivo.size > 0) {
        const path = await enviarArquivo(supabase, userId, arquivo);
        dados.set("arquivo_path", path);
        dados.set("arquivo_nome", arquivo.name);
      }
      if (arquivoCotacao && arquivoCotacao.size > 0) {
        const path = await enviarArquivo(supabase, userId, arquivoCotacao);
        dados.set("arquivo_cotacao_path", path);
        dados.set("arquivo_cotacao_nome", arquivoCotacao.name);
      }
      if (arquivoCertificado && arquivoCertificado.size > 0) {
        const path = await enviarArquivo(supabase, userId, arquivoCertificado);
        dados.set("arquivo_certificado_path", path);
        dados.set("arquivo_certificado_nome", arquivoCertificado.name);
      }

      setEtapa("analisando");
      await auditar(dados);
      // auditar() redireciona em caso de sucesso ou erro; se chegar aqui sem
      // redirecionar (não deveria), só destrava o botão.
      setEtapa("parado");
    } catch (e) {
      // auditar() usa redirect() internamente (sucesso ou erro do servidor);
      // isso lança um sinal especial do Next que precisa continuar subindo,
      // não ser tratado como um erro de verdade.
      unstable_rethrow(e);
      setErro(e instanceof Error ? e.message : "Falha ao enviar os arquivos.");
      setEtapa("parado");
    }
  }

  return (
    <form onSubmit={aoEnviar} className="space-y-3">
      {erro && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>
      )}

      <CampoUpload
        label="Contrato de locação"
        ajuda="Envie o arquivo (.docx ou .pdf) -- inclusive escaneado ou fotografado, a IA lê direto das páginas."
        nomeCampoArquivo="arquivo"
        nomeCampoTexto="texto"
        accept=".docx,.pdf"
        placeholderTexto="Cole aqui o texto completo do contrato de locação..."
        nomeArquivo={nomeArquivoContrato}
        onArquivoChange={setNomeArquivoContrato}
      />

      <CampoUpload
        label="Cotação/proposta de seguro (opcional)"
        ajuda="Se enviar, o Auditor confere se segurado, valor do aluguel, prazo e endereço batem entre o contrato e a cotação. Pode ser PDF/Word, ficha cadastral ou print de tela."
        nomeCampoArquivo="arquivo_cotacao"
        nomeCampoTexto="texto_cotacao"
        accept=".docx,.pdf,.png,.jpg,.jpeg,.webp"
        placeholderTexto="Cole aqui o texto da cotação (nomes, endereço, valor, prazo)..."
        nomeArquivo={nomeArquivoCotacao}
        onArquivoChange={setNomeArquivoCotacao}
      />

      <CampoUpload
        label="Certificado de assinatura eletrônica (opcional)"
        ajuda="Se enviar, o Auditor usa o comprovante (Clicksign, ZapSign, D4Sign, DocuSign ou similar) como fonte principal do pilar de assinaturas -- conferindo o código de verificação e cruzando os signatários com o contrato e a cotação. Pode ser PDF, Word, ou uma imagem escaneada/print."
        nomeCampoArquivo="arquivo_certificado"
        nomeCampoTexto="texto_certificado"
        accept=".docx,.pdf,.png,.jpg,.jpeg,.webp"
        placeholderTexto="Cole aqui o texto do certificado de assinatura eletrônica..."
        nomeArquivo={nomeArquivoCertificado}
        onArquivoChange={setNomeArquivoCertificado}
      />

      <button
        type="submit"
        disabled={enviando}
        className="rounded-full bg-o2-coral px-6 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {etapa === "enviando" && "Enviando arquivos..."}
        {etapa === "analisando" && "Analisando... (pode levar até 1 minuto)"}
        {etapa === "parado" && "Analisar contrato"}
      </button>
    </form>
  );
}
