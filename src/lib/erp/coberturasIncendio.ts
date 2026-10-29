// Leitor das COBERTURAS CONTRATADAS de apólices de Incêndio (imobiliário, residencial, empresarial) a partir do texto do PDF.
// Receita do levantamento de 29/10 (erp-o2/LEVANTAMENTO-COBERTURAS-POR-PRODUTO.md): todas as seguradoras trazem uma tabela com nome,
// limite máximo (LMI), prêmio e, às vezes, franquia/POS; começa num título "Coberturas Contratadas/COBERTURAS ... Limite Máximo" e termina
// num total ("Prêmio Líquido Total", "Total prêmio coberturas", "Preço líquido das coberturas") ou no bloco de participação do segurado.

export type CoberturaLida = {
  ordem: number;
  nome: string; // nome normalizado (sinônimos juntados)
  nome_original: string;
  tipo: "basica" | "adicional" | "servico";
  lmi: number | null;
  premio: number | null;
};

const INICIO = /(COBERTURAS CONTRATADAS|NOME DA COBERTURA|COBERTURAS\s+LIMITE M[AÁ]XIMO|COBERTURAS\s*\/\s*RISCOS COBERTOS|COBERTURAS\s+\(VALORES EXPRESSOS)/i;
const FIM = /(PR[EÊ]MIO L[IÍ]QUIDO TOTAL|TOTAL PR[EÊ]MIO COBERTURAS|PRE[CÇ]O L[IÍ]QUIDO DAS COBERTURAS|PARTICIPA[CÇ][AÃ]O OBRIGAT[OÓ]RIA DO SEGURADO\s*$|RAMO DA COBERTURA|SERVI[CÇ]OS CONTRATADOS|FORMA DE PAGAMENTO)/i;
const DINHEIRO = /(?<![\d.,])(\d{1,3}(?:\.\d{3})*,\d{2})(?![\d])/g;
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

// sinônimos → nome padrão
const PADRAO: [RegExp, string][] = [
  [/INCEND|RAIO|EXPLOS/, "Incêndio, raio, explosão, fumaça e queda de aeronave"],
  [/ALUGUEL/, "Perda ou pagamento de aluguel"],
  [/DANOS ELETRIC/, "Danos elétricos"],
  [/VENDAVAL/, "Vendaval, furacão, ciclone, tornado e granizo"],
  [/CONTEUDO/, "Conteúdo"],
  [/RC FAMILIAR|RESPONSABILIDADE CIVIL FAMILIAR/, "RC familiar"],
  [/QUEBRA DE VIDRO/, "Quebra de vidros"],
  [/SALVAMENTO|CONTENCAO/, "Despesas de salvamento e contenção"],
  [/VAZAMENTO|RUPTURA DE TANQUE/, "Vazamento / ruptura de tanques e tubulações"],
  [/ASSIST/, "Assistência 24 horas"],
  [/GASTOS COM DEFESA/, "Gastos com defesa"],
  [/LUCROS CESSANTES/, "Lucros cessantes"],
  [/ROUBO|FURTO/, "Roubo e/ou furto"],
  [/TUMULTO|GREVE|LOCK/, "Tumultos, greves e lock-out"],
];

const valor = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

/** Lê o bloco de coberturas do texto. Devolve [] se não achar o bloco (PDF sem tabela: endosso, aviso, boleto...). */
export function lerCoberturasIncendio(texto: string): CoberturaLida[] {
  const i = texto.search(INICIO);
  if (i < 0) return [];
  const resto = texto.slice(i);
  const fimIdx = resto.slice(40).search(FIM);
  const bloco = fimIdx >= 0 ? resto.slice(0, 40 + fimIdx) : resto.slice(0, 4000);
  const linhas = bloco.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).slice(1);

  const saida: CoberturaLida[] = [];
  let pendente = "";
  for (const l of linhas) {
    if (/^(LIMITE|PR[EÊ]MIO|PRE[CÇ]O|FRANQUIA|PARTICIPA|L\.M\.I|P\.O\.S|VALOR|POS\b|\(R\$\)|R\$)/i.test(l) && !/\d,\d{2}/.test(l)) continue; // cabeçalho de coluna
    const valores = [...l.matchAll(DINHEIRO)].map((m) => ({ v: valor(m[1]), pos: m.index ?? 0 }));
    if (!valores.length) {
      // pode ser o nome quebrado em duas linhas ou "-" (sem LMI)
      if (/N[AÃ]O CONTRATAD/i.test(l)) { pendente = ""; continue; }
      // nome quebrado em duas linhas: só junta fragmento curto, sem número nem palavra de cabeçalho (evita colar o título da coluna no nome)
      if (/^[A-Za-zÀ-ú(/*]/.test(l) && l.length < 45 && !/\d|INDENIZA|PLANO|PR[EÊ]MIO|LIMITE|COBERTURA|FRANQUIA/i.test(l)) pendente = (pendente + " " + l).trim();
      else pendente = "";
      continue;
    }
    if (/N[AÃ]O CONTRATAD/i.test(l)) { pendente = ""; continue; }
    let nomeLinha = l.slice(0, valores[0].pos).replace(/[-–]\s*$/, "").trim();
    // restos de cabeçalho de coluna colados no nome ("de Indenização", "INDENIZAÇÃO (R$) DO SEGURO (R$)", "R$" no fim)
    nomeLinha = nomeLinha.replace(/^(.*?(INDENIZA[CÇ][AÃ]O|SEGURO)( ?\(R\$\))*)\s+/i, "").replace(/^de Indeniza[cç][aã]o\s+/i, "").replace(/\s+R\$$/, "").trim();
    const original = (pendente + " " + nomeLinha).replace(/\s+/g, " ").trim();
    pendente = "";
    if (original.length < 4 || /^(TOTAL|PR[EÊ]MIO)/i.test(original)) continue;
    const S = sem(original);
    const padrao = PADRAO.find(([re]) => re.test(S))?.[1];
    const servico = /^ASSIST/.test(S);
    const tipo: CoberturaLida["tipo"] = servico ? "servico" : /INCEND|RAIO|EXPLOS/.test(S) && !saida.some((c) => c.tipo === "basica") ? "basica" : "adicional";
    // duas colunas de valor = LMI e prêmio; uma só = LMI (formato Tokio/Zurich: a coluna de prêmio vem separada); serviço não tem LMI
    saida.push({
      ordem: saida.length + 1,
      nome: padrao ?? original,
      nome_original: original,
      tipo,
      lmi: servico ? null : valores[0].v,
      premio: valores.length >= 2 ? valores[1].v : null,
    });
  }
  // sem a básica não é uma tabela de coberturas confiável
  return saida.some((c) => c.tipo === "basica") ? saida : [];
}
