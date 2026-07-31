import { textoCorresponde } from "@/lib/googleSheetsProspeccao";
import { ehEfetivado } from "@/lib/prospeccaoExtracao";
import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

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

type LinhaCache = {
  imobiliaria: string | null;
  nome_pessoa: string | null;
  cidade: string | null;
  premio: number | null;
  status: string | null;
  data_cotacao: string | null;
  endereco: string | null;
};

// Lê do cache local (tabela cotacoes_cache, alimentada pela sincronização
// periódica com o Google Sheets — ver prospeccaoSync.ts) em vez de acessar
// o Google Sheets ao vivo a cada relatório. Rápido e sem risco de estourar
// o limite de requisições da API do Google.
export async function buscarHistoricoEComparativo(
  supabase: SupabaseServerClient,
  nomeImobiliaria: string
): Promise<{ historico: HistoricoCotacoes; regional: ComparativoRegional }> {
  const [{ data: incendioData }, { data: fiancaData }] = await Promise.all([
    supabase
      .from("cotacoes_cache")
      .select("imobiliaria, nome_pessoa, cidade, premio, status, data_cotacao, endereco")
      .eq("tipo", "incendio"),
    supabase
      .from("cotacoes_cache")
      .select("imobiliaria, nome_pessoa, cidade, premio, status, data_cotacao, endereco")
      .eq("tipo", "fianca"),
  ]);

  const incendio = (incendioData ?? []) as LinhaCache[];
  const fianca = (fiancaData ?? []) as LinhaCache[];

  const contagemCidade = new Map<string, number>();
  const ticketIncendioPorCidade = new Map<string, Acumulador>();
  const ticketIncendioGeral: Acumulador = { soma: 0, contagem: 0 };

  let incendioTotal = 0;
  let incendioEfetivadas = 0;
  let cidadeDaImobiliaria: string | null = null;
  const incendioExemplos: ExemploCotacao[] = [];

  for (const r of incendio) {
    if (r.cidade) contagemCidade.set(r.cidade, (contagemCidade.get(r.cidade) ?? 0) + 1);
    if (r.premio) {
      ticketIncendioGeral.soma += r.premio;
      ticketIncendioGeral.contagem += 1;
      if (r.cidade) somar(ticketIncendioPorCidade, r.cidade, r.premio);
    }

    if (!r.imobiliaria || !textoCorresponde(r.imobiliaria, nomeImobiliaria)) continue;

    incendioTotal++;
    if (ehEfetivado(r.status ?? "")) incendioEfetivadas++;
    if (r.cidade && !cidadeDaImobiliaria) cidadeDaImobiliaria = r.cidade;
    if (incendioExemplos.length < 10) {
      incendioExemplos.push({
        data: r.data_cotacao ?? "",
        nome: r.nome_pessoa ?? "",
        local: r.cidade ?? "",
        status: r.status ?? "",
      });
    }
  }

  const ticketFiancaPorCidade = new Map<string, Acumulador>();
  const ticketFiancaGeral: Acumulador = { soma: 0, contagem: 0 };
  let fiancaTotal = 0;
  const fiancaExemplos: ExemploCotacao[] = [];

  for (const r of fianca) {
    if (r.premio) {
      ticketFiancaGeral.soma += r.premio;
      ticketFiancaGeral.contagem += 1;
      if (r.cidade) somar(ticketFiancaPorCidade, r.cidade, r.premio);
    }

    if (!r.imobiliaria || !textoCorresponde(r.imobiliaria, nomeImobiliaria)) continue;

    fiancaTotal++;
    if (fiancaExemplos.length < 10) {
      fiancaExemplos.push({
        data: r.data_cotacao ?? "",
        nome: r.nome_pessoa ?? "",
        local: r.endereco ?? "",
        status: "",
      });
    }
  }

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
        "Dados calculados a partir da última sincronização com as planilhas do Google Sheets. Ticket médio de incêndio considera todas as cotações com valor preenchido, independente de terem sido efetivadas. Para fiança, a cidade é estimada por geocodificação do endereço.",
    },
  };
}

export type ImobiliariaConhecida = {
  nome: string;
  cnpj: string;
  cidade: string | null;
  uf: string | null;
  bairro: string | null;
  classificacao_crm: string | null;
  responsavel_crm: string | null;
  quantidade_imoveis: number | null;
};

// Nem toda cotação tem CNPJ da imobiliária — busca no registro interno
// (imobiliarias_conhecidas, alimentado a partir do cadastro de produtores
// da O2 e do CRM Bitrix24) pelo nome, pra sugerir o CNPJ, o bairro e os
// dados de CRM quando o colaborador não souber.
export async function buscarImobiliariaConhecida(
  supabase: SupabaseServerClient,
  nomeBusca: string
): Promise<ImobiliariaConhecida | null> {
  const { data } = await supabase
    .from("imobiliarias_conhecidas")
    .select("nome, cnpj, cidade, uf, bairro, classificacao_crm, responsavel_crm, quantidade_imoveis");
  if (!data) return null;

  const correspondencias = data.filter((r) => r.nome && textoCorresponde(r.nome, nomeBusca));
  if (correspondencias.length !== 1) return null;

  const [r] = correspondencias;
  return {
    nome: r.nome,
    cnpj: r.cnpj,
    cidade: r.cidade,
    uf: r.uf,
    bairro: r.bairro,
    classificacao_crm: r.classificacao_crm,
    responsavel_crm: r.responsavel_crm,
    quantidade_imoveis: r.quantidade_imoveis,
  };
}
