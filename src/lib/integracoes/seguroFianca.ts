// Cria o card de intake na SPA "Seguro Fiança" (entityTypeId 1042, funil
// "Análise e Cotação") a partir da ficha preenchida na landing page
// /ficha-fianca. Mesmo espírito de capitalizacao.ts: sem SDK, fetch puro
// contra o mesmo BITRIX_WEBHOOK_URL (escopo CRM já tem permissão de
// crm.item.add, confirmado em produção pela integração de Capitalização).
//
// Mapeamento de campo confirmado em 2026-08-12 cruzando as perguntas do
// Google Forms "Ficha Fiança 5G" (que continua ativo, sem nenhuma alteração)
// com crm.item.fields(entityTypeId=1042) e cards reais criados manualmente
// pela equipe. Por decisão do Matheus: o nome da administradora/corretor
// fica só como texto no card (sem vincular Empresa do Bitrix), e o card
// nasce na etapa "Nova Solicitação" (fila de entrada), não pulando direto
// pra "Aguardando Cotação" como os cards digitados manualmente hoje.

const ENTITY_TYPE_ID = 1042;
const CATEGORY_ID = 18; // Análise e Cotação
const STAGE_ID = "DT1042_18:NEW"; // Nova Solicitação

type Resposta = string | number | null | undefined;

export type LocatarioPfPayload = {
  nome: string;
  cpf: string;
  email: string;
  telefone: string;
  profissao: string;
  rendaMensal: string;
  empresaNome?: string;
  empresaSalarioBruto?: string;
  empresaTelefone?: string;
};

export type FichaFiancaPayload = {
  formId: "landing-page-o2-ficha-fianca";
  responseId: string;
  submittedAt: string;

  vocEIs: "Pretendente à locação" | "Administrador/Corretor de Imóveis" | "Proprietário do Imóvel";
  imovelAdministrado: "Sim" | "Não" | "";
  adminNome: string;
  adminEmail: string;
  adminTelefone: string;
  proprietarioNome: string;
  proprietarioEmail: string;
  proprietarioTelefone: string;

  finalidadeImovel: "Residencial" | "Não-Residencial";
  imovelCep: string;
  imovelLogradouro: string;
  imovelNumero: string;
  imovelComplemento: string;
  imovelBairro: string;
  imovelCidade: string;
  imovelUf: string;
  aluguel: string;
  condominio: string;
  iptu: string;
  agua: string;
  luz: string;
  gas: string;
  prazoVigenciaTexto: string;

  tipoPessoaLocatario: "1" | "2" | "3" | "PJ";
  locatarios: LocatarioPfPayload[]; // 1 a 3 itens quando PF
  locatPjRazao: string;
  locatPjCnpj: string;
  locatPjEmail: string;
  locatPjTelefone: string;
  locatPjComentarios: string;

  seguroIncendio: "Sim" | "Não";
};

const FIELD = {
  vocEIs: "ufCrm10_1781120236",
  imovelAdministrado: "ufCrm10_1781116076",
  adminNome: "ufCrm10_1783371296",
  adminEmail: "ufCrm10_1783371317",
  adminTelefone: "ufCrm10_1781116295",
  proprietarioNome: "ufCrm10_1783366608",
  proprietarioEmail: "ufCrm10_1783366629",
  proprietarioTelefone: "ufCrm10_1783366640",

  finalidadeImovel: "ufCrm10_1781116634",
  tipoLocacao: "ufCrm10_1776351302",
  cep: "ufCrm10_1776351647",
  logradouro: "ufCrm10_1776351662",
  numero: "ufCrm10_1776351686",
  complemento: "ufCrm10_1776351702",
  cidade: "ufCrm10_1776351708",
  uf: "ufCrm10_1776351720",
  enderecoCompleto: "ufCrm10_1781116682",
  aluguel: "ufCrm10_1776352052",
  condominio: "ufCrm10_1776352074",
  iptu: "ufCrm10_1776352100",
  agua: "ufCrm10_1776352111",
  luz: "ufCrm10_1776352123",
  gas: "ufCrm10_1776352136",
  pacoteLocacao: "ufCrm10_1776352154",
  prazoVigenciaTexto: "ufCrm10_1781118337",
  vigenciaEnum: "ufCrm10_1776351520",

  tipoPessoaLocatario: "ufCrm10_1781118439",
  tipoAnalise: "ufCrm10_1776351482",

  loc1Cpf: "ufCrm10_1776351609",
  loc1Nome: "ufCrm10_1776354897",
  loc1Email: "ufCrm10_1783366659",
  loc1Telefone: "ufCrm10_1783366668",
  loc1Profissao: "ufCrm10_1783366679",
  loc1Renda: "ufCrm10_1783437800",
  loc1EmpresaNome: "ufCrm10_1783366837",
  loc1EmpresaSalario: "ufCrm10_1783366865",
  loc1EmpresaTelefone: "ufCrm10_1783366882",

  loc2Nome: "ufCrm10_1783438270",
  loc2Cpf: "ufCrm10_1783438283",
  loc2Email: "ufCrm10_1783438294",
  loc2Telefone: "ufCrm10_1783438303",
  loc2Profissao: "ufCrm10_1783438333",
  loc2Renda: "ufCrm10_1783438340",
  loc2EmpresaSalario: "ufCrm10_1783438352",
  loc2EmpresaNome: "ufCrm10_1783438369",
  loc2EmpresaTelefone: "ufCrm10_1783438381",

  loc3Nome: "ufCrm10_1783438393",
  loc3Cpf: "ufCrm10_1783438400",
  loc3Email: "ufCrm10_1783438409",
  loc3Telefone: "ufCrm10_1783438417",
  loc3Profissao: "ufCrm10_1783438428",
  loc3Renda: "ufCrm10_1783438436",
  loc3EmpresaNome: "ufCrm10_1783438447",
  loc3EmpresaSalario: "ufCrm10_1783438455",
  loc3EmpresaTelefone: "ufCrm10_1783438463",

  locPjRazao: "ufCrm10_1783437674",
  locPjCnpj: "ufCrm10_1783437706",
  locPjEmail: "ufCrm10_1783437733",
  locPjTelefone: "ufCrm10_1783437764",
  observacoes: "ufCrm10_1776352503",

  seguroIncendio: "ufCrm10_1783437875",
} as const;

// Estados aceitos pelos campos de enumeração "UF" da SPA — confirmado via
// crm.item.fields, só essas 6 opções existem hoje. Fora dessas, não seta o
// enum (evita erro de API), mas o endereço completo continua sendo salvo.
const UFS_VALIDAS = new Set(["MG", "PR", "RJ", "RS", "SP", "SC"]);

type BitrixFieldDefinition = { items?: Array<{ ID?: string; VALUE?: string }> };
type BitrixFieldsResponse = { result: { fields: Record<string, BitrixFieldDefinition> } };
type BitrixListResponse = { result: { items: Array<{ id: number; title: string }> } };
type BitrixAddResponse = { result: { item: { id: number; title: string } } };

function webhookUrl() {
  const value = process.env.BITRIX_WEBHOOK_URL;
  if (!value) throw new Error("BITRIX_WEBHOOK_URL não configurada");
  return value.endsWith("/") ? value : `${value}/`;
}

async function bitrix<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${webhookUrl()}${method}.json`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`Bitrix ${method}: ${data.error_description || data.error || `HTTP ${response.status}`}`);
  }
  return data as T;
}

function texto(v: Resposta): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

function normalizar(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function enumId(defs: Record<string, BitrixFieldDefinition>, campo: string, desejado?: string): string | undefined {
  if (!desejado) return undefined;
  const alvo = normalizar(desejado);
  const item = defs[campo]?.items?.find((i) => normalizar(i.VALUE ?? "") === alvo);
  return item?.ID;
}

// Igual a set()+enumId(), mas registra um aviso quando a pessoa escolheu
// algo no formulário e o Bitrix não tem nenhuma opção equivalente — sem
// isso, o campo simplesmente fica vazio no card e ninguém percebe. Usado
// só nos campos de múltipla escolha que vêm direto da escolha da pessoa
// (não nos inferidos, tipo Tipo de Locação/Tipo de Análise).
function setEnumComAviso(
  fields: Record<string, unknown>,
  avisos: string[],
  defs: Record<string, BitrixFieldDefinition>,
  campo: string,
  desejado: string | undefined,
  rotulo: string
) {
  if (!desejado) return;
  const id = enumId(defs, campo, desejado);
  if (id) fields[campo] = id;
  else avisos.push(`${rotulo}: "${desejado}" não bateu com nenhuma opção do Bitrix — campo ficou vazio no card.`);
}

function numeroPtBr(v: Resposta): number | undefined {
  const raw = texto(v).replace(/R\$/gi, "").replace(/\s/g, "").replace(",", ".");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dinheiro(v: Resposta): string {
  return `${numeroPtBr(v) ?? 0}|BRL`;
}

function soDigitos(v: Resposta): string {
  return texto(v).replace(/\D/g, "");
}

// Campos de telefone/CNPJ da SPA são tipados como número (double) no
// Bitrix, não string — confirmado em cards reais (ex: telefone salvo como
// 21968816452, não "21968816452"). Envia number puro; string vazia vira
// undefined pra não sujar o card com "0".
function numeroOuIndefinido(v: Resposta): number | undefined {
  const d = soDigitos(v);
  return d ? Number(d) : undefined;
}

function prazoParaEnum(textoLivre: string): string | undefined {
  const match = texto(textoLivre).match(/\b(12|24|30|36|48|50|60)\b/);
  return match ? `${match[1]} Meses` : undefined;
}

function set(fields: Record<string, unknown>, name: string, value: unknown) {
  if (value !== undefined && value !== null && value !== "") fields[name] = value;
}

export function validarPayloadFichaFianca(value: unknown): FichaFiancaPayload {
  if (!value || typeof value !== "object") throw new Error("Payload inválido");
  const p = value as Partial<FichaFiancaPayload>;
  if (p.formId !== "landing-page-o2-ficha-fianca") throw new Error("Formulário não autorizado");
  if (!p.responseId) throw new Error("responseId ausente");
  return p as FichaFiancaPayload;
}

export async function criarCardSeguroFianca(payload: FichaFiancaPayload) {
  // Dedup por responseId: usa o campo de Observações Adicionais como
  // carimbo (`[resp:<id>]`) já que não existe campo dedicado de
  // responseId nesta SPA — evita reenvio duplicado em duplo clique/retry,
  // mesmo espírito do dedup de Capitalização (lá existe campo próprio).
  const marcaResposta = `[resp:${payload.responseId}]`;
  const duplicata = await bitrix<BitrixListResponse>("crm.item.list", {
    entityTypeId: ENTITY_TYPE_ID,
    filter: { [`%${FIELD.observacoes}`]: marcaResposta },
    select: ["id", "title"],
  });
  if (duplicata.result.items.length) return { created: false, item: duplicata.result.items[0], avisos: [] as string[] };

  const definitionResponse = await bitrix<BitrixFieldsResponse>("crm.item.fields", { entityTypeId: ENTITY_TYPE_ID });
  const defs = definitionResponse.result.fields;
  const avisos: string[] = [];

  const ehPj = payload.tipoPessoaLocatario === "PJ";
  const locatarios = ehPj ? [] : payload.locatarios.slice(0, payload.tipoPessoaLocatario === "1" ? 1 : payload.tipoPessoaLocatario === "2" ? 2 : 3);

  const nomes = ehPj ? [payload.locatPjRazao] : locatarios.map((l) => l.nome).filter(Boolean);
  const title = nomes.filter(Boolean).join(" / ") || payload.adminNome || payload.proprietarioNome || `Ficha Fiança ${payload.responseId}`;

  const enderecoCompleto = [
    [payload.imovelLogradouro, payload.imovelNumero].filter(Boolean).join(", "),
    payload.imovelComplemento,
    payload.imovelBairro,
    [payload.imovelCidade, payload.imovelUf].filter(Boolean).join("/"),
    payload.imovelCep,
  ]
    .filter(Boolean)
    .join(" — ");

  const aluguel = numeroPtBr(payload.aluguel) ?? 0;
  const condominio = numeroPtBr(payload.condominio) ?? 0;
  const iptu = numeroPtBr(payload.iptu) ?? 0;
  const agua = numeroPtBr(payload.agua) ?? 0;
  const luz = numeroPtBr(payload.luz) ?? 0;
  const gas = numeroPtBr(payload.gas) ?? 0;
  const pacoteLocacao = aluguel + condominio + iptu + agua + luz + gas;

  const fields: Record<string, unknown> = { title, categoryId: CATEGORY_ID, stageId: STAGE_ID };

  setEnumComAviso(fields, avisos, defs, FIELD.vocEIs, payload.vocEIs, "Você é");
  setEnumComAviso(fields, avisos, defs, FIELD.imovelAdministrado, payload.imovelAdministrado || undefined, "Imóvel será administrado?");
  set(fields, FIELD.adminNome, texto(payload.adminNome));
  set(fields, FIELD.adminEmail, texto(payload.adminEmail));
  set(fields, FIELD.adminTelefone, texto(payload.adminTelefone));
  set(fields, FIELD.proprietarioNome, texto(payload.proprietarioNome));
  set(fields, FIELD.proprietarioEmail, texto(payload.proprietarioEmail));
  set(fields, FIELD.proprietarioTelefone, numeroOuIndefinido(payload.proprietarioTelefone));

  setEnumComAviso(fields, avisos, defs, FIELD.finalidadeImovel, payload.finalidadeImovel, "Finalidade do imóvel");
  set(
    fields,
    FIELD.tipoLocacao,
    enumId(defs, FIELD.tipoLocacao, payload.finalidadeImovel === "Residencial" ? "Residencial" : "Comercial")
  );
  set(fields, FIELD.cep, texto(payload.imovelCep));
  set(fields, FIELD.logradouro, texto(payload.imovelLogradouro));
  set(fields, FIELD.numero, texto(payload.imovelNumero));
  set(fields, FIELD.complemento, texto(payload.imovelComplemento));
  set(fields, FIELD.cidade, texto(payload.imovelCidade));
  const ufNormalizada = texto(payload.imovelUf).toUpperCase();
  if (ufNormalizada && UFS_VALIDAS.has(ufNormalizada)) setEnumComAviso(fields, avisos, defs, FIELD.uf, ufNormalizada, "UF do imóvel");
  else if (ufNormalizada) avisos.push(`UF do imóvel: "${ufNormalizada}" não é uma das UFs configuradas no Bitrix (MG, PR, RJ, RS, SP, SC) — campo ficou vazio no card.`);
  set(fields, FIELD.enderecoCompleto, enderecoCompleto);
  set(fields, FIELD.aluguel, dinheiro(payload.aluguel));
  set(fields, FIELD.condominio, condominio ? dinheiro(payload.condominio) : undefined);
  set(fields, FIELD.iptu, iptu ? dinheiro(payload.iptu) : undefined);
  set(fields, FIELD.agua, agua ? dinheiro(payload.agua) : undefined);
  set(fields, FIELD.luz, luz ? dinheiro(payload.luz) : undefined);
  set(fields, FIELD.gas, gas ? dinheiro(payload.gas) : undefined);
  set(fields, FIELD.pacoteLocacao, `${pacoteLocacao}|BRL`);
  set(fields, FIELD.prazoVigenciaTexto, texto(payload.prazoVigenciaTexto));
  set(fields, FIELD.vigenciaEnum, enumId(defs, FIELD.vigenciaEnum, prazoParaEnum(payload.prazoVigenciaTexto)));

  setEnumComAviso(
    fields,
    avisos,
    defs,
    FIELD.tipoPessoaLocatario,
    ehPj
      ? "Pessoa Jurídica"
      : payload.tipoPessoaLocatario === "1"
        ? "1 locatário Pessoa Física"
        : payload.tipoPessoaLocatario === "2"
          ? "2 locatários Pessoa Física"
          : "3 locatários Pessoa Física",
    "Tipo de pessoa do locatário"
  );
  set(fields, FIELD.tipoAnalise, enumId(defs, FIELD.tipoAnalise, ehPj ? "Jurídica" : "Física"));

  if (ehPj) {
    set(fields, FIELD.locPjRazao, texto(payload.locatPjRazao));
    set(fields, FIELD.locPjCnpj, numeroOuIndefinido(payload.locatPjCnpj));
    set(fields, FIELD.locPjEmail, texto(payload.locatPjEmail));
    set(fields, FIELD.locPjTelefone, numeroOuIndefinido(payload.locatPjTelefone));
  } else {
    const l1 = locatarios[0];
    if (l1) {
      set(fields, FIELD.loc1Cpf, texto(l1.cpf));
      set(fields, FIELD.loc1Nome, texto(l1.nome));
      set(fields, FIELD.loc1Email, texto(l1.email));
      set(fields, FIELD.loc1Telefone, numeroOuIndefinido(l1.telefone));
      setEnumComAviso(fields, avisos, defs, FIELD.loc1Profissao, l1.profissao, "Profissão do locatário 1");
      set(fields, FIELD.loc1Renda, l1.rendaMensal ? dinheiro(l1.rendaMensal) : undefined);
      set(fields, FIELD.loc1EmpresaNome, texto(l1.empresaNome));
      set(fields, FIELD.loc1EmpresaSalario, l1.empresaSalarioBruto ? dinheiro(l1.empresaSalarioBruto) : undefined);
      set(fields, FIELD.loc1EmpresaTelefone, numeroOuIndefinido(l1.empresaTelefone));
    }
    const l2 = locatarios[1];
    if (l2) {
      set(fields, FIELD.loc2Nome, texto(l2.nome));
      set(fields, FIELD.loc2Cpf, texto(l2.cpf));
      set(fields, FIELD.loc2Email, texto(l2.email));
      set(fields, FIELD.loc2Telefone, numeroOuIndefinido(l2.telefone));
      set(fields, FIELD.loc2Profissao, texto(l2.profissao)); // campo string na SPA, não enum
      set(fields, FIELD.loc2Renda, l2.rendaMensal ? dinheiro(l2.rendaMensal) : undefined);
      set(fields, FIELD.loc2EmpresaSalario, l2.empresaSalarioBruto ? dinheiro(l2.empresaSalarioBruto) : undefined);
      set(fields, FIELD.loc2EmpresaNome, texto(l2.empresaNome));
      set(fields, FIELD.loc2EmpresaTelefone, numeroOuIndefinido(l2.empresaTelefone));
    }
    const l3 = locatarios[2];
    if (l3) {
      set(fields, FIELD.loc3Nome, texto(l3.nome));
      set(fields, FIELD.loc3Cpf, texto(l3.cpf));
      set(fields, FIELD.loc3Email, texto(l3.email));
      set(fields, FIELD.loc3Telefone, numeroOuIndefinido(l3.telefone));
      set(fields, FIELD.loc3Profissao, texto(l3.profissao));
      set(fields, FIELD.loc3Renda, l3.rendaMensal ? dinheiro(l3.rendaMensal) : undefined);
      set(fields, FIELD.loc3EmpresaNome, texto(l3.empresaNome));
      set(fields, FIELD.loc3EmpresaSalario, l3.empresaSalarioBruto ? dinheiro(l3.empresaSalarioBruto) : undefined);
      set(fields, FIELD.loc3EmpresaTelefone, numeroOuIndefinido(l3.empresaTelefone));
    }
  }

  setEnumComAviso(fields, avisos, defs, FIELD.seguroIncendio, payload.seguroIncendio, "Seguro incêndio");

  const observacoesPartes = [ehPj ? texto(payload.locatPjComentarios) : "", marcaResposta].filter(Boolean);
  set(fields, FIELD.observacoes, observacoesPartes.join(" "));

  const added = await bitrix<BitrixAddResponse>("crm.item.add", { entityTypeId: ENTITY_TYPE_ID, fields });
  return { created: true, item: added.result.item, avisos };
}
