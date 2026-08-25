"use client";

import { useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { auditar } from "./actions";
import type { TipoDocumentoAuditoria } from "@/lib/auditorContrato";

const BUCKET_TEMP = "auditoria-temp";
const ACCEPT_ARQUIVOS = ".docx,.pdf,.png,.jpg,.jpeg,.webp,.gif";

const ROTULO_TIPO: Record<TipoDocumentoAuditoria, string> = {
  contrato: "Contrato/Aditivo",
  cotacao: "Cotação/Proposta",
  certificado: "Certificado de assinatura",
  outro: "Outro (contexto)",
};

type ItemDocumento = {
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
function adivinharTipo(nomeArquivo: string): TipoDocumentoAuditoria {
  const n = nomeArquivo.toLowerCase();
  if (/(cota[cç][aã]o|proposta)/.test(n)) return "cotacao";
  if (/(certificado|assinatura|clicksign|zapsign|d4sign|docusign)/.test(n)) return "certificado";
  if (/(vistoria|laudo)/.test(n)) return "outro";
  return "contrato";
}

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

function IconeRemover() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

// auditar() redireciona pra esta mesma rota (?ultimo=<id>) em vez de
// desmontar o componente, então nada reseta sozinho depois de uma
// auditoria concluída. Em vez de tentar limpar tudo manualmente, o
// AuditorForm troca a key do formulário a cada novo ultimoId -- isso
// desmonta e remonta a árvore inteira, que é o jeito recomendado pelo
// React de "resetar tudo quando algo muda": todo useState volta ao
// valor inicial.
export default function AuditorForm({ userId, ultimoId }: { userId: string; ultimoId?: string }) {
  return <Formulario key={ultimoId ?? "inicial"} userId={userId} sucessoInicial={Boolean(ultimoId)} />;
}

function LinhaDocumento({
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

function Formulario({ userId, sucessoInicial }: { userId: string; sucessoInicial: boolean }) {
  const [etapa, setEtapa] = useState<"parado" | "enviando" | "analisando">("parado");
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(sucessoInicial);
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

  async function aoEnviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setSucesso(false);

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
          const path = await enviarArquivo(supabase, userId, item.arquivo);
          dados.set(`doc_${i}_path`, path);
          dados.set(`doc_${i}_nome`, item.arquivo.name);
        } else {
          dados.set(`doc_${i}_texto`, item.texto ?? "");
        }
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
      {sucesso && (
        <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">
          ✅ Contrato analisado — veja o resultado na lista abaixo. Ambiente pronto para uma nova auditoria.
        </p>
      )}
      {erro && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>
      )}

      <div className="rounded-lg border border-gray-200 p-3">
        <p className="mb-1 text-sm font-medium text-o2-navy">Documentos</p>
        <p className="mb-2 text-xs text-gray-500">
          Adicione todos os documentos de uma vez (contrato, aditivo, cotação, certificado de assinatura etc.) — a IA lê
          cada um pelo papel indicado ao lado. Pode ser mais de um arquivo com o mesmo papel, por exemplo contrato
          original + aditivo.
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

      <button
        type="submit"
        disabled={enviando}
        className="rounded-full bg-o2-coral px-6 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {etapa === "enviando" && "Enviando arquivos..."}
        {etapa === "analisando" && "Analisando... (pode levar alguns minutos com vários documentos anexados)"}
        {etapa === "parado" && "Analisar contrato"}
      </button>
    </form>
  );
}
