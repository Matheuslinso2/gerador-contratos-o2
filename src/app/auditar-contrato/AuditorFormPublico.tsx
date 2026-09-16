"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { auditarPublico } from "./actions";
import {
  BUCKET_TEMP,
  ACCEPT_ARQUIVOS,
  LinhaDocumento,
  IconeUpload,
  adivinharTipo,
  type ItemDocumento,
} from "./AuditorFormCompartilhado";
import type { RelatorioAuditoria, TipoDocumentoAuditoria } from "@/lib/auditorContrato";
import RelatorioView from "./RelatorioView";

// Upload público vai pro prefixo "publico/" do bucket (liberado pra role
// anon via supabase/schema_auditor_publico.sql) -- diferente do
// AuditorForm.tsx logado, que usa "${userId}/...".
async function enviarArquivoPublico(supabase: ReturnType<typeof createClient>, arquivo: File): Promise<string> {
  const ext = arquivo.name.split(".").pop() || "bin";
  const path = `publico/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET_TEMP).upload(path, arquivo, { contentType: arquivo.type });
  if (error) throw new Error(`Falha ao enviar "${arquivo.name}": ${error.message}`);
  return path;
}

// Diferente do AuditorForm.tsx (logado): auditarPublico() nunca redireciona,
// só devolve { ok, relatorio | erro } -- nada é salvo, então não tem
// "?ultimo=<id>" pra buscar depois. O relatório aparece direto nesta tela,
// via RelatorioView (mesmo componente que a versão logada usa).
export default function AuditorFormPublico({ restantes }: { restantes: number }) {
  const [etapa, setEtapa] = useState<"parado" | "enviando" | "analisando">("parado");
  const [erro, setErro] = useState<string | null>(null);
  const [relatorio, setRelatorio] = useState<RelatorioAuditoria | null>(null);
  const [itens, setItens] = useState<ItemDocumento[]>([]);
  const [colandoTexto, setColandoTexto] = useState(false);
  const [textoNovo, setTextoNovo] = useState("");
  const enviando = etapa !== "parado";

  function aoSelecionarArquivos(files: FileList | null) {
    if (!files || files.length === 0) return;
    const novos: ItemDocumento[] = Array.from(files).map((arquivo) => ({
      id: crypto.randomUUID(),
      tipo: adivinharTipo(arquivo.name),
      origem: "arquivo",
      arquivo,
    }));
    setItens((atual) => [...atual, ...novos]);
  }

  function adicionarTextoColado() {
    if (!textoNovo.trim()) return;
    setItens((atual) => [
      ...atual,
      { id: crypto.randomUUID(), tipo: "contrato", origem: "texto", texto: textoNovo.trim() },
    ]);
    setTextoNovo("");
    setColandoTexto(false);
  }

  function alterarTipo(id: string, tipo: TipoDocumentoAuditoria) {
    setItens((atual) => atual.map((it) => (it.id === id ? { ...it, tipo } : it)));
  }

  function remover(id: string) {
    setItens((atual) => atual.filter((it) => it.id !== id));
  }

  function novaAnalise() {
    setRelatorio(null);
    setItens([]);
    setErro(null);
  }

  async function aoEnviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);

    if (itens.length === 0) {
      setErro("Adicione pelo menos um documento (arquivo ou texto colado).");
      return;
    }

    try {
      setEtapa("enviando");
      const supabase = createClient();
      const dados = new FormData();
      dados.set("doc_count", String(itens.length));

      for (let i = 0; i < itens.length; i++) {
        const item = itens[i];
        dados.set(`doc_${i}_tipo`, item.tipo);
        if (item.origem === "arquivo" && item.arquivo) {
          const path = await enviarArquivoPublico(supabase, item.arquivo);
          dados.set(`doc_${i}_path`, path);
          dados.set(`doc_${i}_nome`, item.arquivo.name);
        } else {
          dados.set(`doc_${i}_texto`, item.texto ?? "");
        }
      }

      setEtapa("analisando");
      const resultado = await auditarPublico(dados);
      if (!resultado.ok) {
        setErro(resultado.erro);
        setEtapa("parado");
        return;
      }
      setRelatorio(resultado.relatorio);
      setEtapa("parado");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao enviar os arquivos.");
      setEtapa("parado");
    }
  }

  if (relatorio) {
    return (
      <div className="space-y-4">
        <RelatorioView relatorio={relatorio} />
        <button
          type="button"
          onClick={novaAnalise}
          className="rounded-full border border-o2-navy px-5 py-2 text-sm font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white"
        >
          Analisar outro contrato
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={aoEnviar} className="space-y-3">
      {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

      <div className="rounded-lg border border-gray-200 p-3">
        <p className="mb-1 text-sm font-medium text-o2-navy">Documentos</p>
        <p className="mb-2 text-xs text-gray-500">
          Adicione o contrato (arquivo ou texto colado). Também dá pra anexar cotação, certificado de assinatura etc. —
          indique o papel de cada um no seletor ao lado.
        </p>

        {itens.length > 0 && (
          <div className="mb-3 space-y-1.5">
            {itens.map((item) => (
              <LinhaDocumento key={item.id} item={item} onTipoChange={alterarTipo} onRemover={remover} />
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-o2-navy px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">
            <IconeUpload />
            Adicionar arquivos
            <input
              type="file"
              multiple
              accept={ACCEPT_ARQUIVOS}
              className="sr-only"
              onChange={(e) => {
                aoSelecionarArquivos(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => setColandoTexto((v) => !v)}
            className="text-xs text-gray-500 hover:text-o2-coral"
          >
            ou cole o texto manualmente
          </button>
        </div>

        {colandoTexto && (
          <div className="mt-2 space-y-2">
            <textarea
              value={textoNovo}
              onChange={(e) => setTextoNovo(e.target.value)}
              rows={4}
              placeholder="Cole aqui o texto do documento..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-o2-coral focus:outline-none"
            />
            <button
              type="button"
              onClick={adicionarTextoColado}
              disabled={!textoNovo.trim()}
              className="rounded-full bg-gray-100 px-4 py-1.5 text-xs font-medium text-o2-navy transition hover:bg-gray-200 disabled:opacity-50"
            >
              Adicionar à lista
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={enviando}
          className="rounded-full bg-o2-coral px-6 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {etapa === "enviando" && "Enviando arquivos..."}
          {etapa === "analisando" && "Analisando... (pode levar alguns minutos)"}
          {etapa === "parado" && "Analisar contrato"}
        </button>
        <span className="text-xs text-gray-500">
          {restantes} {restantes === 1 ? "análise gratuita restante" : "análises gratuitas restantes"} neste endereço
        </span>
      </div>
    </form>
  );
}
