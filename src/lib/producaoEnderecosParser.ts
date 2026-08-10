// Extrai endereço + valor do aluguel dos PDFs "Relatório de Renovações" do
// CORP -- um card de texto por apólice, layout confirmado testando contra
// dados reais (Fiança: 3.061 registros, 99,7% de acerto na heurística de
// campo em branco; ver anotações abaixo).
//
// Formato de cada registro (texto extraído linha a linha):
//   NOME
//   Dt. Nasc.: [valor opcional]
//   CNH: [valor opcional]
//   CPF/CNPJ: valor
//   [Endereço Residencial: texto corrido -- 0, 1 ou 2 linhas, opcional]
//   DD/MM/AAAA à DD/MM/AAAA NUMERONNº:
//   Apólice: valor
//   Endosso: valor
//   Tipo: XSinistro: SIM/NÃO
//   E-m ail: valor
//   Telefones: valor
//   SEGCODE - RAMO
//   Pr. Total: V1Pr. Líq.: V2 Comissão: V3 (PCT%)Nº Parc.:Vl. 1ª Parc.: V4 N
//   Dados do Item [ramos de imóvel: 6 rótulos Logradouro/Nº/Complemento/
//     Bairro/Cidade/UF + valores; Automóvel: 7 rótulos de veículo, sem
//     endereço -- usa Endereço Residencial em vez disso]
//   Cobertura Im p. Seg. Franquia
//   [nomes das coberturas] [valores Imp. Seg.] [valores Franquia]

export type FonteEndereco = "item" | "residencial";

export type EnderecoExtraido = {
  ramo: string;
  nossoNumero: string;
  fonte: FonteEndereco;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  valorAluguel: number | null;
  arquivoOrigem: string;
};

const UF_VALIDA = /^[A-Z]{2}$/;
const REGEX_MOEDA = /^[\d.,]+$/;
// Formato do texto corrido de "Endereço Residencial:" -- sempre termina em
// "- B.{bairro} CEP:{cep} {cidade}/{uf}"; tudo antes do "- B." vira o
// logradouro (não compensa tentar separar número/complemento daí, o
// formato varia demais entre registros). UF às vezes vem minúsculo
// (ex: "/Rj") -- por isso o /i, normalizado pra maiúsculo depois.
const REGEX_ENDERECO_RESIDENCIAL = /^(.+?)\s*-\s*B\.\s*(.+?)\.?\s*CEP:\s*(\d{5}-?\d{3})\s+(.+?)\/([A-Za-z]{2})\s*$/i;
const REGEX_VIGENCIA_INICIO = /^\d{2}\/\d{2}\/\d{4} à /;

// Ramos cujo "Dados do Item" é o próprio imóvel segurado (6 rótulos fixos).
// Automóvel não entra aqui -- o "item" dele é o veículo.
const RAMOS_COM_ITEM_IMOVEL = new Set([
  "fianca_locaticia",
  "capitalizacao",
  "incendio_residencial",
  "incendio_empresarial",
  "incendio_imobiliario",
  "condominio",
]);

// Um mesmo PDF pode misturar vários ramos (ex: um relatório só de
// "Imobiliário + Residencial + Empresarial") -- por isso o ramo de cada
// registro é lido da própria linha "SEGURADORA - RAMO" (ex: "TOKI - 2
// IMOBILIARIO", "PORT - RESIDENCIAL"), não escolhido no formulário de
// upload. Casamento por trecho (não string exata) porque a mesma coisa
// aparece com prefixo "2 " variando e às vezes com acento, às vezes sem.
function normalizarRamoTexto(texto: string): string | null {
  const chave = texto
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (chave.includes("AUTOM")) return "automovel";
  if (chave.includes("FIANC")) return "fianca_locaticia";
  if (chave.includes("CAPITALIZ")) return "capitalizacao";
  if (chave.includes("RESIDENC")) return "incendio_residencial";
  if (chave.includes("EMPRESARI")) return "incendio_empresarial";
  if (chave.includes("IMOBILI")) return "incendio_imobiliario";
  if (chave.includes("CONDOMIN")) return "condominio";
  return null;
}

// Linha "SEGCODE - RAMO", sempre a primeira linha depois de "Telefones:"
// que contém " - " (ex: "PORT - FIANCA LOCATICIA").
function extrairRamoDoRegistro(corpo: string[]): string | null {
  const idxTelefones = corpo.findIndex((l) => l.startsWith("Telefones:"));
  if (idxTelefones < 0) return null;
  for (let i = idxTelefones + 1; i < corpo.length; i++) {
    const posTraco = corpo[i].indexOf(" - ");
    if (posTraco >= 0) {
      const ramoTexto = corpo[i].slice(posTraco + 3);
      return ramoTexto ? normalizarRamoTexto(ramoTexto) : null;
    }
    if (corpo[i]) break; // primeira linha não vazia que não bate, desiste
  }
  return null;
}

function valorMoeda(s: string | undefined | null): number | null {
  if (!s) return null;
  const limpo = s.replace(/\./g, "").replace(",", ".").trim();
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

function extrairEnderecoResidencial(corpo: string[]): ReturnType<typeof montarResidencial> | null {
  const idx = corpo.findIndex((l) => l.startsWith("Endereço Residencial:"));
  if (idx < 0) return null;

  // Endereço às vezes quebra em 2 linhas de texto (ex: "...RIO DE" seguido
  // de "JANEIRO/RJ" na linha seguinte) -- junta mais 1 linha se ainda não
  // tiver o formato completo "cidade/UF" no final.
  let texto = corpo[idx].replace("Endereço Residencial:", "").trim();
  if (!/\/[A-Za-z]{2}\s*$/.test(texto)) {
    const proxima = corpo[idx + 1];
    if (proxima && !REGEX_VIGENCIA_INICIO.test(proxima) && !proxima.startsWith("Endereço Residencial:")) {
      texto = `${texto} ${proxima}`;
    }
  }

  const m = texto.match(REGEX_ENDERECO_RESIDENCIAL);
  if (!m) return null;
  return montarResidencial(m);
}
function montarResidencial(m: RegExpMatchArray) {
  return {
    logradouro: m[1].trim(),
    numero: null as string | null,
    complemento: null as string | null,
    bairro: m[2].trim(),
    cidade: m[4].trim(),
    uf: m[5].trim().toUpperCase(),
    cep: m[3].trim(),
  };
}

// "Dados do Item" com 6 rótulos fixos (Logradouro/Nº/Complemento/Bairro/
// Cidade/UF) -- campos em branco não geram linha nenhuma no texto
// extraído, então o nº de valores presentes (M) varia. Bairro/Cidade/UF
// praticamente nunca ficam em branco num endereço de seguro, por isso são
// sempre os últimos valores; o que sobra na frente preenche Logradouro/
// Número/Complemento nessa ordem (testado contra 3.061 registros reais).
function extrairDadosDoItem(corpo: string[]): { valores: ReturnType<typeof montarItem>; idxDados: number; idxCobertura: number } | null {
  const idxDados = corpo.indexOf("Dados do Item");
  if (idxDados < 0) return null;
  const idxCobertura = corpo.indexOf("Cobertura Im p. Seg. Franquia");
  const fimValores = idxCobertura >= 0 ? idxCobertura : corpo.length;
  const valores = corpo.slice(idxDados + 7, fimValores).filter((v) => v !== undefined);
  const M = valores.length;

  let uf: string | null = null;
  let cidade: string | null = null;
  let bairro: string | null = null;
  let logradouro: string | null = null;
  let numero: string | null = null;
  let complemento: string | null = null;

  if (M >= 3) {
    uf = valores[M - 1];
    cidade = valores[M - 2];
    bairro = valores[M - 3];
    const frente = valores.slice(0, M - 3);
    logradouro = frente[0] ?? null;
    numero = frente[1] ?? null;
    complemento = frente[2] ?? null;
  } else if (M === 2) {
    uf = valores[1];
    cidade = valores[0];
  } else if (M === 1 && UF_VALIDA.test(valores[0])) {
    uf = valores[0];
  }
  if (uf !== null && !UF_VALIDA.test(uf)) uf = null; // dado truncado no PDF, não confiável

  return { valores: montarItem({ logradouro, numero, complemento, bairro, cidade, uf }), idxDados, idxCobertura };
}
function montarItem(v: { logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null }) {
  return { ...v, cep: null as string | null };
}

function extrairValorAluguel(corpo: string[], idxCobertura: number): number | null {
  if (idxCobertura < 0) return null;
  const resto = corpo.slice(idxCobertura + 1);
  let i = 0;
  const nomes: string[] = [];
  while (i < resto.length && resto[i] && !REGEX_MOEDA.test(resto[i])) {
    nomes.push(resto[i]);
    i++;
  }
  const valores = resto.slice(i, i + nomes.length);
  const idx = nomes.findIndex((n) => n.toUpperCase() === "ALUGUEL");
  if (idx < 0) return null;
  return valorMoeda(valores[idx]);
}

// Devolve os endereços resolvidos e um contador de quantos registros
// tinham um "SEGURADORA - RAMO" que não bateu com nenhum dos 7 ramos
// conhecidos (pra avisar o usuário, sem travar o resto do processamento).
export function extrairEnderecosRenovacoes(
  textoCompleto: string,
  nomeArquivo: string
): { registros: EnderecoExtraido[]; ramoNaoIdentificado: number } {
  const linhas = textoCompleto.split("\n").map((l) => l.trim());
  const idxDtNasc: number[] = [];
  for (let i = 0; i < linhas.length; i++) {
    if (linhas[i].startsWith("Dt. Nasc.:")) idxDtNasc.push(i);
  }

  const resultado: EnderecoExtraido[] = [];
  let ramoNaoIdentificado = 0;

  for (let r = 0; r < idxDtNasc.length; r++) {
    const inicio = idxDtNasc[r];
    const fim = r + 1 < idxDtNasc.length ? idxDtNasc[r + 1] - 1 : linhas.length;
    const corpo = linhas.slice(inicio, fim);

    const linhaNNo = corpo.find((l) => l.endsWith("NNº:"));
    const m = linhaNNo?.match(/^(\d{2}\/\d{2}\/\d{4}) à (\d{2}\/\d{2}\/\d{4}) (\d+)NNº:$/);
    const nossoNumero = m ? m[3] : null;
    if (!nossoNumero) continue;

    const ramo = extrairRamoDoRegistro(corpo);
    if (!ramo) {
      ramoNaoIdentificado++;
      continue;
    }

    let escolhido: { logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null } | null = null;
    let fonte: FonteEndereco = "residencial";
    let idxCobertura = corpo.indexOf("Cobertura Im p. Seg. Franquia");

    if (RAMOS_COM_ITEM_IMOVEL.has(ramo)) {
      const item = extrairDadosDoItem(corpo);
      if (item) {
        idxCobertura = item.idxCobertura;
        if (item.valores.bairro) {
          escolhido = item.valores;
          fonte = "item";
        }
      }
    }
    if (!escolhido) {
      const residencial = extrairEnderecoResidencial(corpo);
      if (residencial) {
        escolhido = residencial;
        fonte = "residencial";
      }
    }

    const valorAluguel = extrairValorAluguel(corpo, idxCobertura);

    resultado.push({
      ramo,
      nossoNumero,
      fonte,
      logradouro: escolhido?.logradouro ?? null,
      numero: escolhido?.numero ?? null,
      complemento: escolhido?.complemento ?? null,
      bairro: escolhido?.bairro ?? null,
      cidade: escolhido?.cidade ?? null,
      uf: escolhido?.uf ?? null,
      cep: escolhido?.cep ?? null,
      valorAluguel,
      arquivoOrigem: nomeArquivo,
    });
  }

  return { registros: resultado, ramoNaoIdentificado };
}
