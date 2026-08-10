"use client";

import { useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { processarUploadProducao } from "./actions";
import { RAMOS_PRODUCAO } from "@/lib/producaoRamos";

const BUCKET_TEMP = "producao-temp";

export default function UploadProducaoForm({ userId }: { userId: string }) {
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
      setErro("Selecione o arquivo da grade de produção (.xlsx).");
      return;
    }

    try {
      setEtapa("enviando");
      const supabase = createClient();
      const path = `${userId}/${crypto.randomUUID()}.xlsx`;
      const { error } = await supabase.storage
        .from(BUCKET_TEMP)
        .upload(path, arquivo, { contentType: arquivo.type || "application/octet-stream" });
      if (error) throw new Error(`Falha ao enviar "${arquivo.name}": ${error.message}`);

      dados.set("arquivo_path", path);
      dados.set("arquivo_nome", arquivo.name);

      setEtapa("processando");
      await processarUploadProducao(dados);
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
        <label className="mb-1 block text-sm text-gray-600">Ramo dessa grade</label>
        <select
          name="ramo"
          required
          disabled={enviando}
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none disabled:bg-gray-50"
        >
          <option value="">Selecione...</option>
          {RAMOS_PRODUCAO.map((r) => (
            <option key={r.valor} value={r.valor}>
              {r.rotulo}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm text-gray-600">Arquivo da grade de produção (.xlsx)</label>
        <input
          name="arquivo"
          type="file"
          accept=".xlsx"
          required
          disabled={enviando}
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none disabled:bg-gray-50"
        />
        <p className="mt-1 text-xs text-gray-500">
          Exportado do CORP ("grade_prods"). Canceladas são descartadas automaticamente, e reenviar o
          mesmo arquivo não duplica nada — só atualiza.
        </p>
      </div>

      <button
        type="submit"
        disabled={enviando}
        className="rounded-full bg-o2-coral px-6 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {etapa === "enviando" && "Enviando arquivo..."}
        {etapa === "processando" && "Processando... (pode levar um pouco em grades grandes)"}
        {etapa === "parado" && "Processar grade"}
      </button>
    </form>
  );
}
