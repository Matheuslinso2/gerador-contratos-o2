import {
  listarPlanilhasDasPastas,
  idsDePastasDoEnv,
  ehPlanilhaMensalValida,
  encontrarAbaDeDados,
  lerLinhasComoObjetos,
  type PlanilhaDaPasta,
} from "@/lib/googleSheetsProspeccao";
import { pegarCampo, paraNumero, COLUNAS_INCENDIO, COLUNAS_FIANCA } from "@/lib/prospeccaoExtracao";
import { resolverEnderecoComCache } from "@/lib/geocoding";
import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Quantos endereços de fiança sem cache podem ser geocodificados numa única
// sincronização — limita o tempo de uma execução; se sobrar backlog, o
// próximo clique em "sincronizar" continua de onde parou.
const ORCAMENTO_GEOCODIFICACAO_POR_SYNC = 60;

async function mapComLimite<T, R>(itens: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(itens.length);
  let indice = 0;
  async function worker() {
    while (indice < itens.length) {
      const i = indice++;
      resultados[i] = await fn(itens[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, worker));
  return resultados;
}

export type ResultadoSincronizacao = {
  arquivos_processados: string[];
  arquivos_ja_atualizados: number;
  linhas_gravadas: number;
  erros: string[];
};

// Planilhas já sincronizadas (arquivo_id -> data de modificação já
// processada), pra saber quais arquivos são novos ou mudaram desde a
// última sincronização.
async function buscarEstadoAtual(supabase: SupabaseServerClient): Promise<Map<string, string | null>> {
  const estado = new Map<string, string | null>();
  const { data } = await supabase.from("cotacoes_cache").select("arquivo_id, arquivo_modificado_em");
  for (const linha of data ?? []) {
    const atual = estado.get(linha.arquivo_id);
    if (!atual || (linha.arquivo_modificado_em && linha.arquivo_modificado_em > atual)) {
      estado.set(linha.arquivo_id, linha.arquivo_modificado_em);
    }
  }
  return estado;
}

async function sincronizarArquivoIncendio(
  supabase: SupabaseServerClient,
  arquivo: PlanilhaDaPasta,
  erros: string[]
): Promise<number> {
  const abaInfo = await encontrarAbaDeDados(arquivo.id, COLUNAS_INCENDIO);
  if (!abaInfo) {
    erros.push(`Incêndio "${arquivo.nome}": nenhuma aba com colunas reconhecidas.`);
    return 0;
  }
  const linhas = await lerLinhasComoObjetos(arquivo.id, abaInfo.aba, abaInfo.cabecalho);

  const registros = linhas.map((linha) => ({
    tipo: "incendio",
    arquivo_id: arquivo.id,
    arquivo_nome: arquivo.nome,
    arquivo_modificado_em: arquivo.modificadoEm,
    imobiliaria: pegarCampo(linha, "IMOBILIARIA") || null,
    nome_pessoa: pegarCampo(linha, "SEGURADO") || null,
    cidade: pegarCampo(linha, "CIDADE").trim() || null,
    bairro: pegarCampo(linha, "BAIRRO").trim() || null,
    uf: null,
    premio: paraNumero(pegarCampo(linha, "PRÊM. TOTAL", "PREM TOTAL", "PREMIO TOTAL")),
    status: pegarCampo(linha, "STATUS") || null,
    data_cotacao: pegarCampo(linha, "DT RECEBIDA", "DATA RECEB") || null,
    endereco: null,
  }));

  await supabase.from("cotacoes_cache").delete().eq("arquivo_id", arquivo.id);
  if (registros.length) {
    const { error } = await supabase.from("cotacoes_cache").insert(registros);
    if (error) {
      erros.push(`Incêndio "${arquivo.nome}": erro ao gravar — ${error.message}`);
      return 0;
    }
  }
  return registros.length;
}

async function sincronizarArquivoFianca(
  supabase: SupabaseServerClient,
  arquivo: PlanilhaDaPasta,
  orcamentoGeocodificacao: { restante: number },
  erros: string[]
): Promise<number> {
  const abaInfo = await encontrarAbaDeDados(arquivo.id, COLUNAS_FIANCA);
  if (!abaInfo) {
    erros.push(`Fiança "${arquivo.nome}": nenhuma aba com colunas reconhecidas.`);
    return 0;
  }
  const linhas = await lerLinhasComoObjetos(arquivo.id, abaInfo.aba, abaInfo.cabecalho);

  const registros = [];
  for (const linha of linhas) {
    // A coluna com o nome da imobiliária não tem cabeçalho nessa planilha —
    // é sempre a segunda coluna (logo após o nome de quem iniciou o
    // atendimento).
    const imobiliaria = pegarCampo(linha, "IMOBILIARIA") || linha["coluna_2"] || null;
    const endereco = pegarCampo(linha, "ENDERECO").trim() || null;

    let cidade: string | null = null;
    let bairro: string | null = null;
    let uf: string | null = null;
    if (endereco) {
      const geo = await resolverEnderecoComCache(supabase, endereco, orcamentoGeocodificacao);
      cidade = geo?.cidade ?? null;
      bairro = geo?.bairro ?? null;
      uf = geo?.uf ?? null;
    }

    registros.push({
      tipo: "fianca",
      arquivo_id: arquivo.id,
      arquivo_nome: arquivo.nome,
      arquivo_modificado_em: arquivo.modificadoEm,
      imobiliaria,
      nome_pessoa: pegarCampo(linha, "LOCATARIO") || null,
      cidade,
      bairro,
      uf,
      premio: paraNumero(pegarCampo(linha, "PREMIO LIQUIDO", "PRÊMIO LÍQUIDO")),
      status: null,
      data_cotacao: pegarCampo(linha, "DATA RECEB") || null,
      endereco,
    });
  }

  await supabase.from("cotacoes_cache").delete().eq("arquivo_id", arquivo.id);
  if (registros.length) {
    const { error } = await supabase.from("cotacoes_cache").insert(registros);
    if (error) {
      erros.push(`Fiança "${arquivo.nome}": erro ao gravar — ${error.message}`);
      return 0;
    }
  }
  return registros.length;
}

// Só reprocessa planilhas novas ou modificadas desde a última sincronização
// (compara a data de modificação do arquivo no Drive com a que está
// gravada no cache) — planilhas de meses fechados não mudam mais, então na
// prática só a planilha do mês corrente (e uma nova por mês) precisa ser
// relida a cada chamada.
export async function sincronizarPlanilhas(supabase: SupabaseServerClient): Promise<ResultadoSincronizacao> {
  const pastasIncendio = idsDePastasDoEnv(process.env.GOOGLE_FOLDER_ID_INCENDIO);
  const pastasFianca = idsDePastasDoEnv(process.env.GOOGLE_FOLDER_ID_FIANCA);

  const [arquivosIncendio, arquivosFianca, estadoAtual] = await Promise.all([
    pastasIncendio.length ? listarPlanilhasDasPastas(pastasIncendio) : Promise.resolve([]),
    pastasFianca.length ? listarPlanilhasDasPastas(pastasFianca) : Promise.resolve([]),
    buscarEstadoAtual(supabase),
  ]);

  const precisaSincronizar = (a: PlanilhaDaPasta) => {
    const jaSincronizado = estadoAtual.get(a.id);
    if (jaSincronizado === undefined) return true;
    if (!a.modificadoEm) return false;
    return !jaSincronizado || a.modificadoEm > jaSincronizado;
  };

  const incendioValidos = arquivosIncendio.filter((a) => ehPlanilhaMensalValida(a.nome));
  const fiancaValidos = arquivosFianca.filter((a) => ehPlanilhaMensalValida(a.nome));

  const incendioParaSincronizar = incendioValidos.filter(precisaSincronizar);
  const fiancaParaSincronizar = fiancaValidos.filter(precisaSincronizar);

  const jaAtualizados =
    incendioValidos.length + fiancaValidos.length - incendioParaSincronizar.length - fiancaParaSincronizar.length;

  const erros: string[] = [];
  const arquivosProcessados: string[] = [];
  let linhasGravadas = 0;

  const resultadosIncendio = await mapComLimite(incendioParaSincronizar, 4, async (a) => {
    try {
      const n = await sincronizarArquivoIncendio(supabase, a, erros);
      arquivosProcessados.push(a.nome);
      return n;
    } catch (e) {
      erros.push(`Incêndio "${a.nome}": ${e instanceof Error ? e.message : "erro desconhecido"}`);
      return 0;
    }
  });
  linhasGravadas += resultadosIncendio.reduce((a, b) => a + b, 0);

  const orcamentoGeocodificacao = { restante: ORCAMENTO_GEOCODIFICACAO_POR_SYNC };
  const resultadosFianca = await mapComLimite(fiancaParaSincronizar, 4, async (a) => {
    try {
      const n = await sincronizarArquivoFianca(supabase, a, orcamentoGeocodificacao, erros);
      arquivosProcessados.push(a.nome);
      return n;
    } catch (e) {
      erros.push(`Fiança "${a.nome}": ${e instanceof Error ? e.message : "erro desconhecido"}`);
      return 0;
    }
  });
  linhasGravadas += resultadosFianca.reduce((a, b) => a + b, 0);

  return {
    arquivos_processados: arquivosProcessados,
    arquivos_ja_atualizados: jaAtualizados,
    linhas_gravadas: linhasGravadas,
    erros,
  };
}
