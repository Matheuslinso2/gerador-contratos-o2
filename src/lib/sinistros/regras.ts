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
  { chave: "luz", titulo: "Energia elétrica" },
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
// "2026-03-10" -> "2026-04-10" (último dia do mês quando não existe o dia).
export function maisUmMes(data: string | null | undefined) {
  const m = (data ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes, Math.min(dia, ultimo))).toISOString().slice(0, 10);
}
// Etapa 1 (Identificação): "ocupado ou desocupado" + data da ocorrência
// (primeira inadimplência) viram o tipo e as datas que contam o prazo de
// aviso. Ocupado: 1º vencimento = ocorrência, 2º = um mês depois. Desocupado
// mantém "com danos" se a Etapa 2 já marcou danos/pintura.
export function situacaoDoFormulario(
  situacao: string | null,
  dataOcorrencia: string | null,
  dataChaves: string | null,
  tipoAtual: string | null | undefined
): { tipo: TipoSinistro; data_primeiro_vencimento: string | null; data_segundo_vencimento: string | null; data_entrega_chaves: string | null } | null {
  if (situacao === "ocupado")
    return { tipo: "ocupado", data_primeiro_vencimento: dataOcorrencia, data_segundo_vencimento: maisUmMes(dataOcorrencia) || null, data_entrega_chaves: null };
  if (situacao === "desocupado")
    return {
      tipo: tipoAtual === "chaves_com_danos" ? "chaves_com_danos" : "chaves_sem_danos",
      data_primeiro_vencimento: dataOcorrencia,
      data_segundo_vencimento: null,
      data_entrega_chaves: dataChaves,
    };
  return null;
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
  // Ajuste da equipe (23/10/2026): a Procuração Ad Judicia não é exigida no
  // acionamento -- a O2 pede depois, se a seguradora precisar.
  if (ocupado) itens.push({ chave: "procuracao_ad_judicia", titulo: "Procuração Ad Judicia", obrigatorio: false });
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
  // Comprovante bancário do favorecido saiu da lista (ajuste da equipe, 23/10/2026).
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
  // Especificação da tela de abertura (22/10/2026): sem tabela de débitos -- os
  // valores vão na Declaração de Débitos assinada (modelo da seguradora).
  void debitos; // mantido na assinatura: casos antigos ainda têm linhas de débito

  // R8: portão da pintura.
  if (s.coberturas.includes("pintura") && (s.pintura_vistoria_nova !== true || s.pintura_vistoria_assinada !== true))
    alertas.push(
      "Pintura: a seguradora só indeniza se a vistoria inicial registrar \"pintura nova\" sem nenhuma ressalva e estiver assinada pelas duas partes."
    );


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

// Modelos de Declaração de Débitos por seguradora (public/modelos-sinistro,
// achados no Drive/e-mails da equipe em 22/10/2026). Etapa 3 da abertura.
export function modelosDeclaracao(seguradora: string | null | undefined, tipo: TipoSinistro | null | undefined) {
  const s = (seguradora ?? "").toLowerCase();
  const base = "/modelos-sinistro/";
  const chaves = tipo === "chaves_sem_danos" || tipo === "chaves_com_danos";
  if (s.includes("pottencial")) {
    const iniciais = { rotulo: "Modelo Pottencial — Declaração de Débitos Iniciais", href: `${base}pottencial-declaracao-de-debitos-iniciais.pdf` };
    const finais = { rotulo: "Modelo Pottencial — Declaração de Débitos Finais", href: `${base}pottencial-declaracao-de-debitos-finais.pdf` };
    return chaves ? [finais, iniciais] : [iniciais, finais];
  }
  if (s.includes("porto")) return [{ rotulo: "Modelo Porto Seguro — Declaração de Débitos", href: `${base}porto-declaracao-de-debitos.pdf` }];
  if (s.includes("liberty") || s.includes("yelum"))
    return [{ rotulo: "Modelo Liberty/Yelum — Declaração de Débitos Finais (com entrega das chaves)", href: `${base}liberty-declaracao-de-debitos-finais-com-entrega-das-chaves.pdf` }];
  if (s.includes("bradesco")) return [{ rotulo: "Modelo Bradesco — Declaração de Débitos Finais", href: `${base}bradesco-declaracao-de-debitos-finais.pdf` }];
  if (s.includes("tokio")) return [{ rotulo: "Modelo Tokio Marine — Declaração de Débitos", href: `${base}tokio-declaracao-de-debitos.pdf` }];
  return [];
}

// Tela de visualização (22/10/2026), verificação automática da vigência: com
// sinistro de imóvel OCUPADO em andamento, alerta 20 dias antes do vencimento
// da apólice e, depois do encerramento da vigência SEM entrega das chaves,
// alerta por 10 dias seguidos -- até a O2 marcar "Setor de renovação foi
// sinalizado?". Usado na ficha e no cron /api/cron/alertas-sinistros.
export const DIAS_ALERTA_RENOVACAO = 20;
export const DIAS_ALERTA_POS_VENCIMENTO = 10;
const ETAPAS_EM_ANDAMENTO = ["pre_analise", "pendencia_imobiliaria", "na_seguradora", "em_indenizacao", "acordo_judicial"];
export function alertaRenovacao(
  s: {
    tipo?: string | null;
    etapa?: string | null;
    vigencia_fim?: string | null;
    data_entrega_chaves?: string | null;
    renovacao_sinalizada_em?: string | null;
  },
  hoje = hojeSP()
): { fase: "vence" | "encerrada"; dias: number; texto: string } | null {
  const fim = s.vigencia_fim;
  if (s.tipo !== "ocupado" || s.data_entrega_chaves || !fim || !ETAPAS_EM_ANDAMENTO.includes(s.etapa ?? "")) return null;
  // Sinalização vale para este vencimento (feita a partir da janela de 20 dias).
  if (s.renovacao_sinalizada_em && s.renovacao_sinalizada_em.slice(0, 10) >= somarDias(fim, -DIAS_ALERTA_RENOVACAO)) return null;
  const dias = diasEntre(hoje, fim);
  if (dias >= 0 && dias <= DIAS_ALERTA_RENOVACAO)
    return { fase: "vence", dias, texto: `A apólice vence em ${dias === 0 ? "hoje" : `${dias} dia(s)`} (${formatarData(fim)}) e o imóvel segue ocupado. Sinalize o setor de renovação.` };
  if (dias < 0 && -dias <= DIAS_ALERTA_POS_VENCIMENTO)
    return {
      fase: "encerrada",
      dias: -dias,
      texto: `A vigência encerrou em ${formatarData(fim)} sem entrega das chaves (dia ${-dias} de ${DIAS_ALERTA_POS_VENCIMENTO}). Sinalize o setor de renovação.`,
    };
  return null;
}

// LMI global ou individual por cobertura (ajuste da equipe, 23/10/2026). No
// individual a O2 marca só as coberturas que a apólice tem, com o limite de
// cada uma; cada indenização é rateada por cobertura (rateio interno, a
// imobiliária só vê o total) e o saldo sai por cobertura.
export const COBERTURAS_LMI: { chave: string; titulo: string }[] = [
  { chave: "aluguel", titulo: "Aluguel" },
  { chave: "condominio", titulo: "Condomínio" },
  { chave: "iptu", titulo: "IPTU" },
  { chave: "agua", titulo: "Água" },
  { chave: "luz", titulo: "Energia elétrica" },
  { chave: "gas", titulo: "Gás" },
  { chave: "danos", titulo: "Danos ao imóvel" },
  { chave: "pintura_interna", titulo: "Pintura interna" },
  { chave: "pintura_externa", titulo: "Pintura externa" },
  { chave: "multa_rescisoria", titulo: "Multa rescisória" },
];

export type LinhaLmi = { chave: string; titulo: string; lmi: number; usado: number; saldo: number };
export function saldoLmi(
  s: { lmi?: number | string | null; lmi_tipo?: string | null; lmi_coberturas?: Record<string, number> | null },
  indenizacoes: { valor: number | string; valores_cobertura?: Record<string, number> | null }[]
): { tipo: "global" | "individual"; lmi: number | null; usado: number; saldo: number | null; linhas: LinhaLmi[] } {
  const usado = indenizacoes.reduce((t, i) => t + Number(i.valor), 0);
  if (s.lmi_tipo === "individual") {
    const limites = s.lmi_coberturas ?? {};
    const linhas = COBERTURAS_LMI.filter((c) => limites[c.chave] != null).map((c) => {
      const lmi = Number(limites[c.chave]);
      const usadoC = indenizacoes.reduce((t, i) => t + Number(i.valores_cobertura?.[c.chave] ?? 0), 0);
      return { ...c, lmi, usado: usadoC, saldo: lmi - usadoC };
    });
    const lmi = linhas.reduce((t, l) => t + l.lmi, 0);
    return { tipo: "individual", lmi: linhas.length ? lmi : null, usado, saldo: linhas.length ? linhas.reduce((t, l) => t + l.saldo, 0) : null, linhas };
  }
  const lmi = s.lmi != null ? Number(s.lmi) : null;
  return { tipo: "global", lmi, usado, saldo: lmi != null ? lmi - usado : null, linhas: [] };
}

// Acordo (ajuste da equipe, 23/10/2026): o lembrete mensal é 1 dia útil depois
// do VENCIMENTO DO ALUGUEL (não da parcela do acordo). O dia do mês vem do
// campo "Vencimento do aluguel" (casos antigos: da 1ª parcela), dentro do
// período do acordo (até a última parcela).
type DadosAcordo = { acordo_vencimento_aluguel?: string | null; acordo_primeira_parcela?: string | null; acordo_ultima_parcela?: string | null };
function baseAcordo(s: DadosAcordo) {
  return s.acordo_vencimento_aluguel ?? s.acordo_primeira_parcela ?? null;
}
function noMes(base: string, ano: number, mes: number) {
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, "0")}-${String(Math.min(Number(base.slice(8, 10)), ultimo)).padStart(2, "0")}`;
}
export function vencimentoAluguelDoMes(s: DadosAcordo, hoje: string): string | null {
  const base = baseAcordo(s);
  if (!base) return null;
  const venc = noMes(base, Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)));
  if (venc < base) return null;
  if (s.acordo_ultima_parcela && venc > s.acordo_ultima_parcela) return null;
  return venc;
}
export function proximoVencimentoAluguel(s: DadosAcordo, hoje: string): string | null {
  const base = baseAcordo(s);
  if (!base) return null;
  let [ano, mes] = [Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7))];
  for (let i = 0; i < 3; i++) {
    const data = noMes(base, ano, mes);
    if (data >= hoje && data >= base) return !s.acordo_ultima_parcela || data <= s.acordo_ultima_parcela ? data : null;
    mes += 1;
    if (mes > 12) [mes, ano] = [1, ano + 1];
  }
  return null;
}

// Texto padrão enviado à imobiliária quando a O2 autoriza o acionamento
// (chat + e-mail), pedido do Matheus em 28/10/2026.
export const TEXTO_PRAZO_ANALISE = [
  "O prazo para retorno de análise da documentação é de 10 dias úteis, podendo ser reprovada caso não esteja dentro dos parâmetros solicitados pela Seguradora.",
  "Sendo aprovada, a previsão para pagamento é de 4 dias úteis após a data de conclusão.",
  "Caso haja retorno antecipado ao prazo informado, sinalizaremos de imediato. 📆",
];
