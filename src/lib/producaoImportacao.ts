import * as XLSX from "xlsx";

// Colunas exatas da "grade de produção" exportada do CORP -- confirmadas
// idênticas nos 7 arquivos de ramo diferentes recebidos. A coluna "Ramo"
// aparece 2x (código curto e nome completo) -- por isso a leitura é
// posicional (header:1), não por nome de chave, senão a 2ª ocorrência
// sobrescreveria a 1ª.
const COLUNAS = [
  "Codigo", "Agente", "Produtor", "CPF/CNPJ Produtor", "Filial", "Nosso Nº",
  "Seg.", "Ramo", "Nº Apólice", "Nº Endosso", "Cliente", "CPF/CNPJ Cliente",
  "Ini. Vig.", "Fim Vig.", "Parcs.", "Pr. Líquido", "Pr. Adicional", "Vl. Com.",
  "% Com.", "Vl. Com. Prod.", "% Com. Prod.", "Base Com. Corretora", "Pr. Total",
  "Seguradora", "Ramo", "Dt. Proposta", "Tipo", "Cancelado", "Canal Vendas",
] as const;

export type LinhaProducaoErp = {
  ramo: string;
  nosso_numero: string;
  seguradora: string;
  seguradora_codigo: string | null;
  produtor: string | null;
  produtor_cpf_cnpj: string | null;
  codigo_produtor: string | null;
  filial: string | null;
  numero_apolice: string | null;
  numero_endosso: string | null;
  cliente_nome: string | null;
  cliente_cpf_cnpj: string | null;
  inicio_vigencia: string | null;
  fim_vigencia: string | null;
  data_proposta: string | null;
  competencia: string | null;
  parcelas: number | null;
  premio_liquido: number | null;
  premio_adicional: number | null;
  premio_total: number | null;
  valor_comissao: number | null;
  percentual_comissao: number | null;
  valor_comissao_produtor: number | null;
  percentual_comissao_produtor: number | null;
  base_comissao_corretora: number | null;
  tipo: string | null;
  canal_vendas: string | null;
  arquivo_origem: string;
};

function idxColuna(nome: (typeof COLUNAS)[number], ocorrencia: number): number {
  let contadas = 0;
  for (let i = 0; i < COLUNAS.length; i++) {
    if (COLUNAS[i] === nome) {
      if (contadas === ocorrencia) return i;
      contadas++;
    }
  }
  return -1;
}

const IDX = {
  codigo: idxColuna("Codigo", 0),
  produtor: idxColuna("Produtor", 0),
  produtorCpfCnpj: idxColuna("CPF/CNPJ Produtor", 0),
  filial: idxColuna("Filial", 0),
  nossoNumero: idxColuna("Nosso Nº", 0),
  segCodigo: idxColuna("Seg.", 0),
  numeroApolice: idxColuna("Nº Apólice", 0),
  numeroEndosso: idxColuna("Nº Endosso", 0),
  clienteNome: idxColuna("Cliente", 0),
  clienteCpfCnpj: idxColuna("CPF/CNPJ Cliente", 0),
  iniVig: idxColuna("Ini. Vig.", 0),
  fimVig: idxColuna("Fim Vig.", 0),
  parcelas: idxColuna("Parcs.", 0),
  premioLiquido: idxColuna("Pr. Líquido", 0),
  premioAdicional: idxColuna("Pr. Adicional", 0),
  valorComissao: idxColuna("Vl. Com.", 0),
  percentualComissao: idxColuna("% Com.", 0),
  valorComissaoProdutor: idxColuna("Vl. Com. Prod.", 0),
  percentualComissaoProdutor: idxColuna("% Com. Prod.", 0),
  baseComissaoCorretora: idxColuna("Base Com. Corretora", 0),
  premioTotal: idxColuna("Pr. Total", 0),
  seguradora: idxColuna("Seguradora", 0),
  dtProposta: idxColuna("Dt. Proposta", 0),
  tipo: idxColuna("Tipo", 0),
  cancelado: idxColuna("Cancelado", 0),
  canalVendas: idxColuna("Canal Vendas", 0),
};

function texto(v: unknown): string | null {
  const s = (v ?? "").toString().trim();
  return s ? s : null;
}

function numero(v: unknown): number | null {
  const s = (v ?? "").toString().trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function inteiro(v: unknown): number | null {
  const n = numero(v);
  return n === null ? null : Math.round(n);
}

// Datas vêm como texto "M/D/AA" (ex: "6/26/25") -- converte pra ISO
// "AAAA-MM-DD". Ano de 2 dígitos sempre soma 2000 (toda a base é 2024+).
function dataIso(v: unknown): string | null {
  const s = (v ?? "").toString().trim();
  if (!s) return null;
  const partes = s.split("/");
  if (partes.length !== 3) return null;
  const [mStr, dStr, aStr] = partes;
  const mes = Number(mStr);
  const dia = Number(dStr);
  let ano = Number(aStr);
  if (!mes || !dia || !ano) return null;
  if (ano < 100) ano += 2000;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function competenciaDe(dataIsoValor: string | null): string | null {
  return dataIsoValor ? dataIsoValor.slice(0, 7) : null;
}

// Lê o arquivo, filtra canceladas e linhas em branco, e devolve as linhas já
// deduplicadas por "Nosso Número" -- o CORP grava 2-3 linhas pra mesma
// apólice quando há mais de um produtor/canal (ex: direto x Segimob); fica
// só a linha que tem comissão de produtor de verdade (as outras têm
// Vl. Com. Prod. = 0), pra não contar a mesma produção mais de uma vez.
export function importarGradeProducao(buffer: Buffer, ramo: string, nomeArquivo: string): LinhaProducaoErp[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const planilha = wb.Sheets[wb.SheetNames[0]];
  const linhasBrutas: unknown[][] = XLSX.utils.sheet_to_json(planilha, { header: 1, raw: false, defval: "" });
  const linhasDados = linhasBrutas.slice(1); // pula cabeçalho

  const porNossoNumero = new Map<string, LinhaProducaoErp>();

  for (const r of linhasDados) {
    const nossoNumero = texto(r[IDX.nossoNumero]);
    const seguradora = texto(r[IDX.seguradora]);
    if (!nossoNumero || !seguradora) continue; // linha em branco/incompleta

    const cancelado = texto(r[IDX.cancelado]);
    if (cancelado === "T") continue; // só produção original, sem canceladas

    const linha: LinhaProducaoErp = {
      ramo,
      nosso_numero: nossoNumero,
      seguradora,
      seguradora_codigo: texto(r[IDX.segCodigo]),
      produtor: texto(r[IDX.produtor]),
      produtor_cpf_cnpj: texto(r[IDX.produtorCpfCnpj]),
      codigo_produtor: texto(r[IDX.codigo]),
      filial: texto(r[IDX.filial]),
      numero_apolice: texto(r[IDX.numeroApolice]),
      numero_endosso: texto(r[IDX.numeroEndosso]),
      cliente_nome: texto(r[IDX.clienteNome]),
      cliente_cpf_cnpj: texto(r[IDX.clienteCpfCnpj]),
      inicio_vigencia: dataIso(r[IDX.iniVig]),
      fim_vigencia: dataIso(r[IDX.fimVig]),
      data_proposta: dataIso(r[IDX.dtProposta]),
      competencia: competenciaDe(dataIso(r[IDX.dtProposta])),
      parcelas: inteiro(r[IDX.parcelas]),
      premio_liquido: numero(r[IDX.premioLiquido]),
      premio_adicional: numero(r[IDX.premioAdicional]),
      premio_total: numero(r[IDX.premioTotal]),
      valor_comissao: numero(r[IDX.valorComissao]),
      percentual_comissao: numero(r[IDX.percentualComissao]),
      valor_comissao_produtor: numero(r[IDX.valorComissaoProdutor]),
      percentual_comissao_produtor: numero(r[IDX.percentualComissaoProdutor]),
      base_comissao_corretora: numero(r[IDX.baseComissaoCorretora]),
      tipo: texto(r[IDX.tipo]),
      canal_vendas: texto(r[IDX.canalVendas]),
      arquivo_origem: nomeArquivo,
    };

    const atual = porNossoNumero.get(nossoNumero);
    if (!atual || (linha.valor_comissao_produtor ?? 0) > (atual.valor_comissao_produtor ?? 0)) {
      porNossoNumero.set(nossoNumero, linha);
    }
  }

  return Array.from(porNossoNumero.values());
}
