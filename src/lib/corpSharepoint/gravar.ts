import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lerCidades, lerDocumentos, lerGrade, lerSinistros, type CidadePadrao } from "./leitor";
import { analisesRecusas, metas, regrasProdutor, regrasRamo, regrasSeguradora, type ListaBruta } from "./listas";

// Grava no banco do Workspace o que o Power BI lê do SharePoint. Usado pelo
// cron (lendo direto do SharePoint) e pelo script de carga local (arquivos
// baixados). Só service_role — as tabelas corp_* não aceitam escrita de tela.

export type TipoArquivo = "grade" | "sinistros" | "clientes" | "cidades";
export type ArquivoCorp = {
  tipo: TipoArquivo;
  nome: string;
  pasta?: string | null;
  origem: "sharepoint" | "arquivo_local";
  modificadoEm?: string | null;
  etag?: string | null;
  conteudo: Uint8Array;
};
export type ResultadoArquivo = { id: string; nome: string; status: "importado" | "sem_mudanca"; linhas?: number };

const LOTE = 2000;

function idArquivo(a: Pick<ArquivoCorp, "tipo" | "nome">) {
  return `${a.tipo}:${a.nome}`;
}

async function emLotes<T>(itens: T[], fn: (lote: T[]) => Promise<void>) {
  for (let i = 0; i < itens.length; i += LOTE) await fn(itens.slice(i, i + LOTE));
}

function checar(error: { message: string } | null, contexto: string) {
  if (error) throw new Error(`${contexto}: ${error.message}`);
}

async function registrarArquivo(sb: SupabaseClient, a: ArquivoCorp, md5: string, linhas: number) {
  const { error } = await sb.from("corp_sp_arquivos").upsert({
    id: idArquivo(a), tipo: a.tipo, nome: a.nome, pasta: a.pasta ?? null, origem: a.origem,
    sp_modificado_em: a.modificadoEm ?? null, sp_etag: a.etag ?? null, tamanho_bytes: a.conteudo.byteLength,
    md5, linhas, importado_em: new Date().toISOString(),
  });
  checar(error, `registrar ${a.nome}`);
}

async function jaImportado(sb: SupabaseClient, a: ArquivoCorp, md5: string) {
  const { data, error } = await sb.from("corp_sp_arquivos").select("md5").eq("id", idArquivo(a)).maybeSingle();
  checar(error, `consultar ${a.nome}`);
  return data?.md5 === md5;
}

async function cidadesPadrao(sb: SupabaseClient): Promise<CidadePadrao[]> {
  const { data, error } = await sb.from("corp_cidade_padrao").select("uf_cidade_corp, uf, cidade");
  checar(error, "ler cidades padronizadas");
  return data ?? [];
}

// Importa um arquivo (se mudou). A ordem certa num lote é: cidades → clientes → grade → sinistros.
export async function importarArquivo(sb: SupabaseClient, a: ArquivoCorp, forcar = false): Promise<ResultadoArquivo> {
  const id = idArquivo(a);
  const md5 = createHash("md5").update(a.conteudo).digest("hex");
  if (!forcar && (await jaImportado(sb, a, md5))) return { id, nome: a.nome, status: "sem_mudanca" };

  if (a.tipo === "cidades") {
    const cidades = lerCidades(a.conteudo);
    await registrarArquivo(sb, a, md5, cidades.length);
    await emLotes(cidades, async (l) => checar((await sb.from("corp_cidade_padrao").upsert(l)).error, "gravar cidades"));
    return { id, nome: a.nome, status: "importado", linhas: cidades.length };
  }

  if (a.tipo === "clientes") {
    const docs = lerDocumentos(a.conteudo, await cidadesPadrao(sb));
    await registrarArquivo(sb, a, md5, docs.length);
    // Só grava o que mudou (a planilha é grande e é substituída inteira a cada atualização).
    const atuais = new Map<number, string>();
    for (let de = 0; ; de += 10000) {
      const { data, error } = await sb.from("corp_documentos").select("nosso_numero, tipo_doc, uf, cidade, arquivo_id")
        .order("nosso_numero").range(de, de + 9999);
      checar(error, "ler documentos atuais");
      for (const d of data ?? []) atuais.set(Number(d.nosso_numero), `${d.tipo_doc}|${d.uf}|${d.cidade}|${d.arquivo_id}`);
      if (!data || data.length < 10000) break;
    }
    const mudou = docs
      .map((d) => ({ ...d, arquivo_id: id }))
      .filter((d) => atuais.get(d.nosso_numero) !== `${d.tipo_doc}|${d.uf}|${d.cidade}|${id}`);
    await emLotes(mudou, async (l) => checar((await sb.from("corp_documentos").upsert(l)).error, "gravar documentos"));
    return { id, nome: a.nome, status: "importado", linhas: docs.length };
  }

  if (a.tipo === "grade") {
    const linhas = lerGrade(a.conteudo).map((l) => ({ ...l, arquivo_id: id }));
    await registrarArquivo(sb, a, md5, linhas.length);
    checar((await sb.from("corp_grade").delete().eq("arquivo_id", id)).error, `apagar linhas antigas de ${a.nome}`);
    await emLotes(linhas, async (l) => checar((await sb.from("corp_grade").insert(l)).error, `gravar ${a.nome}`));
    return { id, nome: a.nome, status: "importado", linhas: linhas.length };
  }

  const linhas = lerSinistros(a.conteudo).map((l) => ({ ...l, arquivo_id: id }));
  await registrarArquivo(sb, a, md5, linhas.length);
  checar((await sb.from("corp_sinistros").delete().eq("arquivo_id", id)).error, `apagar linhas antigas de ${a.nome}`);
  await emLotes(linhas, async (l) => checar((await sb.from("corp_sinistros").insert(l)).error, `gravar ${a.nome}`));
  return { id, nome: a.nome, status: "importado", linhas: linhas.length };
}

export type ListasCorp = {
  produtores: ListaBruta;
  ramos: ListaBruta;
  seguradoras: ListaBruta;
  metas: ListaBruta;
  analises: ListaBruta;
};

// Espelha as listas de regras. Produtor/ramo/seguradora que saiu da lista sai daqui também.
export async function sincronizarListas(sb: SupabaseClient, l: ListasCorp) {
  const agora = new Date().toISOString();
  const espelhar = async (tabela: string, chave: string, linhas: Record<string, unknown>[]) => {
    if (!linhas.length) throw new Error(`lista de ${tabela} veio vazia — nada alterado`);
    await emLotes(linhas.map((x) => ({ ...x, sincronizado_em: agora })), async (lote) =>
      checar((await sb.from(tabela).upsert(lote)).error, `gravar ${tabela}`));
    checar((await sb.from(tabela).delete().lt("sincronizado_em", agora)).error, `limpar ${tabela}`);
    return linhas.length;
  };
  return {
    produtores: await espelhar("corp_regra_produtor", "produtor", regrasProdutor(l.produtores)),
    ramos: await espelhar("corp_regra_ramo", "id_ramo", regrasRamo(l.ramos)),
    seguradoras: await espelhar("corp_regra_seguradora", "id_seguradora", regrasSeguradora(l.seguradoras)),
    metas: await espelhar("corp_meta_comissao", "agrupamento_flash,mes", metas(l.metas)),
    analises: await espelhar("corp_analise_recusado", "data_atualizacao,ramo", analisesRecusas(l.analises)),
  };
}

// Depois de importar: reaplica a regra de deduplicação, atualiza os retratos
// mensais e regera as telas prontas (corp_painel_pronto, ~20 s) — o site só
// lê essas telas quando não há filtro. Regera todas porque uma regra do
// cadastro (centralizador, ramo…) pode ter mudado mesmo sem arquivo novo.
export async function finalizarImportacao(sb: SupabaseClient, arquivoId: string | null) {
  const dedup = await sb.rpc("corp_marcar_deduplicacao");
  checar(dedup.error, "deduplicação");
  const retratos = await sb.rpc("corp_atualizar_retratos", { p_arquivo_id: arquivoId });
  checar(retratos.error, "retratos mensais");
  const telas = await sb.rpc("corp_gerar_telas_prontas", { p_desde: null });
  checar(telas.error, "telas prontas");
  return { deduplicacao: dedup.data, retratos: retratos.data, telas: telas.data };
}
