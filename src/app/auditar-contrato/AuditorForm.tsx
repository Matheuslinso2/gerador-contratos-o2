"use client";

import { useState } from "react";
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

export default function AuditorForm({ userId }: { userId: string }) {
  const [etapa, setEtapa] = useState<"parado" | "enviando" | "analisando">("parado");
  const [erro, setErro] = useState<string | null>(null);
  const enviando = etapa !== "parado";

  async function aoEnviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);

    const form = e.currentTarget;
    const dados = new FormData(form);
    const arquivo = dados.get("arquivo") as File | null;
    const arquivoCotacao = dados.get("arquivo_cotacao") as File | null;
    dados.delete("arquivo");
    dados.delete("arquivo_cotacao");

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

      setEtapa("analisando");
      await auditar(dados);
      // auditar() redireciona em caso de sucesso ou erro; se chegar aqui sem
      // redirecionar (não deveria), só destrava o botão.
      setEtapa("parado");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao enviar os arquivos.");
      setEtapa("parado");
    }
  }

  return (
    <form onSubmit={aoEnviar} className="space-y-3">
      {erro && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>
      )}

      <div>
        <label className="text-sm text-gray-600">Cole o texto do contrato</label>
        <textarea
          name="texto"
          rows={8}
          placeholder="Cole aqui o texto completo do contrato de locação..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
        />
      </div>

      <p className="text-center text-sm text-gray-400">— ou —</p>

      <div>
        <label className="text-sm text-gray-600">Envie o arquivo do contrato (.docx ou .pdf)</label>
        <input
          name="arquivo"
          type="file"
          accept=".docx,.pdf"
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
        />
        <p className="mt-1 text-xs text-gray-500">
          Se enviar um arquivo, ele substitui o texto colado acima. PDFs escaneados (sem texto
          real) também funcionam — a IA lê direto das páginas do documento.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 p-3">
        <p className="mb-2 text-sm font-medium text-o2-navy">
          Cotação/proposta de seguro (opcional)
        </p>
        <p className="mb-2 text-xs text-gray-500">
          Se enviar, o Auditor confere se segurado, valor do aluguel, prazo e endereço batem
          entre o contrato e a cotação.
        </p>
        <input
          name="arquivo_cotacao"
          type="file"
          accept=".docx,.pdf"
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
        />
      </div>

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
