// Regras do Módulo Sinistro (Seguro Fiança). Fonte única pras telas da
// imobiliária e da O2 -- prazos, checklist de documentos e validação do
// envio. Plano completo (regras R1–R18, matriz de documentos) em
// entregaveis/modulo-sinistro/Modulo Sinistro - Planejamento.pdf.
//
// Datas sempre como string "AAAA-MM-DD" (sem fuso) -- é como vêm do
// <input type="date"> e do Postgres `date`, e evita o dia "pular" por
// causa de UTC.

export type TipoSinistro = "ocupado" | "chaves_sem_danos" | "chaves_com_danos";

export type EtapaSinistro =
  | "rascunho"
  | "pre_analise"
  | "pendencia_imobiliaria"
  | "na_seguradora"
  | "em_indenizacao"
  | "acordo_judicial"
  | "encerrado"
  | "cancelado";

export const TIPOS: Record<TipoSinistro, { titulo: string; descricao: string }> = {
  ocupado: {
    titulo: "Imóvel ocupado — inadimplência",
    descricao: "O locatário continua no imóvel e há aluguel/encargos em aberto.",
  },
  chaves_sem_danos: {
    titulo: "Entrega de chaves — sem danos",
    descricao: "O locatário saiu e deixou débitos finais (aluguel, encargos, multa), sem danos ao imóvel.",
  },
  chaves_com_danos: {
    titulo: "Entrega de chaves — com danos",
    descricao: "O locatário saiu e deixou danos ao imóvel e/ou pintura, com ou sem débitos.",
  },
};

// `vez` = de quem é a próxima ação (cor da etiqueta nas telas).
export const ETAPAS: Record<EtapaSinistro, { titulo: string; tituloImobiliaria: string; vez: "imobiliaria" | "o2" | "terceiros" | "fim" }> = {
  rascunho: { titulo: "Rascunho", tituloImobiliaria: "Rascunho (não enviado)", vez: "imobiliaria" },
  pre_analise: { titulo: "Pré-análise O2", tituloImobiliaria: "Em análise pela O2", vez: "o2" },
  pendencia_imobiliaria: { titulo: "Pendência com a imobiliária", tituloImobiliaria: "Pendência com você", vez: "imobiliaria" },
  na_seguradora: { titulo: "Na seguradora", tituloImobiliaria: "Em análise na seguradora", vez: "terceiros" },
  em_indenizacao: { titulo: "Em indenização", tituloImobiliaria: "Em indenização", vez: "terceiros" },
  acordo_judicial: { titulo: "Acordo / Judicial", tituloImobiliaria: "Acordo / judicial", vez: "terceiros" },
  encerrado: { titulo: "Encerrado", tituloImobiliaria: "Encerrado", vez: "fim" },
  cancelado: { titulo: "Cancelado", tituloImobiliaria: "Cancelado", vez: "fim" },
};

export const CLASSE_VEZ: Record<string, string> = {
  imobiliaria: "bg-orange-100 text-orange-800",
  o2: "bg-blue-100 text-blue-800",
  terceiros: "bg-gray-100 text-gray-700",
  fim: "bg-green-100 text-green-800",
};

export const SEGURADORAS = ["Porto Seguro", "Pottencial", "Tokio Marine", "Too Seguros", "Liberty / Yelum", "Bradesco", "Outra"];

// Coberturas que a imobiliária pode reclamar (R7). `soChaves` = só faz
// sentido depois da entrega das chaves; `soDanos` = só no tipo com danos.
export type Cobertura =
  | "aluguel"
  | "condominio"
  | "iptu"
  | "agua"
  | "luz"
  | "gas"
  | "multa_rescisoria"
  | "danos"
  | "pintura"
  | "limpeza";

export const COBERTURAS: { chave: Cobertura; titulo: string; soChaves?: boolean; soDanos?: boolean }[] = [
  { chave: "aluguel", titulo: "Aluguel" },
  { chave: "condominio", titulo: "Condomínio" },
  { chave: "iptu", titulo: "IPTU" },
  { chave: "agua", titulo: "Água" },
  { chave: "luz", titulo: "Luz" },
  { chave: "gas", titulo: "Gás" },
  { chave: "multa_rescisoria", titulo: "Multa rescisória", soChaves: true },
  { chave: "danos", titulo: "Danos ao imóvel", soDanos: true },
  { chave: "pintura", titulo: "Pintura (interna/externa)", soDanos: true },
  { chave: "limpeza", titulo: "Limpeza (até R$ 300, residencial)", soDanos: true },
];

// Sem tipo escolhido (abertura incompleta, fase de testes) mostra todas.
export function coberturasDoTipo(tipo: TipoSinistro | null | undefined) {
  if (!tipo) return COBERTURAS;
  return COBERTURAS.filter((c) => {
    if (c.soDanos) return tipo === "chaves_com_danos";
    if (c.soChaves) return tipo !== "ocupado";
    return true;
  });
}

export function tituloTipo(tipo: string | null | undefined) {
  return tipo && tipo in TIPOS ? TIPOS[tipo as TipoSinistro].titulo : "Tipo não informado";
}

export const DISCRIMINACOES = COBERTURAS.map((c) => c.titulo).concat(["Outros encargos"]);

// ---------- datas ----------

function paraDia(data: string): number {
  const [a, m, d] = data.split("-").map(Number);
  return Date.UTC(a, m - 1, d) / 86_400_000;
}
function deDia(dia: number): string {
  return new Date(dia * 86_400_000).toISOString().slice(0, 10);
}
export function somarDias(data: string, dias: number) {
  return deDia(paraDia(data) + dias);
}
export function diasEntre(de: string, ate: string) {
  return paraDia(ate) - paraDia(de);
}
export function hojeSP(): string {
  // "en-CA" formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
export function formatarData(data: string | null | undefined) {
  if (!data) return "—";
  const [a, m, d] = data.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

// Dias úteis (seg–sex) entre dois instantes -- SLA de pré-análise da O2.
// Feriado não entra na conta nesta versão.
export function diasUteisDesde(inicioIso: string, agora = new Date()): number {
  const inicio = new Date(inicioIso);
  let dias = 0;
  const cursor = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), inicio.getUTCDate()));
  const fim = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate());
  while (cursor.getTime() < fim) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) dias++;
  }
  return dias;
}

export const SLA_PRE_ANALISE_DIAS_UTEIS = 1;
export const PRAZO_PENDENCIA_DIAS = 5;
export const PRAZO_SEGURADORA_DIAS = 30;

// ---------- R1 / R2: prazo de aviso ----------

export type ResultadoPrazo = {
  prazo: string | null;
  diasRestantes: number | null;
  foraDoPrazo: boolean;
  bloqueio: string | null;
  explicacao: string;
};

export function calcularPrazoAviso(
  s: {
    tipo: TipoSinistro | null;
    data_primeiro_vencimento?: string | null;
    data_segundo_vencimento?: string | null;
    data_entrega_chaves?: string | null;
  },
  hoje = hojeSP()
): ResultadoPrazo {
  if (!s.tipo) {
    return { prazo: null, diasRestantes: null, foraDoPrazo: false, bloqueio: "Escolha o tipo do sinistro (passo 1) para calcular o prazo de aviso.", explicacao: "" };
  }
  if (s.tipo === "ocupado") {
    if (!s.data_primeiro_vencimento || !s.data_segundo_vencimento) {
      return { prazo: null, diasRestantes: null, foraDoPrazo: false, bloqueio: "Informe o 1º e o 2º vencimento em aberto.", explicacao: "" };
    }
    if (diasEntre(s.data_primeiro_vencimento, s.data_segundo_vencimento) <= 0) {
      return { prazo: null, diasRestantes: null, foraDoPrazo: false, bloqueio: "O 2º vencimento precisa ser depois do 1º.", explicacao: "" };
    }
    if (diasEntre(s.data_segundo_vencimento, hoje) < 0) {
      return {
        prazo: null,
        diasRestantes: null,
        foraDoPrazo: false,
        bloqueio:
          "Ainda não é sinistro: o 2º mês em aberto ainda não venceu. Com só 1 mês em atraso, o caminho é a cobrança imediata do locatário — o aviso é feito depois do vencimento do 2º mês.",
        explicacao: "",
      };
    }
    const prazo = somarDias(s.data_segundo_vencimento, 10);
    const diasRestantes = diasEntre(hoje, prazo);
    return {
      prazo,
      diasRestantes,
      foraDoPrazo: diasRestantes < 0,
      bloqueio: null,
      explicacao: `Imóvel ocupado: até 10 dias após o vencimento do 2º mês em aberto (${formatarData(s.data_segundo_vencimento)}).`,
    };
  }
  if (!s.data_entrega_chaves) {
    return { prazo: null, diasRestantes: null, foraDoPrazo: false, bloqueio: "Informe a data da entrega das chaves.", explicacao: "" };
  }
  if (diasEntre(s.data_entrega_chaves, hoje) < 0) {
    return { prazo: null, diasRestantes: null, foraDoPrazo: false, bloqueio: "A data da entrega das chaves não pode ser no futuro.", explicacao: "" };
  }
  const prazo = somarDias(s.data_entrega_chaves, 15);
  const diasRestantes = diasEntre(hoje, prazo);
  return {
    prazo,
    diasRestantes,
    foraDoPrazo: diasRestantes < 0,
    bloqueio: null,
    explicacao: `Entrega de chaves: até 15 dias após a entrega (${formatarData(s.data_entrega_chaves)}).`,
  };
}

// ---------- R4: checklist de documentos ----------

export type ItemChecklist = {
  chave: string;
  titulo: string;
  ajuda?: string;
  obrigatorio: boolean;
};

export type DadosChecklist = {
  tipo: TipoSinistro | null;
  coberturas: string[];
  locatario_assinou_documentos?: boolean | null;
  favorecido_eh_segurado?: boolean | null;
};

export function montarChecklist(s: DadosChecklist): ItemChecklist[] {
  const tem = (c: Cobertura) => s.coberturas.includes(c);
  const chaves = s.tipo === "chaves_sem_danos" || s.tipo === "chaves_com_danos";
  const ocupado = s.tipo === "ocupado";
  const danos = s.tipo === "chaves_com_danos";
  const itens: ItemChecklist[] = [
    { chave: "contrato_locacao", titulo: "Contrato de locação assinado", obrigatorio: true },
    {
      chave: "contrato_administracao",
      titulo: "Contrato de administração ou procuração para administração do imóvel",
      obrigatorio: true,
    },
    {
      chave: "declaracao_debitos",
      titulo: chaves ? "Declaração de Débitos Finais assinada" : "Declaração de Débitos assinada",
      ajuda: "Todos os valores reclamados precisam constar nela. Use o modelo da seguradora.",
      obrigatorio: true,
    },
    { chave: "boletos_aluguel", titulo: "Boletos de aluguel em aberto", obrigatorio: tem("aluguel") },
  ];
  if (tem("condominio"))
    itens.push({
      chave: "boletos_condominio",
      titulo: "Boletos de condomínio discriminados",
      ajuda: "Com rateio e valores separados de verbas ordinárias e extraordinárias.",
      obrigatorio: true,
    });
  if (tem("iptu")) itens.push({ chave: "iptu", titulo: "Guia / espelho do IPTU com as parcelas", obrigatorio: true });
  if (tem("agua") || tem("luz") || tem("gas"))
    itens.push({ chave: "contas_consumo", titulo: "Contas de consumo em aberto (água, luz, gás)", obrigatorio: true });
  if (ocupado)
    itens.push({
      chave: "procuracao_ad_judicia",
      titulo: "Procuração Ad Judicia",
      ajuda: "No modelo da seguradora (Pottencial e Too têm modelo próprio).",
      obrigatorio: true,
    });
  if (chaves) {
    itens.push({ chave: "termo_entrega_chaves", titulo: "Termo de entrega de chaves assinado", obrigatorio: true });
    if (tem("multa_rescisoria")) itens.push({ chave: "boleto_multa", titulo: "Boleto da multa rescisória", obrigatorio: true });
  }
  if (danos) {
    itens.push(
      {
        chave: "vistoria_inicial",
        titulo: "Laudo de vistoria inicial assinado pelas partes",
        ajuda: "Assinatura do locador/representante e do locatário é obrigatória.",
        obrigatorio: true,
      },
      { chave: "vistoria_final", titulo: "Laudo de vistoria final assinado", obrigatorio: true }
    );
    if (tem("danos"))
      itens.push({
        chave: "orcamentos_danos",
        titulo: "2 orçamentos de danos ao imóvel",
        ajuda: "Por dependência, separando material e mão de obra, com nome e telefone do orçamentista.",
        obrigatorio: true,
      });
    if (tem("pintura"))
      itens.push({
        chave: "orcamentos_pintura",
        titulo: "2 orçamentos de pintura + metragem da área",
        ajuda: "Por dependência, separando material e mão de obra, com dados do orçamentista e a metragem a pintar.",
        obrigatorio: true,
      });
    if (tem("limpeza")) itens.push({ chave: "orcamento_limpeza", titulo: "Orçamento ou recibo de limpeza", obrigatorio: true });
  }
  // R9: locatário não assinou termo/vistoria final.
  if (chaves && s.locatario_assinou_documentos === false)
    itens.push({
      chave: "testemunhas_convocacao",
      titulo: "Assinatura de 2 testemunhas qualificadas + registro da convocação do locatário",
      ajuda: "Testemunhas com nome, RG/CPF e endereço. Anexe o e-mail ou WhatsApp em que o locatário foi chamado a assinar.",
      obrigatorio: true,
    });
  // R12
  if (s.favorecido_eh_segurado === false)
    itens.push({
      chave: "comprovante_bancario",
      titulo: "Comprovante bancário do favorecido",
      ajuda: "Necessário na 1ª indenização para esse favorecido ou quando a conta muda.",
      obrigatorio: false,
    });
  itens.push({ chave: "outros", titulo: "Outros documentos", obrigatorio: false });
  return itens;
}

// ---------- R11: termo de ciência ----------

export const TEXTO_CIENCIA = [
  "Após a abertura do sinistro, a imobiliária/proprietário NÃO deve receber nenhum valor do locatário sem autorização prévia da seguradora.",
  "Após o início do processo, a imobiliária/proprietário não deve disponibilizar boletos ao locatário e deve cancelar os boletos já emitidos.",
  "O pagamento das parcelas do seguro fiança não deve ser interrompido até o fim do processo.",
  "O ressarcimento das parcelas do seguro fiança só acontece se a apólice foi emitida na opção fatura imobiliária, no máximo de vezes, com a parcela constando no boleto do aluguel.",
  "A análise da seguradora leva até 30 dias a contar do último documento entregue; o prazo fica suspenso enquanto houver pendência.",
];

// ---------- R6 / validação do envio ----------

export type Debito = {
  discriminacao: string;
  vencimento: string | null;
  competencia: string | null;
  valor: number;
  multa: number;
  acrescimos: number;
};

export function totalDebitos(debitos: Debito[]) {
  return debitos.reduce((t, d) => t + (Number(d.valor) || 0) + (Number(d.multa) || 0) + (Number(d.acrescimos) || 0), 0);
}

export function formatarReais(v: number | null | undefined) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export type DocumentoResumo = { tipo: string; situacao: string };

export type ResultadoValidacao = {
  bloqueios: string[];
  alertas: string[];
  documentosFaltando: ItemChecklist[];
};

export function validarEnvio(
  s: DadosChecklist & {
    data_primeiro_vencimento?: string | null;
    data_segundo_vencimento?: string | null;
    data_entrega_chaves?: string | null;
    locatario_telefone?: string | null;
    locatario_email?: string | null;
    pintura_vistoria_nova?: boolean | null;
    pintura_vistoria_assinada?: boolean | null;
    justificativa_fora_prazo?: string | null;
    favorecido_nome?: string | null;
    favorecido_banco?: string | null;
    favorecido_agencia?: string | null;
    favorecido_conta?: string | null;
  },
  debitos: Debito[],
  documentos: DocumentoResumo[],
  cienciaAceita: boolean,
  hoje = hojeSP()
): ResultadoValidacao {
  const bloqueios: string[] = [];
  const alertas: string[] = [];

  const prazo = calcularPrazoAviso(s, hoje);
  if (prazo.bloqueio) bloqueios.push(prazo.bloqueio);
  if (prazo.foraDoPrazo) {
    alertas.push(`Aviso fora do prazo (o prazo terminou em ${formatarData(prazo.prazo)}). A seguradora pode recusar a cobertura.`);
    if (!s.justificativa_fora_prazo?.trim()) bloqueios.push("Explique por que o aviso está sendo feito fora do prazo.");
  }

  if (!s.locatario_telefone?.trim() && !s.locatario_email?.trim())
    bloqueios.push("Informe ao menos um contato atualizado do locatário (telefone ou e-mail).");

  if (s.coberturas.length === 0) bloqueios.push("Marque ao menos uma cobertura reclamada.");
  if (debitos.length === 0) bloqueios.push("Preencha a tabela de débitos (ela vira a Declaração de Débitos).");
  if (debitos.some((d) => !(Number(d.valor) > 0))) bloqueios.push("Há linha de débito sem valor.");

  // R6: cobertura marcada sem linha correspondente na declaração.
  const titulosDebitos = new Set(debitos.map((d) => d.discriminacao));
  for (const c of COBERTURAS) {
    if (s.coberturas.includes(c.chave) && !titulosDebitos.has(c.titulo))
      alertas.push(`"${c.titulo}" está marcado como cobertura reclamada, mas não aparece na tabela de débitos.`);
  }

  // R8: portão da pintura.
  if (s.coberturas.includes("pintura") && (s.pintura_vistoria_nova !== true || s.pintura_vistoria_assinada !== true))
    alertas.push(
      "Pintura: a seguradora só indeniza se a vistoria inicial registrar \"pintura nova\" sem nenhuma ressalva e estiver assinada pelas duas partes."
    );

  if (s.tipo === "ocupado" && debitos.filter((d) => d.discriminacao === "Aluguel").length < 2 && s.coberturas.includes("aluguel"))
    alertas.push("Imóvel ocupado normalmente tem ao menos 2 meses de aluguel em aberto na declaração.");

  if (!s.favorecido_nome?.trim() || !s.favorecido_banco?.trim() || !s.favorecido_agencia?.trim() || !s.favorecido_conta?.trim())
    bloqueios.push("Preencha os dados do favorecido da indenização (nome, banco, agência e conta).");

  if (!cienciaAceita) bloqueios.push("É preciso aceitar o termo de ciência das regras do sinistro.");

  const enviados = new Set(documentos.filter((d) => d.situacao === "enviado" || d.situacao === "aprovado").map((d) => d.tipo));
  const documentosFaltando = montarChecklist(s).filter((i) => i.obrigatorio && !enviados.has(i.chave));
  if (documentosFaltando.length)
    alertas.push(
      `${documentosFaltando.length} documento(s) obrigatório(s) ainda faltando. Você pode enviar o aviso agora para não perder o prazo, mas a análise da seguradora só começa com a documentação completa.`
    );

  return { bloqueios, alertas, documentosFaltando };
}

export const MOTIVOS_RECUSA = [
  "Ilegível ou cortado",
  "Sem assinatura das partes",
  "Boleto sem discriminação de valores",
  "Documento de outro contrato/imóvel",
  "Vencido ou desatualizado",
  "Fora do modelo da seguradora",
];
