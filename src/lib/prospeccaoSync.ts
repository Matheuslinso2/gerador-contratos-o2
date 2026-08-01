import {
  listarPlanilhasDasPastas,
  idsDePastasDoEnv,
  ehPlanilhaMensalValida,
  encontrarAbaDeDados,
  encontrarAbaPorNome,
  lerLinhasComoObjetos,
  type PlanilhaDaPasta,
} from "@/lib/googleSheetsProspeccao";
import { pegarCampo, paraNumero, COLUNAS_INCENDIO, COLUNAS_FIANCA } from "@/lib/prospeccaoExtracao";
import { resolverEnderecoComCache, carregarCacheEnderecos, type CacheEnderecos } from "@/lib/geocoding";
import { recalcularEstatisticas, recalcularMetricasImobiliarias } from "@/lib/prospeccaoEstatisticas";
import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Quantos endereços de fiança sem cache podem ser geocodificados numa única
// sincronização — limita o tempo de uma execução; se sobrar backlog, a
// próxima chamada continua de onde parou.
const ORCAMENTO_GEOCODIFICACAO_POR_SYNC = 60;

// O servidor (Vercel) mata a execução depois de 60s — processar todas as
// planilhas de uma vez (principalmente numa ressincronização completa)
// estourava esse tempo. Processa só um lote pequeno por chamada; o cliente
// (BotaoSincronizar.tsx) chama de novo automaticamente até não sobrar nada,
// sem precisar de clique manual repetido.
const LIMITE_ARQUIVOS_POR_EXECUCAO = 10;

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
  arquivos_pendentes: number;
  linhas_gravadas: number;
  estatisticas_calculadas: number;
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
    aluguel: paraNumero(pegarCampo(linha, "ALUGUEL")),
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
  cacheEnderecos: CacheEnderecos,
  orcamentoGeocodificacao: { restante: number },
  erros: string[]
): Promise<number> {
  // Prioriza achar a aba pelo NOME ("Análises") — mais confiável do que
  // pontuar pelo cabeçalho quando o arquivo também tem uma aba de
  // carry-over do mês anterior com colunas parecidas. Planilhas anteriores
  // a out/2025 têm nomes de aba mais variáveis, por isso o fallback.
  const abaInfo =
    (await encontrarAbaPorNome(arquivo.id, ["analise"])) ?? (await encontrarAbaDeDados(arquivo.id, COLUNAS_FIANCA));
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
      const geo = await resolverEnderecoComCache(supabase, endereco, cacheEnderecos, orcamentoGeocodificacao);
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
      aluguel: paraNumero(pegarCampo(linha, "ALUGUEL")),
      // Confirmado com o Matheus: nessa aba o status sempre fica na coluna
      // B, mesmo quando não tem nome de cabeçalho reconhecível — por isso o
      // fallback posicional além da busca por nome.
      status: pegarCampo(linha, "STATUS", "SITUACAO") || linha["coluna_2"] || null,
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

// Aba "Renovações" do mesmo arquivo de fiança — fluxo separado (renovar uma
// fiança existente, não uma cotação nova), mas com estrutura parecida.
// Nunca inspecionei essa aba de verdade: os nomes de coluna abaixo são a
// melhor tentativa combinada com o Matheus, com fallback posicional pro
// status (coluna A, confirmado) — ajusto se a primeira sincronização vier
// vazia.
async function sincronizarArquivoRenovacao(
  supabase: SupabaseServerClient,
  arquivo: PlanilhaDaPasta,
  erros: string[]
): Promise<number> {
  const abaInfo = await encontrarAbaPorNome(arquivo.id, ["renovac"]);
  if (!abaInfo) return 0; // nem toda planilha tem essa aba — não é erro

  const linhas = await lerLinhasComoObjetos(arquivo.id, abaInfo.aba, abaInfo.cabecalho);

  const registros = linhas.map((linha) => ({
    tipo: "renovacao",
    arquivo_id: `${arquivo.id}-renovacao`,
    arquivo_nome: arquivo.nome,
    arquivo_modificado_em: arquivo.modificadoEm,
    imobiliaria: pegarCampo(linha, "IMOBILIARIA") || null,
    nome_pessoa: pegarCampo(linha, "LOCATARIO", "CLIENTE", "SEGURADO") || null,
    cidade: null,
    bairro: null,
    uf: null,
    premio: paraNumero(pegarCampo(linha, "PREMIO LIQUIDO", "PRÊMIO LÍQUIDO", "PREMIO")),
    aluguel: paraNumero(pegarCampo(linha, "ALUGUEL")),
    status: pegarCampo(linha, "STATUS", "SITUACAO") || linha["coluna_1"] || null,
    data_cotacao: pegarCampo(linha, "DATA RECEB", "DATA") || null,
    endereco: pegarCampo(linha, "ENDERECO").trim() || null,
  }));

  // Usa um arquivo_id derivado (não o mesmo da aba de Análises) pra não
  // apagar as linhas de fiança "normais" quando essa função roda.
  await supabase.from("cotacoes_cache").delete().eq("arquivo_id", `${arquivo.id}-renovacao`);
  if (registros.length) {
    const { error } = await supabase.from("cotacoes_cache").insert(registros);
    if (error) {
      erros.push(`Renovações "${arquivo.nome}": erro ao gravar — ${error.message}`);
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
export async function sincronizarPlanilhas(
  supabase: SupabaseServerClient,
  forcarTudo: boolean = false
): Promise<ResultadoSincronizacao> {
  const pastasIncendio = idsDePastasDoEnv(process.env.GOOGLE_FOLDER_ID_INCENDIO);
  const pastasFianca = idsDePastasDoEnv(process.env.GOOGLE_FOLDER_ID_FIANCA);

  const [arquivosIncendio, arquivosFianca, estadoAtual] = await Promise.all([
    pastasIncendio.length ? listarPlanilhasDasPastas(pastasIncendio) : Promise.resolve([]),
    pastasFianca.length ? listarPlanilhasDasPastas(pastasFianca) : Promise.resolve([]),
    buscarEstadoAtual(supabase),
  ]);

  const precisaSincronizar = (a: PlanilhaDaPasta) => {
    if (forcarTudo) return true;
    const jaSincronizado = estadoAtual.get(a.id);
    if (jaSincronizado === undefined) return true;
    if (!a.modificadoEm) return false;
    return !jaSincronizado || a.modificadoEm > jaSincronizado;
  };

  const incendioValidos = arquivosIncendio.filter((a) => ehPlanilhaMensalValida(a.nome));
  const fiancaValidos = arquivosFianca.filter((a) => ehPlanilhaMensalValida(a.nome));

  const incendioPendente = incendioValidos.filter(precisaSincronizar);
  const fiancaPendente = fiancaValidos.filter(precisaSincronizar);
  const totalPendente = incendioPendente.length + fiancaPendente.length;

  const jaAtualizados = incendioValidos.length + fiancaValidos.length - totalPendente;

  // Processa só os primeiros N arquivos pendentes nessa chamada (incêndio
  // primeiro, depois fiança) — o resto fica pra próxima chamada.
  const incendioParaSincronizar = incendioPendente.slice(0, LIMITE_ARQUIVOS_POR_EXECUCAO);
  const fiancaParaSincronizar = fiancaPendente.slice(
    0,
    Math.max(0, LIMITE_ARQUIVOS_POR_EXECUCAO - incendioParaSincronizar.length)
  );
  const arquivosPendentesDepois =
    totalPendente - incendioParaSincronizar.length - fiancaParaSincronizar.length;

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

  // Carrega o cache de geocodificação inteiro de uma vez (em vez de uma
  // consulta ao banco por cotação) — com milhares de linhas de fiança, o
  // custo de uma consulta por linha sozinho já estourava o tempo de execução.
  let linhasFianca = 0;
  if (fiancaParaSincronizar.length) {
    const cacheEnderecos = await carregarCacheEnderecos(supabase);
    const orcamentoGeocodificacao = { restante: ORCAMENTO_GEOCODIFICACAO_POR_SYNC };
    const resultadosFianca = await mapComLimite(fiancaParaSincronizar, 4, async (a) => {
      try {
        const n = await sincronizarArquivoFianca(supabase, a, cacheEnderecos, orcamentoGeocodificacao, erros);
        const nRenovacao = await sincronizarArquivoRenovacao(supabase, a, erros);
        arquivosProcessados.push(a.nome);
        return n + nRenovacao;
      } catch (e) {
        erros.push(`Fiança "${a.nome}": ${e instanceof Error ? e.message : "erro desconhecido"}`);
        return 0;
      }
    });
    linhasFianca = resultadosFianca.reduce((a, b) => a + b, 0);
  }
  linhasGravadas += linhasFianca;

  // Só recalcula as estatísticas prontas (bairro/região/cidade x faixa de
  // aluguel) quando essa foi a última leva pendente — recalcular a cada
  // lote parcial seria trabalho repetido à toa, e o objetivo é que essa
  // conta pesada só rode uma vez no fim, nunca na hora do relatório.
  let estatisticasCalculadas = 0;
  if (arquivosPendentesDepois === 0 && arquivosProcessados.length > 0) {
    try {
      estatisticasCalculadas = await recalcularEstatisticas(supabase);
    } catch (e) {
      erros.push(`Falha ao recalcular estatísticas: ${e instanceof Error ? e.message : "erro desconhecido"}`);
    }
    try {
      await recalcularMetricasImobiliarias(supabase);
    } catch (e) {
      erros.push(`Falha ao recalcular métricas por imobiliária: ${e instanceof Error ? e.message : "erro desconhecido"}`);
    }
  }

  return {
    arquivos_processados: arquivosProcessados,
    arquivos_ja_atualizados: jaAtualizados,
    arquivos_pendentes: arquivosPendentesDepois,
    linhas_gravadas: linhasGravadas,
    estatisticas_calculadas: estatisticasCalculadas,
    erros,
  };
}
