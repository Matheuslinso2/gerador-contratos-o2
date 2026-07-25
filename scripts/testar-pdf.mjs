import { gerarContratoPdf, mesclarLaudoNoPdf } from "../src/lib/gerarContratoPdf.ts";
import { PDFDocument } from "pdf-lib";
import fs from "node:fs";

const textoBase = `1. DAS PARTES E DO OBJETO: Pelo presente instrumento particular de locação, as partes acima qualificadas ajustam a locação do imóvel descrito nos Dados da Locação, nos termos da Lei nº 8.245/91.

2. DO PRAZO: O prazo de locação é o indicado nos Dados da Locação, contado a partir da data de início ali informada.

3. DO VALOR DO ALUGUEL: O aluguel mensal é o indicado nos Dados da Locação e deverá ser pago até o dia informado no cadastro da imobiliária.`;

const contratoDoc = await gerarContratoPdf({
  imobiliaria: {
    nome: "Horizonte Imóveis Administração de Locações Ltda",
    cnpj: "41.982.630/0001-17",
    creci: "11234-J",
    endereco: "Avenida Presidente Vargas, 1200, sala 804, Centro, Rio de Janeiro/RJ",
    texto_base_contrato: textoBase,
    indice_reajuste: "IGPM",
    percentual_multa_atraso: 10,
    percentual_juros_mora: 1,
    percentual_honorarios_advocaticios: 20,
    dia_vencimento_aluguel: 10,
    plataforma_assinatura: "Clicksign",
    logo_url: null,
  },
  tipoGarantiaNome: "Seguro Fiança Locatícia",
  seguradoraNome: "Pottencial Seguradora",
  produtoNome: "Fiança Locatícia Taxa Fixa",
  clausulaBase: "As Partes anuem com a emissão de seguro fiança locatícia para garantia do presente contrato, nos termos do art. 37, III da Lei nº 8.245/1991.",
  coberturas: [{ nome: "Danos ao Imóvel", texto: "Cobertura adicional de Danos ao Imóvel — texto de teste." }],
  seguroIncendio: null,
  locador: "Ricardo Almeida Souza, CPF 123.456.789-00",
  locadorProcurador: false,
  locatario: "Camila Ferreira Rocha, CPF 987.654.321-00",
  ocupantesAdicionais: null,
  enderecoImovel: "Rua das Laranjeiras, 480, apto 302, Laranjeiras, Rio de Janeiro/RJ",
  finalidade: "residencial",
  valorAluguel: 3200,
  dataInicio: "2026-09-01",
  prazoMeses: 30,
  laudoModo: "arquivo_embutido",
  laudoVistoriaUrl: null,
  laudoArquivoNome: "laudo-vistoria-laranjeiras.pdf",
});

const paginasSoContrato = contratoDoc.getPageCount();
console.log("Páginas só do contrato:", paginasSoContrato);

const laudoBytes = fs.readFileSync(
  "C:/Users/O2-Grupo/Downloads/LOC 52025 IM 15072 VENC 17 09 2025 TC.pdf"
);
const laudoDocOriginal = await PDFDocument.load(laudoBytes);
const paginasLaudoOriginal = laudoDocOriginal.getPageCount();
console.log("Páginas do laudo original:", paginasLaudoOriginal);

const finalBytes = await mesclarLaudoNoPdf(contratoDoc, new Uint8Array(laudoBytes));
fs.writeFileSync("scripts/contrato-com-laudo-teste.pdf", finalBytes);

const finalDoc = await PDFDocument.load(finalBytes);
console.log("Páginas do PDF final:", finalDoc.getPageCount());
console.log(
  "Soma esperada bate?",
  finalDoc.getPageCount() === paginasSoContrato + paginasLaudoOriginal
);
console.log("Bytes do arquivo final:", finalBytes.length);
