import "server-only";

import { chamarBitrix } from "./client";
import { createServiceClient } from "@/lib/supabase/service";

// Contrato anexado em COMENTÁRIO do card (05/11/2026): a equipe do Fiança anexa o contrato recebido num comentário
// ("CONTRATO RECEBIDO PORTO SEGURO TRADICIONAL…" + PDF), não só por e-mail. A auditoria automática do card lê daqui primeiro
// (o Gmail fica de reserva). Só leitura no Bitrix. Usada apenas pela rotina automática do card, não pelo Auditor das Ferramentas úteis.

export type ArquivoDeComentario = { id: number; nome: string; tamanho: number };
export type ComentarioComArquivos = { id: number; criadoEm: string; texto: string; arquivos: ArquivoDeComentario[] };

type ComentarioBruto = {
  ID: string | number;
  CREATED?: string;
  COMMENT?: string;
  FILES?: Record<string, { id: number | string; name?: string; size?: number | string }> | unknown[];
};

const BUCKET = "bitrix-cards-arquivos";

/** Comentários do card que têm arquivo, do mais antigo para o mais novo. */
export async function comentariosComArquivos(entityTypeId: number, itemId: number): Promise<ComentarioComArquivos[]> {
  const r = await chamarBitrix<{ result?: ComentarioBruto[] }>("crm.timeline.comment.list", {
    "filter[ENTITY_ID]": itemId,
    "filter[ENTITY_TYPE]": `dynamic_${entityTypeId}`,
    "order[ID]": "ASC",
  });
  const saida: ComentarioComArquivos[] = [];
  for (const c of r.result ?? []) {
    const files = c.FILES && !Array.isArray(c.FILES) ? Object.values(c.FILES) : [];
    const arquivos = files
      .map((f) => ({ id: Number(f.id), nome: String(f.name ?? ""), tamanho: Number(f.size ?? 0) }))
      .filter((f) => Number.isFinite(f.id) && f.id > 0 && f.nome);
    if (arquivos.length) saida.push({ id: Number(c.ID), criadoEm: String(c.CREATED ?? ""), texto: String(c.COMMENT ?? ""), arquivos });
  }
  return saida;
}

/**
 * Comentário em que a equipe anexou o contrato recebido: o mais recente cujo texto diz "contrato recebido"; sem ele, o mais recente
 * que cita "contrato" e não é um aviso de pendência ("PENDENTE CONTRATO ASSINADO…").
 */
export function comentarioDoContrato(comentarios: ComentarioComArquivos[]): ComentarioComArquivos | null {
  const maisNovoPrimeiro = [...comentarios].sort((a, b) => b.id - a.id);
  return (
    maisNovoPrimeiro.find((c) => /contrato\s+recebido/i.test(c.texto)) ??
    maisNovoPrimeiro.find((c) => /contrat/i.test(c.texto) && !/^\s*pend/i.test(c.texto)) ??
    null
  );
}

/**
 * Baixa o arquivo de um comentário. 1) webhook com acesso ao disco do Bitrix (BITRIX_WEBHOOK_URL_DISCO, ou o de tarefas quando
 * existir no ambiente); 2) cópia já capturada no Supabase (bucket bitrix-cards-arquivos). Sem nenhuma das duas, devolve null.
 */
export async function baixarArquivoDeComentario(fileId: number): Promise<Buffer | null> {
  const base = process.env.BITRIX_WEBHOOK_URL_DISCO ?? process.env.BITRIX_WEBHOOK_URL_TAREFAS;
  if (base) {
    try {
      const info = await fetch(`${base.endsWith("/") ? base : base + "/"}disk.file.get.json`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: fileId }),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      }).then((r) => r.json());
      const url = info?.result?.DOWNLOAD_URL as string | undefined;
      if (url) {
        const resposta = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
        if (resposta.ok) return Buffer.from(await resposta.arrayBuffer());
      }
    } catch (erro) {
      console.warn("Falha ao baixar arquivo do comentário pelo Bitrix:", erro);
    }
  }
  try {
    const sb = createServiceClient();
    const { data } = await sb.from("bitrix_card_arquivos").select("storage_path").eq("file_id", fileId).not("storage_path", "is", null).limit(1).maybeSingle();
    if (data?.storage_path) {
      const { data: arquivo } = await sb.storage.from(BUCKET).download(String(data.storage_path));
      if (arquivo) return Buffer.from(await arquivo.arrayBuffer());
    }
  } catch (erro) {
    console.warn("Falha ao ler a cópia do arquivo do comentário no Supabase:", erro);
  }
  return null;
}
