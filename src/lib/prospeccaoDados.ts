import {
  listarPlanilhasDasPastas,
  idsDePastasDoEnv,
  ehPlanilhaMensalValida,
  encontrarAbaDeDados,
  lerLinhasComoObjetos,
  textoCorresponde,
  normalizarTextoBusca,
} from "@/lib/googleSheetsProspeccao";
import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const COLUNAS_INCENDIO = ["IMOBILIARIA", "SEGURADO", "CIDADE", "ALUGUEL"];
const COLUNAS_FIANCA = ["ANALISTA", "LOCATARIO", "ENDERECO", "ALUGUEL"];

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
  observacao: string;
};

async function processarArquivoIncendio(
  arquivoId: string,
  nomeBusca: string,
  contagemCidade: Map<string, number>
): Promise<{ total: number; efetivadas: number; exemplos: ExemploCotacao[]; cidadeDaImobiliaria: string | null }> {
  const abaInfo = await encontrarAbaDeDados(arquivoId, COLUNAS_INCENDIO);
  if (!abaInfo) return { total: 0, efetivadas: 0, exemplos: [], cidadeDaImobiliaria: null };

  const linhas = await lerLinhasComoObjetos(arquivoId, abaInfo.aba, abaInfo.cabecalho);
  let efetivadas = 0;
  const exemplos: ExemploCotacao[] = [];
  let cidadeDaImobiliaria: string | null = null;

  for (const linha of linhas) {
    const cidade = pegarCampo(linha, "CIDADE").trim();
    if (cidade) contagemCidade.set(cidade, (contagemCidade.get(cidade) ?? 0) + 1);

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
  arquivoId: string,
  nomeBusca: string
): Promise<{ total: number; exemplos: ExemploCotacao[] }> {
  const abaInfo = await encontrarAbaDeDados(arquivoId, COLUNAS_FIANCA);
  if (!abaInfo) return { total: 0, exemplos: [] };

  const linhas = await lerLinhasComoObjetos(arquivoId, abaInfo.aba, abaInfo.cabecalho);
  const exemplos: ExemploCotacao[] = [];

  for (const linha of linhas) {
    // A coluna com o nome da imobiliária não tem cabeçalho nessa planilha —
    // é sempre a segunda coluna (logo após o nome de quem iniciou o
    // atendimento). lerLinhasComoObjetos nomeia colunas sem cabeçalho como
    // "coluna_N" pela posição.
    const imobiliaria = pegarCampo(linha, "IMOBILIARIA") || linha["coluna_2"] || "";
    if (!imobiliaria || !textoCorresponde(imobiliaria, nomeBusca)) continue;

    exemplos.push({
      data: pegarCampo(linha, "DATA RECEB"),
      nome: pegarCampo(linha, "LOCATARIO"),
      local: pegarCampo(linha, "ENDERECO"),
      status: "",
    });
  }

  return { total: exemplos.length, exemplos };
}

export async function buscarHistoricoEComparativo(
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

  const resultadosIncendio = await Promise.all(
    arquivosIncendioValidos.map((a) => processarArquivoIncendio(a.id, nomeImobiliaria, contagemCidade))
  );
  const resultadosFianca = await Promise.all(
    arquivosFiancaValidos.map((a) => processarArquivoFianca(a.id, nomeImobiliaria))
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
      observacao:
        "Comparativo regional disponível só para seguro incêndio — a planilha de fiança não tem uma coluna de cidade estruturada.",
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
