"use client";

import { useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { processarFaturaUpload } from "./actions";

const BUCKET_TEMP = "faturas-temp";

function mesAtualDefault(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

export default function UploadFaturaForm({ userId }: { userId: string }) {
  const [etapa, setEtapa] = useState<"parado" | "enviando" | "processando">("parado");
  const [erro, setErro] = useState<string | null>(null);
  const enviando = etapa !== "parado";

  async function aoEnviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);

    const form = e.currentTarget;
    const dados = new FormData(form);
    const arquivo = dados.get("arquivo") as File | null;
    dados.delete("arquivo");

    if (!arquivo || arquivo.size === 0) {
      setErro("Selecione um arquivo PDF.");
      return;
    }

    try {
      setEtapa("enviando");
      const supabase = createClient();
      const path = `${userId}/${crypto.randomUUID()}.pdf`;
      const { error } = await supabase.storage
        .from(BUCKET_TEMP)
        .upload(path, arquivo, { contentType: "application/pdf" });
      if (error) throw new Error(`Falha ao enviar "${arquivo.name}": ${error.message}`);

      dados.set("arquivo_path", path);
      dados.set("arquivo_nome", arquivo.name);

      setEtapa("processando");
      await processarFaturaUpload(dados);
      setEtapa("parado");
    } catch (e) {
      unstable_rethrow(e);
      setErro(e instanceof Error ? e.message : "Falha ao enviar o arquivo.");
      setEtapa("parado");
    }
  }

  return (
    <form onSubmit={aoEnviar} className="space-y-4">
      {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      <div>
        <label className="mb-1 block text-sm text-gray-600">Competência</label>
        <input
          name="competencia"
          type="month"
          required
          defaultValue={mesAtualDefault()}
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm text-gray-600">Arquivo da fatura (PDF)</label>
        <input
          name="arquivo"
          type="file"
          accept=".pdf"
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
        />
        <p className="mt-1 text-xs text-gray-500">
          O sistema tenta abrir automaticamente testando o CNPJ das imobiliárias já cadastradas
          como senha.
        </p>
      </div>

      <button
        type="submit"
        disabled={enviando}
        className="rounded-full bg-o2-coral px-6 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {etapa === "enviando" && "Enviando arquivo..."}
        {etapa === "processando" && "Processando... (pode levar até 1 minuto)"}
        {etapa === "parado" && "Enviar fatura"}
      </button>
    </form>
  );
}
