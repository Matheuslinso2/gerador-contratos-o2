import {
  listarPlanilhasDasPastas,
  idsDePastasDoEnv,
  ehPlanilhaMensalValida,
  encontrarAbaDeDados,
  lerLinhasComoObjetos,
  textoCorresponde,
  normalizarTextoBusca,
} from "@/lib/googleSheetsProspeccao";
import { resolverEnderecoComCache } from "@/lib/geocoding";
import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const COLUNAS_INCENDIO = ["IMOBILIARIA", "SEGURADO", "CIDADE", "ALUGUEL"];
const COLUNAS_FIANCA = ["ANALISTA", "LOCATARIO", "ENDERECO", "ALUGUEL"];

// Quantos endereços de fiança sem cache podem ser geocodificados numa única
// geração de relatório — limita o tempo/custo, o resto do histórico vai
// sendo preenchido aos poucos em gerações futuras.
const ORCAMENTO_GEOCODIFICACAO_POR_RELATORIO = 30;

function pegarCampo(linha: Record<string, string>, ...nomesPossiveis: string[]): string {
  const chaves = Object.keys(linha);
  for (const nome of nomesPossiveis) {
    const alvo = normalizarTextoBusca(nome);
    const chave = chaves.find((k) => normalizarTextoBusca(k).includes(alvo));
    if (chave && linha[chave]) return linha[chave];
  }
  return "";
}

function ehEfetivado(status: string): boolean {
  const s = normalizarTextoBusca(status);
  return s.includes("efetivado") && !s.includes("nao");
}

// Converte "R$ 2.370,00" / "778,97" (formato brasileiro) em número.
function paraNumero(valor: string): number | null {
  const limpo = valor
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const n = parseFloat(limpo);
  return Number.isFinite(n) && n > 0 ? n : null;
}

type Acumulador = { soma: number; contagem: number };

function somar(mapa: Map<string, Acumulador>, chave: string, valor: number) {
  const atual = mapa.get(chave) ?? { soma: 0, contagem: 0 };
  atual.soma += valor;
  atual.contagem += 1;
  mapa.set(chave, atual);
}

function media(acc: Acumulador): number | null {
  return acc.contagem > 0 ? Math.round((acc.soma / acc.contagem) * 100) / 100 : null;
}

// A API do Google Sheets tem limite de requisições por minuto por usuário —
// disparar todas as ~30 planilhas ao mesmo tempo estoura esse limite.
// Processa só algumas por vez.
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

export type ExemploCotacao = { data: string; nome: string; local: string; status: string };

export type HistoricoCotacoes = {
  incendio_total_encontradas: number;
  incendio_efetivadas: number;
  incendio_exemplos: ExemploCotacao[];
  fianca_total_encontradas: number;
  fianca_exemplos: ExemploCotacao[];
};

export type ComparativoRegional = {
  cidade_da_imobiliaria: string | null;
  cotacoes_incendio_na_mesma_cidade: number;
  cidade_com_mais_cotacoes: string | null;
  cotacoes_na_cidade_mais_frequente: number;
  total_cotacoes_incendio_analisadas: number;
  ticket_medio_incendio_geral: number | null;
  ticket_medio_incendio_na_cidade: number | null;
  ticket_medio_fianca_geral: number | null;
  ticket_medio_fianca_na_cidade: number | null;
  observacao: string;
};

async function processarArquivoIncendio(
  arquivoId: string,
  nomeArquivo: string,
  nomeBusca: string,
  contagemCidade: Map<string, number>,
  ticketPorCidade: Map<string, Acumulador>,
  ticketGeral: Acumulador
): Promise<{ total: number; efetivadas: number; exemplos: ExemploCotacao[]; cidadeDaImobiliaria: string | null }> {
  let abaInfo;
  try {
    abaInfo = await encontrarAbaDeDados(arquivoId, COLUNAS_INCENDIO);
  } catch (e) {
    console.error(`[prospeccao] falha ao ler planilha de incêndio "${nomeArquivo}":`, e);
    return { total: 0, efetivadas: 0, exemplos: [], cidadeDaImobiliaria: null };
  }
  if (!abaInfo) return { total: 0, efetivadas: 0, exemplos: [], cidadeDaImobiliaria: null };

  let linhas;
  try {
    linhas = await lerLinhasComoObjetos(arquivoId, abaInfo.aba, abaInfo.cabecalho);
  } catch (e) {
    console.error(`[prospeccao] falha ao ler linhas de "${nomeArquivo}":`, e);
    return { total: 0, efetivadas: 0, exemplos: [], cidadeDaImobiliaria: null };
  }
  let efetivadas = 0;
  const exemplos: ExemploCotacao[] = [];
  let cidadeDaImobiliaria: string | null = null;

  for (const linha of linhas) {
    const cidade = pegarCampo(linha, "CIDADE").trim();
    if (cidade) contagemCidade.set(cidade, (contagemCidade.get(cidade) ?? 0) + 1);

    const premio = paraNumero(pegarCampo(linha, "PRÊM. TOTAL", "PREM TOTAL", "PREMIO TOTAL"));
    if (premio) {
      ticketGeral.soma += premio;
      ticketGeral.contagem += 1;
      if (cidade) somar(ticketPorCidade, cidade, premio);
    }

    const imobiliaria = pegarCampo(linha, "IMOBILIARIA");
    if (!imobiliaria || !textoCorresponde(imobiliaria, nomeBusca)) continue;

    const status = pegarCampo(linha, "STATUS");
    if (ehEfetivado(status)) efetivadas++;
    if (cidade && !cidadeDaImobiliaria) cidadeDaImobiliaria = cidade;
    exemplos.push({
      data: pegarCampo(linha, "DT RECEBIDA", "DATA RECEB"),
      nome: pegarCampo(linha, "SEGURADO"),
      local: cidade,
      status,
    });
  }

  return { total: exemplos.length, efetivadas, exemplos, cidadeDaImobiliaria };
}

async function processarArquivoFianca(
  supabase: SupabaseServerClient,
  arquivoId: string,
  nomeArquivo: string,
  nomeBusca: string,
  ticketPorCidade: Map<string, Acumulador>,
  ticketGeral: Acumulador,
  orcamentoGeocodificacao: { restante: number }
): Promise<{ total: number; exemplos: ExemploCotacao[] }> {
  let abaInfo;
  try {
    abaInfo = await encontrarAbaDeDados(arquivoId, COLUNAS_FIANCA);
  } catch (e) {
    console.error(`[prospeccao] falha ao ler planilha de fiança "${nomeArquivo}":`, e);
    return { total: 0, exemplos: [] };
  }
  if (!abaInfo) {
    console.error(`[prospeccao][fianca] "${nomeArquivo}": nenhuma aba com colunas reconhecidas.`);
    return { total: 0, exemplos: [] };
  }

  let linhas;
  try {
    linhas = await lerLinhasComoObjetos(arquivoId, abaInfo.aba, abaInfo.cabecalho);
  } catch (e) {
    console.error(`[prospeccao] falha ao ler linhas de "${nomeArquivo}":`, e);
    return { total: 0, exemplos: [] };
  }
  const exemplos: ExemploCotacao[] = [];

  console.error(
    `[prospeccao][fianca] "${nomeArquivo}" aba="${abaInfo.aba}" linhas=${linhas.length} amostraImobiliaria=${JSON.stringify(
      linhas.slice(0, 3).map((l) => l["coluna_2"] ?? l["IMOBILIARIA"] ?? Object.values(l)[1])
    )}`
  );

  for (const linha of linhas) {
    // A coluna com o nome da imobiliária não tem cabeçalho nessa planilha —
    // é sempre a segunda coluna (logo após o nome de quem iniciou o
    // atendimento). lerLinhasComoObjetos nomeia colunas sem cabeçalho como
    // "coluna_N" pela posição.
    const imobiliaria = pegarCampo(linha, "IMOBILIARIA") || linha["coluna_2"] || "";

    const premio = paraNumero(pegarCampo(linha, "PREMIO LIQUIDO", "PRÊMIO LÍQUIDO"));
    const endereco = pegarCampo(linha, "ENDERECO").trim();
    if (premio) {
      ticketGeral.soma += premio;
      ticketGeral.contagem += 1;
      if (endereco) {
        const geo = await resolverEnderecoComCache(supabase, endereco, orcamentoGeocodificacao);
        if (geo?.cidade) somar(ticketPorCidade, geo.cidade, premio);
      }
    }

    if (!imobiliaria || !textoCorresponde(imobiliaria, nomeBusca)) continue;

    exemplos.push({
      data: pegarCampo(linha, "DATA RECEB"),
      nome: pegarCampo(linha, "LOCATARIO"),
      local: endereco,
      status: "",
    });
  }

  return { total: exemplos.length, exemplos };
}

export async function buscarHistoricoEComparativo(
  supabase: SupabaseServerClient,
  nomeImobiliaria: string
): Promise<{ historico: HistoricoCotacoes; regional: ComparativoRegional }> {
  const pastasIncendio = idsDePastasDoEnv(process.env.GOOGLE_FOLDER_ID_INCENDIO);
  const pastasFianca = idsDePastasDoEnv(process.env.GOOGLE_FOLDER_ID_FIANCA);

  const [arquivosIncendio, arquivosFianca] = await Promise.all([
    pastasIncendio.length ? listarPlanilhasDasPastas(pastasIncendio) : Promise.resolve([]),
    pastasFianca.length ? listarPlanilhasDasPastas(pastasFianca) : Promise.resolve([]),
  ]);

  const arquivosIncendioValidos = arquivosIncendio.filter((a) => ehPlanilhaMensalValida(a.nome));
  const arquivosFiancaValidos = arquivosFianca.filter((a) => ehPlanilhaMensalValida(a.nome));

  const contagemCidade = new Map<string, number>();
  const ticketIncendioPorCidade = new Map<string, Acumulador>();
  const ticketIncendioGeral: Acumulador = { soma: 0, contagem: 0 };
  const ticketFiancaPorCidade = new Map<string, Acumulador>();
  const ticketFiancaGeral: Acumulador = { soma: 0, contagem: 0 };
  const orcamentoGeocodificacao = { restante: ORCAMENTO_GEOCODIFICACAO_POR_RELATORIO };

  const resultadosIncendio = await mapComLimite(arquivosIncendioValidos, 4, (a) =>
    processarArquivoIncendio(a.id, a.nome, nomeImobiliaria, contagemCidade, ticketIncendioPorCidade, ticketIncendioGeral)
  );
  const resultadosFianca = await mapComLimite(arquivosFiancaValidos, 4, (a) =>
    processarArquivoFianca(
      supabase,
      a.id,
      a.nome,
      nomeImobiliaria,
      ticketFiancaPorCidade,
      ticketFiancaGeral,
      orcamentoGeocodificacao
    )
  );

  const incendioTotal = resultadosIncendio.reduce((soma, r) => soma + r.total, 0);
  const incendioEfetivadas = resultadosIncendio.reduce((soma, r) => soma + r.efetivadas, 0);
  const incendioExemplos = resultadosIncendio.flatMap((r) => r.exemplos).slice(0, 10);
  const cidadeDaImobiliaria = resultadosIncendio.find((r) => r.cidadeDaImobiliaria)?.cidadeDaImobiliaria ?? null;

  const fiancaTotal = resultadosFianca.reduce((soma, r) => soma + r.total, 0);
  const fiancaExemplos = resultadosFianca.flatMap((r) => r.exemplos).slice(0, 10);

  let cidadeComMaisCotacoes: string | null = null;
  let maiorContagem = 0;
  for (const [cidade, contagem] of contagemCidade) {
    if (contagem > maiorContagem) {
      maiorContagem = contagem;
      cidadeComMaisCotacoes = cidade;
    }
  }

  const totalCotacoesGeral = Array.from(contagemCidade.values()).reduce((a, b) => a + b, 0);

  return {
    historico: {
      incendio_total_encontradas: incendioTotal,
      incendio_efetivadas: incendioEfetivadas,
      incendio_exemplos: incendioExemplos,
      fianca_total_encontradas: fiancaTotal,
      fianca_exemplos: fiancaExemplos,
    },
    regional: {
      cidade_da_imobiliaria: cidadeDaImobiliaria,
      cotacoes_incendio_na_mesma_cidade: cidadeDaImobiliaria ? contagemCidade.get(cidadeDaImobiliaria) ?? 0 : 0,
      cidade_com_mais_cotacoes: cidadeComMaisCotacoes,
      cotacoes_na_cidade_mais_frequente: maiorContagem,
      total_cotacoes_incendio_analisadas: totalCotacoesGeral,
      ticket_medio_incendio_geral: media(ticketIncendioGeral),
      ticket_medio_incendio_na_cidade: cidadeDaImobiliaria
        ? media(ticketIncendioPorCidade.get(cidadeDaImobiliaria) ?? { soma: 0, contagem: 0 })
        : null,
      ticket_medio_fianca_geral: media(ticketFiancaGeral),
      ticket_medio_fianca_na_cidade: cidadeDaImobiliaria
        ? media(ticketFiancaPorCidade.get(cidadeDaImobiliaria) ?? { soma: 0, contagem: 0 })
        : null,
      observacao:
        "Ticket médio de incêndio calculado sobre todas as cotações com valor preenchido (independente de terem sido efetivadas). Para fiança, a cidade é estimada a partir do endereço da cotação (Google Maps); cotações ainda não geocodificadas não entram na média por cidade.",
    },
  };
}

export type ImobiliariaConhecida = { nome: string; cnpj: string; cidade: string | null; uf: string | null };

// Nem toda cotação tem CNPJ da imobiliária — busca no registro interno
// (imobiliarias_conhecidas, alimentado a partir do cadastro de produtores
// da O2) pelo nome, pra sugerir o CNPJ quando o colaborador não souber.
export async function buscarImobiliariaConhecida(
  supabase: SupabaseServerClient,
  nomeBusca: string
): Promise<ImobiliariaConhecida | null> {
  const { data } = await supabase.from("imobiliarias_conhecidas").select("nome, cnpj, cidade, uf");
  if (!data) return null;

  const correspondencias = data.filter((r) => r.nome && textoCorresponde(r.nome, nomeBusca));
  if (correspondencias.length !== 1) return null;

  const [r] = correspondencias;
  return { nome: r.nome, cnpj: r.cnpj, cidade: r.cidade, uf: r.uf };
}
