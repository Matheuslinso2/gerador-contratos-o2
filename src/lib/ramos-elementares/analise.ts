import type { CelulaGoogle, FonteRamosBruta } from "./fonteGoogle";

export type ItemAgrupado = {
  nome: string;
  total: number;
  efetivados: number;
  conversao: number | null;
  comissao: number;
  comissaoEfetivada: number;
};

export type ResumoPopulacao = {
  total: number;
  efetivados: number;
  conversao: number | null;
  premioTotal: number;
  premioEfetivado: number;
  comissaoPotencial: number;
  comissaoEfetivada: number;
  repasseEfetivado: number;
  resultadoEstimado: number;
  comissaoAnterior: number;
  tempoMedioMinutos: number | null;
  temposValidos: number;
  porStatus: ItemAgrupado[];
  porRamo: ItemAgrupado[];
  porCotador: ItemAgrupado[];
  porImobiliaria: ItemAgrupado[];
  porSeguradora: ItemAgrupado[];
};

export type AlertaRamos = {
  codigo: string;
  titulo: string;
  descricao: string;
  quantidade: number;
  gravidade: "alta" | "media" | "baixa";
};

export type AnaliseRamosElementares = {
  competencia: string;
  atualizadoEm: string;
  fonte: FonteRamosBruta["planilha"];
  avisosFonte: string[];
  semAmostra: boolean;
  visaoGeral: {
    novasEntradas: number;
    pendenciasAnteriores: number;
    renovacoesCompetencia: number;
    novosEfetivados: number;
    renovacoesEfetivadas: number;
    comissaoEfetivada: number;
  };
  novos: {
    consolidado: ResumoPopulacao;
    mes: ResumoPopulacao;
    pendentes: ResumoPopulacao;
  };
  renovacoes: {
    atual: ResumoPopulacao;
    futura: ResumoPopulacao;
  };
  financeiro: {
    comissaoPotencial: number;
    comissaoEfetivada: number;
    repasseEstimado: number;
    resultadoEstimado: number;
    conversaoFinanceira: number | null;
  };
  endossos: {
    total: number;
    cancelados: number;
    pendentes: number;
    tempoMedioMinutos: number | null;
    temposValidos: number;
    temposInvalidos: number;
    restituicaoInformada: number;
    porStatus: ItemAgrupado[];
    porRamo: ItemAgrupado[];
    porResponsavel: ItemAgrupado[];
    porSeguradora: ItemAgrupado[];
  };
  alertasOperacionais: AlertaRamos[];
  qualidade: AlertaRamos[];
  negociacoes: RegistroNegociacao[];
};

type RegistroBase = {
  aba: string;
  linha: number;
  status: string;
  ramo: string;
  seguradora: string;
  imobiliaria: string;
  segurado: string;
  cotador: string;
  premioTotal: number;
  comissao: number;
  repasse: number;
  efetivado: boolean;
};

type RegistroNovo = RegistroBase & {
  origem: string;
  dataRecebida: number | null;
  dataPreenchida: number | null;
  dataInicio: number | null;
  horarioInicio: number | null;
  horarioFim: number | null;
  tempoGasto: number | null;
  diasCotacao: number | null;
  orcamento: string;
  dataEfetivacao: number | null;
  negociador: string;
  ultimoContato: number | null;
  observacoes: string;
};

type RegistroRenovacao = RegistroBase & {
  operacao: string;
  apolice: string;
  fimVigencia: number | null;
  dataEnvio: number | null;
  dataEfetivacao: number | null;
  comissaoAnterior: number;
  ultimoContato: number | null;
};

type RegistroEndosso = {
  aba: string;
  linha: number;
  status: string;
  dataRecebida: number | null;
  imobiliaria: string;
  segurado: string;
  ramo: string;
  seguradora: string;
  cotador: string;
  apolice: string;
  tempoGasto: number | null;
  restituicao: number;
};

// Registro achatado (novo/renovação/endosso, num só formato) pra alimentar
// a tela de "Verificação por E-mail" -- nomePrincipal segue a regra do
// usuário: imobiliária/administradora quando houver, senão o segurado, e
// só em último caso o cotador/responsável identificado na planilha.
export type RegistroNegociacao = {
  id: string; // `${aba}|${linha}`, mesma chave usada pra casar com incendio_emails_confirmacao
  aba: string;
  linha: number;
  tipo: "novo" | "renovacao" | "endosso";
  status: string;
  nomePrincipal: string;
  imobiliaria: string;
  segurado: string;
  seguradora: string;
  ramo: string;
  apolice: string | null;
  premioTotal: number;
  comissao: number;
  negociador: string | null;
  observacoes: string | null;
  // Dias desde o registro de ÚLTIMO CONTATO na planilha -- null quando a
  // aba não tem essa coluna (ENDOSSOS) ou o campo está vazio na linha.
  diasSemContato: number | null;
};

function nomePrincipal(imobiliaria: string, segurado: string, cotador: string): string {
  if (imobiliaria && imobiliaria !== "NÃO INFORMADA") return imobiliaria;
  if (segurado) return segurado;
  if (cotador && cotador !== "NÃO INFORMADO") return `Responsável: ${cotador}`;
  return "Não identificado";
}

const STATUS_AVANCADOS = new Set([
  "EM NEGOCIAÇÃO",
  "LIBERADO P/ NEGOCIAÇÃO",
  "CONTRATAR",
  "EFETIVADO",
  "NÃO EFETIVADO",
  "CANCELADO",
]);

const STATUS_TERMINAIS = new Set(["EFETIVADO", "NÃO EFETIVADO", "CANCELADO", "SEM PARCERIA"]);
const COTADORES_CONHECIDOS = new Set([
  "AMANDA",
  "ANA INGRID",
  "BRUNA",
  "ISABELLE",
  "JOÃO",
  "LUCAS",
  "PRODUÇÃO DIRETA PELA IMOBILIÁRIA",
]);

function texto(valor: CelulaGoogle | undefined): string {
  return valor === null || valor === undefined ? "" : String(valor).trim();
}

function numero(valor: CelulaGoogle | undefined): number {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : 0;
}

function numeroOpcional(valor: CelulaGoogle | undefined): number | null {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

function chave(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function statusCanonico(valor: string): string {
  const normal = chave(valor);
  if (normal === "CANCELADA" || normal === "CANCELADO") return "CANCELADO";
  if (normal === "LIB P NEGOCIACAO" || normal === "LIBERADO P NEGOCIACAO") return "LIBERADO P/ NEGOCIAÇÃO";
  const conhecidos: Record<string, string> = {
    "AG COTACAO": "AG COTAÇÃO",
    "AG LIBERACAO": "AG LIBERAÇÃO",
    CONTRATAR: "CONTRATAR",
    EFETIVADO: "EFETIVADO",
    "EM NEGOCIACAO": "EM NEGOCIAÇÃO",
    "NAO EFETIVADO": "NÃO EFETIVADO",
    PENDENTE: "PENDENTE",
    PLANILHAR: "PLANILHAR",
    "SEM PARCERIA": "SEM PARCERIA",
  };
  return conhecidos[normal] || texto(valor).toUpperCase();
}

function ramoCanonico(valor: string): string {
  let normal = chave(valor);
  if (normal === "2IMO") normal = "IMO";
  if (normal === "2POR") normal = "POR";
  const mapa: Record<string, string> = {
    "INCENDIO IMOBILIARIO": "IMOBILIÁRIO",
    "INCENDIO INDIVIDUAL RESIDENCIAL": "RESIDENCIAL",
    "INCENDIO INDIVIDUAL EMPRESARIAL": "EMPRESARIAL",
    COND: "CONDOMÍNIO",
    CONDOMINIO: "CONDOMÍNIO",
    EMPR: "EMPRESARIAL",
    EMPRESARIAL: "EMPRESARIAL",
    IMO: "IMOBILIÁRIO",
    IMOB: "IMOBILIÁRIO",
    IMOBILIARIO: "IMOBILIÁRIO",
    RESI: "RESIDENCIAL",
    RESIDENCIAL: "RESIDENCIAL",
    VIND: "VIDA INDIVIDUAL",
    "VIDA INDIVIDUAL": "VIDA INDIVIDUAL",
    VDCV: "VIDA COLETIVA / EM GRUPO",
    VGRP: "VIDA COLETIVA / EM GRUPO",
    "VIDA COLETIVA": "VIDA COLETIVA / EM GRUPO",
    "VIDA EM GRUPO": "VIDA COLETIVA / EM GRUPO",
    PORT: "EQUIPAMENTOS PORTÁTEIS",
    POR: "EQUIPAMENTOS PORTÁTEIS",
    "EQUIP. PORTATIL": "EQUIPAMENTOS PORTÁTEIS",
    "EQUIPAMENTO PORTATIL": "EQUIPAMENTOS PORTÁTEIS",
    "EQUIPAMENTOS PORTATEIS": "EQUIPAMENTOS PORTÁTEIS",
    AUTO: "AUTOMÓVEL",
    AUTOMOVEL: "AUTOMÓVEL",
    VIAGEM: "VIAGEM",
  };
  return mapa[normal] || texto(valor).toUpperCase() || "NÃO INFORMADO";
}

function seguradoraCanonica(valor: string): string {
  const normal = chave(valor);
  const mapa: Record<string, string> = {
    ALLI: "ALLIANZ",
    ALLIANZ: "ALLIANZ",
    PORT: "PORTO",
    PORTO: "PORTO",
    SUHA: "SUHAI",
    SUHAI: "SUHAI",
    TOKI: "TOKIO",
    TOKIO: "TOKIO",
    YELU: "YELUM",
    YELUM: "YELUM",
    ZURI: "ZURICH",
    ZURICH: "ZURICH",
    "COTAR EM + DE 1": "MÚLTIPLAS SEGURADORAS",
    SEGIMOB: "SEGIMOB — SEGURADORA NÃO INFORMADA",
  };
  return mapa[normal] || texto(valor).toUpperCase() || "NÃO INFORMADA";
}

function seguradoraPorOrigem(valor: string, origem: string): string {
  if (origem === "SEGIMOB" && !texto(valor)) return "SEGIMOB — SEGURADORA NÃO INFORMADA";
  return seguradoraCanonica(valor);
}

function cotadorCanonico(valor: string): string {
  const normal = chave(valor);
  if (normal === "ISA" || normal === "ISABELLE") return "ISABELLE";
  if (normal === "ANA" || normal === "ANA INGRID") return "ANA INGRID";
  if (normal.startsWith("AMANDA ")) return "AMANDA";
  if (normal.startsWith("BRUNA ")) return "BRUNA";
  if (normal.startsWith("ISABELLE ")) return "ISABELLE";
  if (normal.startsWith("ANA INGRID ")) return "ANA INGRID";
  if (normal.startsWith("JOAO ")) return "JOÃO";
  if (normal === "IMOBILIARIA") return "PRODUÇÃO DIRETA PELA IMOBILIÁRIA";
  return texto(valor).toUpperCase() || "NÃO INFORMADO";
}

function imobiliariaCanonica(valor: string): string {
  const normal = chave(valor);
  const mapa: Record<string, string> = {
    "PIRES E GAMA IMOBILIARIA": "PIRES E GAMA IMOBILIÁRIA",
    "IMOVEL UM": "IMÓVEL UM",
    IMOVELUM: "IMÓVEL UM",
    "SANDRA XAVIER": "SANDRA XAVIER",
    "SANDRA XAVIER (BASE)": "SANDRA XAVIER",
    "BARREIROS IMOVEIS": "BARREIROS IMÓVEIS",
    "BARREIROS IMOVEIS (SAVEDRA)": "BARREIROS IMÓVEIS",
  };
  return mapa[normal] || texto(valor).toUpperCase() || "NÃO INFORMADA";
}

function pertenceCompetencia(serial: number | null, competencia: string): boolean {
  if (serial === null) return true;
  const data = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
  const [ano, mes] = competencia.split("-").map(Number);
  return data.getUTCFullYear() === ano && data.getUTCMonth() + 1 === mes;
}

function diasDesdeSerial(serial: number | null, agora: Date): number | null {
  if (serial === null) return null;
  const data = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
  return Math.floor((agora.getTime() - data.getTime()) / 86_400_000);
}

function diasAteSerial(serial: number | null, agora: Date): number | null {
  if (serial === null) return null;
  const data = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
  return Math.ceil((data.getTime() - agora.getTime()) / 86_400_000);
}

function linhaNovaTemDados(linha: CelulaGoogle[]): boolean {
  const camposManuais = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 29, 31, 33, 35, 36, 37, 38, 39, 40, 41];
  return camposManuais.some((indice) => {
    const valor = linha[indice];
    return valor !== null && valor !== undefined && valor !== "" && valor !== false;
  });
}

function linhaEndossoTemDados(linha: CelulaGoogle[]): boolean {
  const camposManuais = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 20];
  return camposManuais.some((indice) => {
    const valor = linha[indice];
    return valor !== null && valor !== undefined && valor !== "" && valor !== false;
  });
}

function linhaRenovacaoTemDados(linha: CelulaGoogle[]): boolean {
  const camposManuais = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 16, 18, 20, 21, 23, 24, 25, 26];
  return camposManuais.some((indice) => {
    const valor = linha[indice];
    return valor !== null && valor !== undefined && valor !== "" && valor !== false;
  });
}

function mapearNovos(linhas: CelulaGoogle[][], aba: string, competencia?: string): RegistroNovo[] {
  return linhas
    .map((linha, indice): RegistroNovo | null => {
      const statusRaw = texto(linha[0]);
      if (!statusRaw) return null;
      const dataPreenchida = numeroOpcional(linha[5]);
      if (competencia && !pertenceCompetencia(dataPreenchida, competencia)) return null;
      const status = statusCanonico(statusRaw);
      const origem = chave(texto(linha[2]));
      return {
        aba,
        linha: indice + 2,
        status,
        origem,
        dataRecebida: numeroOpcional(linha[3]),
        dataPreenchida,
        dataInicio: numeroOpcional(linha[8]),
        horarioInicio: numeroOpcional(linha[9]),
        horarioFim: numeroOpcional(linha[10]),
        tempoGasto: numeroOpcional(linha[11]),
        diasCotacao: numeroOpcional(linha[12]),
        imobiliaria: imobiliariaCanonica(texto(linha[13])),
        segurado: texto(linha[14]),
        ramo: ramoCanonico(texto(linha[25])),
        seguradora: seguradoraPorOrigem(texto(linha[26]), origem),
        orcamento: texto(linha[27]),
        premioTotal: numero(linha[29]),
        cotador: cotadorCanonico(texto(linha[7])),
        comissao: numero(linha[32]),
        repasse: numero(linha[34]),
        dataEfetivacao: numeroOpcional(linha[39]),
        efetivado: status === "EFETIVADO",
        negociador: texto(linha[35]),
        ultimoContato: numeroOpcional(linha[36]),
        observacoes: texto(linha[37]),
      };
    })
    .filter((registro): registro is RegistroNovo => registro !== null);
}

function mapearRenovacoes(linhas: CelulaGoogle[][], aba: string): RegistroRenovacao[] {
  return linhas
    .map((linha, indice): RegistroRenovacao | null => {
      const statusRaw = texto(linha[0]);
      if (!statusRaw) return null;
      const status = statusCanonico(statusRaw);
      const operacao = chave(texto(linha[1]));
      return {
        aba,
        linha: indice + 2,
        status,
        operacao,
        apolice: texto(linha[2]),
        fimVigencia: numeroOpcional(linha[3]),
        imobiliaria: imobiliariaCanonica(texto(linha[4])),
        segurado: texto(linha[5]),
        ramo: ramoCanonico(texto(linha[7])),
        seguradora: seguradoraPorOrigem(texto(linha[8]), operacao),
        premioTotal: numero(linha[15]),
        comissaoAnterior: numero(linha[13]),
        comissao: numero(linha[17]),
        repasse: numero(linha[19]),
        cotador: cotadorCanonico(texto(linha[20])),
        dataEnvio: numeroOpcional(linha[21]),
        dataEfetivacao: numeroOpcional(linha[25]),
        efetivado: status === "EFETIVADO",
        ultimoContato: numeroOpcional(linha[23]),
      };
    })
    .filter((registro): registro is RegistroRenovacao => registro !== null);
}

function mapearEndossos(linhas: CelulaGoogle[][], aba: string): RegistroEndosso[] {
  return linhas
    .map((linha, indice): RegistroEndosso | null => {
      const statusRaw = texto(linha[0]);
      if (!statusRaw) return null;
      return {
        aba,
        linha: indice + 2,
        status: statusCanonico(statusRaw),
        dataRecebida: numeroOpcional(linha[3]),
        imobiliaria: imobiliariaCanonica(texto(linha[5])),
        segurado: texto(linha[6]),
        ramo: ramoCanonico(texto(linha[7])),
        apolice: texto(linha[8]),
        seguradora: seguradoraCanonica(texto(linha[9])),
        cotador: cotadorCanonico(texto(linha[10])),
        tempoGasto: numeroOpcional(linha[14]),
        restituicao: numero(linha[16]),
      };
    })
    .filter((registro): registro is RegistroEndosso => registro !== null);
}

function agrupar(registros: RegistroBase[], obterNome: (registro: RegistroBase) => string): ItemAgrupado[] {
  const grupos = new Map<string, RegistroBase[]>();
  for (const registro of registros) {
    const nome = obterNome(registro) || "NÃO INFORMADO";
    grupos.set(nome, [...(grupos.get(nome) || []), registro]);
  }
  return [...grupos.entries()]
    .map(([nome, itens]) => {
      const efetivados = itens.filter((item) => item.efetivado);
      return {
        nome,
        total: itens.length,
        efetivados: efetivados.length,
        conversao: itens.length ? (efetivados.length / itens.length) * 100 : null,
        comissao: itens.reduce((soma, item) => soma + item.comissao, 0),
        comissaoEfetivada: efetivados.reduce((soma, item) => soma + item.comissao, 0),
      };
    })
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, "pt-BR"));
}

function resumir(registros: (RegistroNovo | RegistroRenovacao)[]): ResumoPopulacao {
  const efetivados = registros.filter((registro) => registro.efetivado);
  const tempos = registros
    .map((registro) => ("tempoGasto" in registro ? registro.tempoGasto : null))
    .filter((valor): valor is number => typeof valor === "number" && valor >= 0);
  const comissaoPotencial = registros.reduce((soma, registro) => soma + registro.comissao, 0);
  const comissaoEfetivada = efetivados.reduce((soma, registro) => soma + registro.comissao, 0);
  const repasseEfetivado = efetivados.reduce((soma, registro) => soma + registro.repasse, 0);
  return {
    total: registros.length,
    efetivados: efetivados.length,
    conversao: registros.length ? (efetivados.length / registros.length) * 100 : null,
    premioTotal: registros.reduce((soma, registro) => soma + registro.premioTotal, 0),
    premioEfetivado: efetivados.reduce((soma, registro) => soma + registro.premioTotal, 0),
    comissaoPotencial,
    comissaoEfetivada,
    repasseEfetivado,
    resultadoEstimado: comissaoEfetivada - repasseEfetivado,
    comissaoAnterior: registros.reduce(
      (soma, registro) => soma + ("comissaoAnterior" in registro ? registro.comissaoAnterior : 0),
      0
    ),
    tempoMedioMinutos: tempos.length ? (tempos.reduce((soma, valor) => soma + valor, 0) / tempos.length) * 1440 : null,
    temposValidos: tempos.length,
    porStatus: agrupar(registros, (registro) => registro.status),
    porRamo: agrupar(registros, (registro) => registro.ramo),
    porCotador: agrupar(registros, (registro) => registro.cotador),
    porImobiliaria: agrupar(registros, (registro) => registro.imobiliaria),
    porSeguradora: agrupar(registros, (registro) => registro.seguradora),
  };
}

function agruparEndossos(registros: RegistroEndosso[], campo: keyof Pick<RegistroEndosso, "status" | "ramo" | "cotador" | "seguradora">): ItemAgrupado[] {
  const grupos = new Map<string, number>();
  for (const registro of registros) grupos.set(registro[campo], (grupos.get(registro[campo]) || 0) + 1);
  return [...grupos.entries()]
    .map(([nome, total]) => ({ nome, total, efetivados: 0, conversao: null, comissao: 0, comissaoEfetivada: 0 }))
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, "pt-BR"));
}

function alerta(codigo: string, titulo: string, descricao: string, quantidade: number, gravidade: AlertaRamos["gravidade"]): AlertaRamos {
  return { codigo, titulo, descricao, quantidade, gravidade };
}

function contarDuplicados(valores: string[]): number {
  const contagem = new Map<string, number>();
  for (const valor of valores.filter(Boolean)) contagem.set(valor, (contagem.get(valor) || 0) + 1);
  return [...contagem.values()].filter((total) => total > 1).length;
}

export function montarAnaliseRamosElementares(fonte: FonteRamosBruta, agora = new Date()): AnaliseRamosElementares {
  const abaPendentes = fonte.nomesAbas.novosPendentes || "NOVOS PENDENTES";
  const abaMes = fonte.nomesAbas.novosMes || "NOVOS MÊS";
  const abaRnAtual = fonte.nomesAbas.renovacoesAtual || "RN COMPETÊNCIA";
  const abaRnFutura = fonte.nomesAbas.renovacoesFutura || "RN PRÓXIMA COMPETÊNCIA";
  const abaEndossos = fonte.nomesAbas.endossos || "ENDOSSOS";

  const pendentes = mapearNovos(fonte.abas.novosPendentes, abaPendentes);
  const novosMes = mapearNovos(fonte.abas.novosMes, abaMes, fonte.competencia);
  const novosConsolidados = [...pendentes, ...novosMes];
  const rnAtual = mapearRenovacoes(fonte.abas.renovacoesAtual, abaRnAtual);
  const rnFutura = mapearRenovacoes(fonte.abas.renovacoesFutura, abaRnFutura);
  const endossos = mapearEndossos(fonte.abas.endossos, abaEndossos);

  const resumoPendentes = resumir(pendentes);
  const resumoMes = resumir(novosMes);
  const resumoNovos = resumir(novosConsolidados);
  const resumoRnAtual = resumir(rnAtual);
  const resumoRnFutura = resumir(rnFutura);

  const todosComerciais: (RegistroNovo | RegistroRenovacao)[] = [...novosConsolidados, ...rnAtual];
  const efetivados = todosComerciais.filter((registro) => registro.efetivado);
  const comissaoPotencial = todosComerciais.reduce((soma, registro) => soma + registro.comissao, 0);
  const comissaoEfetivada = efetivados.reduce((soma, registro) => soma + registro.comissao, 0);
  const repasseEstimado = efetivados.reduce((soma, registro) => soma + registro.repasse, 0);

  const origemDireta = (registro: RegistroNovo | RegistroRenovacao) =>
    ("origem" in registro && registro.origem === "SEGIMOB") ||
    ("operacao" in registro && registro.operacao === "SEGIMOB") ||
    registro.cotador === "PRODUÇÃO DIRETA PELA IMOBILIÁRIA";

  const semCotadorAvancado = todosComerciais.filter(
    (registro) => STATUS_AVANCADOS.has(registro.status) && registro.cotador === "NÃO INFORMADO" && !origemDireta(registro)
  ).length;
  const semSeguradoraAvancado = todosComerciais.filter(
    (registro) => STATUS_AVANCADOS.has(registro.status) && registro.seguradora === "NÃO INFORMADA"
  ).length;
  const segimobSemSeguradora = todosComerciais.filter(
    (registro) => registro.seguradora === "SEGIMOB — SEGURADORA NÃO INFORMADA"
  ).length;
  const semImobiliariaObrigatoria = todosComerciais.filter(
    (registro) =>
      ["RESIDENCIAL", "EMPRESARIAL", "IMOBILIÁRIO"].includes(registro.ramo) &&
      registro.imobiliaria === "NÃO INFORMADA"
  ).length;
  const efetivadoSemComissao = efetivados.filter((registro) => registro.comissao <= 0).length;
  const efetivadoSemData = efetivados.filter((registro) => registro.dataEfetivacao === null).length;
  const tempoNovoInvalido = novosConsolidados.filter(
    (registro) => STATUS_AVANCADOS.has(registro.status) && (registro.tempoGasto === null || registro.tempoGasto < 0)
  ).length;
  const tempoEndossoInvalido = endossos.filter((registro) => registro.tempoGasto === null || registro.tempoGasto < 0).length;
  const datasInvertidas = novosConsolidados.filter(
    (registro) =>
      (registro.horarioInicio !== null && registro.horarioFim !== null && registro.horarioFim < registro.horarioInicio) ||
      (registro.dataEfetivacao !== null && registro.dataRecebida !== null && registro.dataEfetivacao < registro.dataRecebida)
  ).length + rnAtual.filter(
    (registro) => registro.dataEfetivacao !== null && registro.dataEnvio !== null && registro.dataEfetivacao < registro.dataEnvio
  ).length;
  const linhasSemStatus =
    fonte.abas.novosPendentes.filter((linha) => !texto(linha[0]) && linhaNovaTemDados(linha)).length +
    fonte.abas.novosMes.filter((linha) => !texto(linha[0]) && linhaNovaTemDados(linha)).length +
    fonte.abas.renovacoesAtual.filter((linha) => !texto(linha[0]) && linhaRenovacaoTemDados(linha)).length +
    fonte.abas.renovacoesFutura.filter((linha) => !texto(linha[0]) && linhaRenovacaoTemDados(linha)).length +
    fonte.abas.endossos.filter((linha) => !texto(linha[0]) && linhaEndossoTemDados(linha)).length;
  const cotadoresNaoReconhecidos = todosComerciais.filter(
    (registro) => registro.cotador !== "NÃO INFORMADO" && !COTADORES_CONHECIDOS.has(registro.cotador)
  ).length;
  const duplicidades =
    contarDuplicados(rnAtual.map((registro) => registro.apolice)) +
    contarDuplicados(rnFutura.map((registro) => registro.apolice)) +
    contarDuplicados(novosConsolidados.map((registro) => registro.orcamento));

  const qualidade = [
    alerta("segimob-sem-seguradora", "SEGIMOB — Seguradora não informada", "Produção mantida com o canal Segimob identificado.", segimobSemSeguradora, "baixa"),
    alerta("sem-cotador", "Cotador não informado", "Somente registros que já avançaram e não são produção direta.", semCotadorAvancado, "media"),
    alerta("sem-seguradora", "Seguradora não informada", "Registro avançado sem seguradora e fora do caso Segimob.", semSeguradoraAvancado, "media"),
    alerta("sem-imobiliaria", "Imobiliária obrigatória ausente", "Aplicado apenas a Residencial, Empresarial e Imobiliário.", semImobiliariaObrigatoria, "media"),
    alerta("tempo-invalido", "Tempo gasto ausente ou inválido", "Excluído apenas da média de tempo.", tempoNovoInvalido + tempoEndossoInvalido, "media"),
    alerta("sem-comissao", "Efetivado sem comissão", "O negócio permanece efetivado, mas exige conferência financeira.", efetivadoSemComissao, "alta"),
    alerta("sem-data-efetivacao", "Efetivado sem data", "O fechamento permanece contado e recebe alerta.", efetivadoSemData, "alta"),
    alerta("datas-invertidas", "Datas ou horários inconsistentes", "Nenhuma data é corrigida automaticamente.", datasInvertidas, "alta"),
    alerta("duplicidade", "Possível duplicidade", "Os registros permanecem nos totais até a revisão da equipe.", duplicidades, "media"),
    alerta("sem-status", "Linha preenchida sem status", "Fica fora das análises por status até ser revisada.", linhasSemStatus, "alta"),
    alerta("cotador-nao-reconhecido", "Nome de cotador não reconhecido", "Mantido separadamente até autorização de normalização.", cotadoresNaoReconhecidos, "baixa"),
  ];

  const renovacoesVencidas = rnAtual.filter((registro) => {
    const dias = diasAteSerial(registro.fimVigencia, agora);
    return !STATUS_TERMINAIS.has(registro.status) && dias !== null && dias < 0;
  }).length;
  const renovacoesProximas = rnAtual.filter((registro) => {
    const dias = diasAteSerial(registro.fimVigencia, agora);
    return !STATUS_TERMINAIS.has(registro.status) && dias !== null && dias >= 0 && dias <= 15;
  }).length;
  const cotacoesParadas = novosConsolidados.filter((registro) => {
    const dias = registro.diasCotacao ?? diasDesdeSerial(registro.dataInicio, agora);
    return !STATUS_TERMINAIS.has(registro.status) && dias !== null && dias >= 6;
  }).length;
  const endossosPendentes = endossos.filter((registro) => registro.status === "PENDENTE").length;
  const endossosAntigos = endossos.filter((registro) => {
    const dias = diasDesdeSerial(registro.dataRecebida, agora);
    return registro.status === "PENDENTE" && dias !== null && dias >= 6;
  }).length;
  const alertasOperacionais = [
    alerta("renovacoes-vencidas", "Renovações vencidas", "Ainda sem status terminal na data da leitura.", renovacoesVencidas, "alta"),
    alerta("renovacoes-proximas", "Renovações próximas do vencimento", "Vencimento em até 15 dias e ainda sem conclusão.", renovacoesProximas, "media"),
    alerta("cotacoes-paradas", "Cotações paradas", "Em andamento há seis dias ou mais.", cotacoesParadas, "media"),
    alerta("endossos-pendentes", "Endossos ou cancelamentos pendentes", "Solicitações ainda não concluídas.", endossosPendentes, "media"),
    alerta("endossos-antigos", "Endossos pendentes antigos", "Pendentes há seis dias ou mais.", endossosAntigos, "alta"),
  ];

  const temposEndosso = endossos
    .map((registro) => registro.tempoGasto)
    .filter((valor): valor is number => typeof valor === "number" && valor >= 0);

  const negociacoes: RegistroNegociacao[] = [
    ...novosConsolidados.map(
      (registro): RegistroNegociacao => ({
        id: `${registro.aba}|${registro.linha}`,
        aba: registro.aba,
        linha: registro.linha,
        tipo: "novo",
        status: registro.status,
        nomePrincipal: nomePrincipal(registro.imobiliaria, registro.segurado, registro.cotador),
        imobiliaria: registro.imobiliaria,
        segurado: registro.segurado,
        seguradora: registro.seguradora,
        ramo: registro.ramo,
        apolice: null,
        premioTotal: registro.premioTotal,
        comissao: registro.comissao,
        negociador: registro.negociador || null,
        observacoes: registro.observacoes || null,
        diasSemContato: diasDesdeSerial(registro.ultimoContato, agora),
      })
    ),
    ...[...rnAtual, ...rnFutura].map(
      (registro): RegistroNegociacao => ({
        id: `${registro.aba}|${registro.linha}`,
        aba: registro.aba,
        linha: registro.linha,
        tipo: "renovacao",
        status: registro.status,
        nomePrincipal: nomePrincipal(registro.imobiliaria, registro.segurado, registro.cotador),
        imobiliaria: registro.imobiliaria,
        segurado: registro.segurado,
        seguradora: registro.seguradora,
        ramo: registro.ramo,
        apolice: registro.apolice || null,
        premioTotal: registro.premioTotal,
        comissao: registro.comissao,
        negociador: null,
        observacoes: null,
        diasSemContato: diasDesdeSerial(registro.ultimoContato, agora),
      })
    ),
    ...endossos.map(
      (registro): RegistroNegociacao => ({
        id: `${registro.aba}|${registro.linha}`,
        aba: registro.aba,
        linha: registro.linha,
        tipo: "endosso",
        status: registro.status,
        nomePrincipal: nomePrincipal(registro.imobiliaria, registro.segurado, registro.cotador),
        imobiliaria: registro.imobiliaria,
        segurado: registro.segurado,
        seguradora: registro.seguradora,
        ramo: registro.ramo,
        apolice: registro.apolice || null,
        premioTotal: 0,
        comissao: 0,
        negociador: null,
        observacoes: null,
        diasSemContato: null,
      })
    ),
  ];

  return {
    competencia: fonte.competencia,
    atualizadoEm: agora.toISOString(),
    fonte: fonte.planilha,
    avisosFonte: [
      ...fonte.avisos,
      ...(fonte.planilha.tipo === "bitrix24"
        ? []
        : [
            "A aba ENDOSSOS não possui um campo estruturado de tipo de movimentação; o painel não classifica observações por texto livre.",
          ]),
    ],
    semAmostra: novosConsolidados.length + rnAtual.length + rnFutura.length + endossos.length === 0,
    visaoGeral: {
      novasEntradas: novosMes.length,
      pendenciasAnteriores: pendentes.length,
      renovacoesCompetencia: rnAtual.length,
      novosEfetivados: resumoNovos.efetivados,
      renovacoesEfetivadas: resumoRnAtual.efetivados,
      comissaoEfetivada,
    },
    novos: { consolidado: resumoNovos, mes: resumoMes, pendentes: resumoPendentes },
    renovacoes: { atual: resumoRnAtual, futura: resumoRnFutura },
    financeiro: {
      comissaoPotencial,
      comissaoEfetivada,
      repasseEstimado,
      resultadoEstimado: comissaoEfetivada - repasseEstimado,
      conversaoFinanceira: comissaoPotencial > 0 ? (comissaoEfetivada / comissaoPotencial) * 100 : null,
    },
    endossos: {
      total: endossos.length,
      cancelados: endossos.filter((registro) => registro.status === "CANCELADO").length,
      pendentes: endossos.filter((registro) => registro.status === "PENDENTE").length,
      tempoMedioMinutos: temposEndosso.length
        ? (temposEndosso.reduce((soma, valor) => soma + valor, 0) / temposEndosso.length) * 1440
        : null,
      temposValidos: temposEndosso.length,
      temposInvalidos: tempoEndossoInvalido,
      restituicaoInformada: endossos.reduce((soma, registro) => soma + registro.restituicao, 0),
      porStatus: agruparEndossos(endossos, "status"),
      porRamo: agruparEndossos(endossos, "ramo"),
      porResponsavel: agruparEndossos(endossos, "cotador"),
      porSeguradora: agruparEndossos(endossos, "seguradora"),
    },
    alertasOperacionais,
    qualidade,
    negociacoes,
  };
}

export function analiseRamosVazia(competencia: string, mensagem: string): AnaliseRamosElementares {
  const fonte: FonteRamosBruta = {
    competencia,
    planilha: { id: "", titulo: "Fonte não disponível", url: "", modificadaEm: null },
    abas: { novosPendentes: [], novosMes: [], renovacoesAtual: [], renovacoesFutura: [], endossos: [] },
    nomesAbas: { novosPendentes: null, novosMes: null, renovacoesAtual: null, renovacoesFutura: null, endossos: null },
    avisos: [mensagem],
  };
  return montarAnaliseRamosElementares(fonte);
}
