"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { processarFaturaUpload, type ResultadoProcessamento } from "./actions";

const BUCKET_TEMP = "faturas-temp";

function mesAtualDefault(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

type ResultadoComEstado = ResultadoProcessamento & { estado: "pendente" | "processando" | "feito" };

export default function UploadFaturaForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultados, setResultados] = useState<ResultadoComEstado[]>([]);

  async function aoEnviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setResultados([]);

    const form = e.currentTarget;
    const competencia = (form.elements.namedItem("competencia") as HTMLInputElement).value;
    const inputArquivos = form.elements.namedItem("arquivos") as HTMLInputElement;
    const arquivos = Array.from(inputArquivos.files ?? []);

    if (!arquivos.length) {
      setErro("Selecione ao menos um arquivo PDF.");
      return;
    }

    setResultados(arquivos.map((a) => ({ ok: true, nomeArquivo: a.name, mensagem: "", estado: "pendente" })));
    setEnviando(true);
    const supabase = createClient();

    for (let i = 0; i < arquivos.length; i++) {
      const arquivo = arquivos[i];
      setResultados((prev) => prev.map((r, idx) => (idx === i ? { ...r, estado: "processando" } : r)));

      try {
        const extensao = arquivo.name.split(".").pop()?.toLowerCase() || "pdf";
        const path = `${userId}/${crypto.randomUUID()}.${extensao}`;
        const { error } = await supabase.storage
          .from(BUCKET_TEMP)
          .upload(path, arquivo, { contentType: arquivo.type || "application/octet-stream" });
        if (error) throw new Error(`Falha ao enviar: ${error.message}`);

        const dados = new FormData();
        dados.set("competencia", competencia);
        dados.set("arquivo_path", path);
        dados.set("arquivo_nome", arquivo.name);

        const resultado = await processarFaturaUpload(dados);
        setResultados((prev) => prev.map((r, idx) => (idx === i ? { ...resultado, estado: "feito" } : r)));
      } catch (e) {
        setResultados((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? { ok: false, nomeArquivo: arquivo.name, mensagem: e instanceof Error ? e.message : "Falha inesperada.", estado: "feito" }
              : r
          )
        );
      }
    }

    setEnviando(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={aoEnviar} className="space-y-4">
        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        <div>
          <label className="mb-1 block text-sm text-gray-600">Competência</label>
          <input
            name="competencia"
            type="month"
            required
            defaultValue={mesAtualDefault()}
            disabled={enviando}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none disabled:bg-gray-50"
          />
          <p className="mt-1 text-xs text-gray-500">Vale pra todos os arquivos enviados juntos.</p>
        </div>

        <div>
          <label className="mb-1 block text-sm text-gray-600">Arquivos das faturas (PDF ou planilha)</label>
          <input
            name="arquivos"
            type="file"
            // Extensão sozinha (.xls/.xlsx) às vezes não é reconhecida pelo
            // seletor de arquivo nativo do Windows (associação de tipo MIME
            // menos padronizada que a de PDF) e o arquivo some da lista --
            // reforça com os MIME types explícitos, mais confiável.
            accept=".pdf,.xls,.xlsx,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            multiple
            required
            disabled={enviando}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none disabled:bg-gray-50"
          />
          <p className="mt-1 text-xs text-gray-500">
            Pode selecionar boleto e demonstrativo juntos, de várias imobiliárias de uma vez —
            o sistema identifica cada um e junta os dois automaticamente. Algumas seguradoras
            mandam o demonstrativo em planilha (.xls/.xlsx), aceito também.
          </p>
        </div>

        <button
          type="submit"
          disabled={enviando}
          className="rounded-full bg-o2-coral px-6 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {enviando ? "Processando..." : "Enviar faturas"}
        </button>
      </form>

      {!enviando && resultados.length > 0 && (
        <div className="rounded-lg border border-o2-navy/15 bg-o2-navy/5 p-3 text-sm text-o2-navy">
          {(() => {
            const STATUS_CONFERENCIA = ["duplicada", "aguardando_identificacao", "aguardando_origem", "aguardando_conferencia"];
            const falhas = resultados.filter((r) => !r.ok).length;
            const conferencia = resultados.filter((r) => r.ok && r.status && STATUS_CONFERENCIA.includes(r.status)).length;
            const prontas = resultados.length - falhas - conferencia;
            const partes = [
              prontas > 0 ? `${prontas} pronta(s) pra envio` : null,
              conferencia > 0 ? `${conferencia} foram pra conferência` : null,
              falhas > 0 ? `${falhas} com falha` : null,
            ].filter(Boolean);
            return `${resultados.length} arquivo(s) processado(s): ${partes.join(", ")}.`;
          })()}
        </div>
      )}

      {resultados.length > 0 && (
        <div className="space-y-2 rounded-lg border border-gray-200 p-3">
          {resultados.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-gray-800">{r.nomeArquivo}</span>
              <span
                className={
                  r.estado !== "feito"
                    ? "text-gray-400"
                    : r.ok
                      ? "text-green-700"
                      : "text-red-700"
                }
              >
                {r.estado === "pendente" && "Aguardando..."}
                {r.estado === "processando" && "Processando..."}
                {r.estado === "feito" && r.mensagem}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
