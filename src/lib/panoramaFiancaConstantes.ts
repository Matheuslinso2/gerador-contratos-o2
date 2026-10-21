// Constantes/tipos do Panorama de Preços do Seguro Fiança que a tela
// (client component) também usa -- sem nenhuma dependência de servidor.
// Lógica de leitura do Bitrix fica em lib/bitrix/panoramaFianca.ts.

// Uma linha do panorama = uma combinação seguradora/plano com status próprio
// no Bitrix (Porto e Pottencial têm um status por plano). Ordem = ordem do
// panorama. Códigos de status iguais aos de SEGURADORAS em seguroFianca.ts.
export const LINHAS_PANORAMA = [
  { chave: "too", seguradora: "Too", plano: null, logo: "/seguradoras/too.png", campoStatus: "ufCrm10_1776867659537" },
  { chave: "porto_tradicional", seguradora: "Porto", plano: "Tradicional", logo: "/seguradoras/porto.svg", campoStatus: "ufCrm10_1776867859015" },
  { chave: "porto_essencial_20", seguradora: "Porto", plano: "Essencial 20", logo: "/seguradoras/porto.svg", campoStatus: "ufCrm10_1776867889708" },
  { chave: "porto_essencial_30", seguradora: "Porto", plano: "Essencial 30", logo: "/seguradoras/porto.svg", campoStatus: "ufCrm10_1776867909680" },
  { chave: "pottencial_taxa_fixa", seguradora: "Pottencial", plano: "Taxa Fixa", logo: "/seguradoras/pottencial.svg", campoStatus: "ufCrm10_1776867969326" },
  { chave: "pottencial_tradicional", seguradora: "Pottencial", plano: "Tradicional", logo: "/seguradoras/pottencial.svg", campoStatus: "ufCrm10_1776867994910" },
  { chave: "tokio", seguradora: "Tokio Marine", plano: null, logo: "/seguradoras/tokio.svg", campoStatus: "ufCrm10_1776868050602" },
  { chave: "junto", seguradora: "Junto", plano: null, logo: "/seguradoras/junto.svg", campoStatus: "ufCrm10_1776868102153" },
] as const;

export type ChaveLinha = (typeof LINHAS_PANORAMA)[number]["chave"];

// Colunas FIXAS de LMI (múltiplos do aluguel -- NÃO é parcelamento; o nº
// de parcelas vai dentro da célula, junto com o valor). Decisão 15/10/2026.
export const LMI_BASICO = ["18", "24", "30"] as const;
export const LMI_COMPLETO = ["18", "20", "24", "30"] as const;

// "indisponivel" nunca vem do Bitrix: é aplicado na montagem quando a
// seguradora não aceita a forma de pagamento escolhida (ex: Pottencial não
// aceita cartão). Só existe no panorama, não altera o status do card.
export type StatusPanorama = "aprovado" | "pre_aprovado" | "em_analise" | "recusado" | "limite_insuficiente" | "indisponivel" | "oculto";

export const ROTULO_STATUS: Record<StatusPanorama, string> = {
  aprovado: "APROVADO",
  pre_aprovado: "PRÉ-APROVADO",
  em_analise: "EM ANÁLISE",
  recusado: "RECUSADO",
  limite_insuficiente: "LIMITE INSUFICIENTE",
  indisponivel: "INDISPONÍVEL",
  oculto: "",
};

// Os rótulos variam por seguradora no Bitrix ("Pré-Aprovado", "Pré-Aprov.",
// "Aprov", "Aprov.") -- normaliza pelo texto em vez de fixar IDs de opção.
// "Não analisar" e status em branco (seguradora não cotada) somem do
// panorama (decisão 15/10/2026).
export function normalizarStatus(rotulo: string): StatusPanorama {
  const r = rotulo.trim().toLowerCase();
  if (!r || r.startsWith("não analisar") || r.startsWith("nao analisar")) return "oculto";
  if (r.startsWith("pré") || r.startsWith("pre")) return "pre_aprovado";
  if (r.startsWith("aprov")) return "aprovado";
  if (r.startsWith("recusad")) return "recusado";
  if (r.startsWith("limite")) return "limite_insuficiente";
  return "em_analise"; // Pendente / Em análise
}

export const statusEditavel = (s: StatusPanorama) => s === "aprovado" || s === "pre_aprovado";

export type CabecalhoPanorama = {
  imobiliaria: string;
  inquilino: string;
  imovel: string;
  aluguel: number | null;
  condominio: number | null;
  iptu: number | null;
};

export type LinhaStatus = { chave: ChaveLinha; status: StatusPanorama; rotuloBitrix: string };


// Célula da grade: plano × LMI → nº de parcelas + valor da parcela.
// Guardado como texto digitado (ex: "29", "151,51") pra não perder o que o
// colaborador escreveu; conversão só na hora de exibir.
export type CelulaPreco = { parcelas: string; valor: string };
export type PrecosLinha = {
  basico: Partial<Record<(typeof LMI_BASICO)[number], CelulaPreco>>;
  completo: Partial<Record<(typeof LMI_COMPLETO)[number], CelulaPreco>>;
};
export type LinhaPanorama = LinhaStatus & { precos: PrecosLinha };

export type FormaPagamento = "fatura" | "boleto" | "cartao";
export const ROTULO_PAGAMENTO: Record<FormaPagamento, string> = {
  fatura: "FATURA",
  boleto: "BOLETO",
  cartao: "CARTÃO DE CRÉDITO",
};

// Seguradoras que NÃO aceitam certa forma de pagamento (pedido do Matheus,
// 22/10/2026): ao escolher a forma, essas linhas já saem "INDISPONÍVEL" no
// panorama. É só o ponto de partida -- a equipe marca/desmarca qualquer
// seguradora na grade (ex: uma seguradora que passe a aceitar cartão).
export const PAGAMENTO_NAO_ACEITO: Partial<Record<ChaveLinha, FormaPagamento[]>> = {
  pottencial_taxa_fixa: ["cartao"],
  pottencial_tradicional: ["cartao"],
};

export const indisponiveisPorPadrao = (forma: FormaPagamento): ChaveLinha[] =>
  LINHAS_PANORAMA.map((l) => l.chave).filter((chave) => PAGAMENTO_NAO_ACEITO[chave]?.includes(forma));

export const DESCRICAO_PLANO = {
  basico: "(Aluguel, Condomínio e IPTU)",
  completo: "(Aluguel, Condomínio e IPTU + Danos ao Imóvel, Pintura Interna e Externa e Multa Rescisória)",
};

// PROVISÓRIO -- lido da imagem modelo; o Matheus vai mandar o texto oficial
// (15/10/2026). Trocar aqui quando chegar (vale pra todo panorama novo).
export const TEXTOS_RODAPE = [
  "O ressarcimento do parcelado para a administradora somente será garantido caso o parcelamento seja feito no máximo de vezes. No momento do sinistro será solicitado o envio do laudo de vistoria inicial e final assinado por ambas as partes. O laudo de vistoria inicial deve constar se o imóvel possui PINTURA NOVA: ressalvas não são aceitas pelas seguradoras (ex.: pintura boa, em bom estado, usada, manchas, furos e/ou infiltrações).",
  "Vale ressaltar que a inclusão das cláusulas no Contrato de Locação deve ser realizada integralmente (incluindo os respectivos aditivos); este procedimento é imprescindível para a emissão da Apólice.",
];

export function precoNumero(valor: string): number | null {
  const limpo = valor.replace(/[^\d,.]/g, "");
  if (!limpo) return null;
  // aceita "151,51", "1.151,51" e "151.51"
  const n = limpo.includes(",") ? Number(limpo.replace(/\./g, "").replace(",", ".")) : Number(limpo);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const formatarReal = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const celulaPreenchida = (c: CelulaPreco | undefined): c is CelulaPreco =>
  !!c && precoNumero(c.valor) !== null && /^\d+$/.test(c.parcelas.trim());
