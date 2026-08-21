import { envolverEmailO2, linhaCampo, blocoSecao, botaoPill, formatarData } from "./emailO2";
import type { DadosCapitalizacaoPlanilha } from "./planilhaCapitalizacao";

const ENTITY_TYPE_ID = 1048;
const CATEGORY_ID = 28;
const STAGE_ID = "DT1048_28:NEW";

type RespostaFormulario = string | string[] | number | boolean | null;

export type CapitalizacaoFormPayload = {
  formId: string;
  responseId: string;
  submittedAt: string;
  respondentEmail?: string | null;
  editResponseUrl?: string | null;
  answers: Record<string, RespostaFormulario>;
};

type BitrixFieldDefinition = {
  items?: Array<{ ID?: string; VALUE?: string; id?: string; value?: string }>;
};

type BitrixFieldsResponse = {
  result: { fields: Record<string, BitrixFieldDefinition> };
};

type BitrixListResponse = {
  result: { items: Array<{ id: number; title: string }> };
};

type BitrixAddResponse = {
  result: { item: { id: number; title: string } };
};

export const ITEM = {
  origem: "1762240566",
  imobiliaria: "479542475",
  emailImobiliaria: "1475427667",
  corretor: "216274232",
  emailCorretor: "223376031",
  premioTotal: "1275123438",
  encargos: "1038717666",
  prazo: "713914101",
  pagamento: "1032078892",
  titularCartao: "513208961",
  cpfCartao: "948679040",
  tipoLocatario: "176389459",
  locatPfNome: "1680330080",
  locatPfCpf: "92785321",
  locatPfNascimento: "1284516938",
  locatPfDocumento: "1295771338",
  locatPfOrgao: "1059021897",
  locatPfUf: "859207030",
  locatPfEmissao: "970527844",
  locatPfCivil: "941073464",
  locatPfProfissao: "107538752",
  locatPfRenda: "1037285935",
  locatEmail: "1797521819",
  locatTelefone: "2098342311",
  locatPjRazao: "1108627550",
  locatPjCnpj: "1454235893",
  locatPjFundacao: "1170741619",
  locatPjInscricao: "948185925",
  locatPjSocio: "1192154658",
  locatPjCpf: "906171356",
  locatPjRenda: "1865007298",
  locatPjEmail: "1335486668",
  locatPjTelefone: "1892091955",
  imovelCep: "194415499",
  imovelEndereco: "593914370",
  imovelLocalidade: "769715249",
  tipoLocador: "639670991",
  locadorPfNome: "1527323752",
  locadorPfCpf: "1933515754",
  locadorPfNascimento: "40367235",
  locadorPfDocumento: "1372581927",
  locadorPfOrgao: "198024116",
  locadorPfUf: "937881142",
  locadorPjRazao: "1182114877",
  locadorPjCnpj: "645972109",
  locadorPjFundacao: "1187818133",
  locadorPjInscricao: "1828669294",
  locadorPjSocio: "616928511",
  locadorPjCpf: "2139650385",
  locadorPjTelefone: "1553034136",
} as const;

const FIELD = {
  origem: "ufCrm14CapOrigem",
  imobiliaria: "ufCrm14CapImobAdmin",
  corretor: "ufCrm14CapCorretor",
  email: "ufCrm14CapEmailEnvio",
  premioTotal: "ufCrm14CapValorTit",
  encargos: "ufCrm14CapEncConsid",
  prazo: "ufCrm14CapPrazoRenov",
  pagamento: "ufCrm14CapFormaPgto",
  titularCartao: "ufCrm14CapTitCartao",
  cpfCartao: "ufCrm14CapCpfCartao",
  tipoLocatario: "ufCrm14CapTipoLocat",
  locatPfNome: "ufCrm14CapLocatPfNome",
  locatPfCpf: "ufCrm14CapLocatPfCpf",
  locatPfNascimento: "ufCrm14CapLocatPfNasc",
  locatPfDocumento: "ufCrm14CapLocatPfId",
  locatPfOrgao: "ufCrm14CapLocatPfOrg",
  locatPfUf: "ufCrm14CapLocatPfUf",
  locatPfEmissao: "ufCrm14CapLocatPfEmis",
  locatPfCivil: "ufCrm14CapLocatPfCivil",
  locatPfProfissao: "ufCrm14CapLocatPfProf",
  locatPfRenda: "ufCrm14CapLocatPfRenda",
  locatEmail: "ufCrm14CapLocatEmail",
  locatTelefone: "ufCrm14CapLocatFone",
  locatPjRazao: "ufCrm14CapLocatPjRazao",
  locatPjCnpj: "ufCrm14CapLocatPjCnpj",
  locatPjFundacao: "ufCrm14CapLocatPjFund",
  locatPjInscricao: "ufCrm14CapLocatPjInsc",
  locatPjSocio: "ufCrm14CapLocatPjSocio",
  locatPjCpf: "ufCrm14CapLocatPjCpf",
  locatPjRenda: "ufCrm14CapLocatPjRenda",
  imovelCep: "ufCrm14CapImovelCep",
  imovelEndereco: "ufCrm14CapImovelEnd",
  imovelBairro: "ufCrm14CapImovelBairro",
  imovelCidade: "ufCrm14CapImovelCidade",
  tipoLocador: "ufCrm14CapTipoLocador",
  locadorPfNome: "ufCrm14CapLocadorPfNome",
  locadorPfCpf: "ufCrm14CapLocadorPfCpf",
  locadorPfNascimento: "ufCrm14CapLocadorPfNasc",
  locadorPfDocumento: "ufCrm14CapLocadorPfId",
  locadorPfOrgao: "ufCrm14CapLocadorPfOrg",
  locadorPfUf: "ufCrm14CapLocadorPfUf",
  locadorPjRazao: "ufCrm14CapLocadorPjRazao",
  locadorPjCnpj: "ufCrm14CapLocadorPjCnpj",
  locadorPjFundacao: "ufCrm14CapLocadorPjFund",
  locadorPjInscricao: "ufCrm14CapLocadorPjInsc",
  locadorPjSocio: "ufCrm14CapLocadorPjSocio",
  locadorPjCpf: "ufCrm14CapLocadorPjCpf",
  locadorPjTelefone: "ufCrm14CapLocadorPjFone",
  responseId: "ufCrm14CapFormResponseId",
  responseUrl: "ufCrm14CapFormResponseUrl",
  submittedAt: "ufCrm14CapFormSubmittedAt",
  source: "ufCrm14CapFormSource",
} as const;

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

function texto(value: RespostaFormulario | undefined): string {
  if (Array.isArray(value)) return value.map(String).join("; ").trim();
  return value === null || value === undefined ? "" : String(value).trim();
}

function lista(value: RespostaFormulario | undefined): string[] | undefined {
  const content = texto(value);
  if (!content) return undefined;
  const values = content.split(/\r?\n|\s*;\s*/).map((item) => item.trim()).filter(Boolean);
  return values.length ? values : undefined;
}

function normalizar(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, " ").trim().toLowerCase();
}

export function numeroPtBr(value: RespostaFormulario | undefined): number | undefined {
  let raw = texto(value).replace(/R\$/gi, "").replace(/\s/g, "");
  if (!raw) return undefined;
  raw = raw.replace(/[^0-9,.-]/g, "");
  if (raw.includes(",")) raw = raw.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, "");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dinheiroBr(value: RespostaFormulario | undefined): string | undefined {
  const amount = numeroPtBr(value);
  return amount === undefined ? undefined : `${amount}|BRL`;
}

function dataIso(value: RespostaFormulario | undefined): string | undefined {
  const raw = texto(value);
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : undefined;
}

function prazo(value: RespostaFormulario | undefined): string | undefined {
  return texto(value).match(/\b(12|15|18|24|30)\b/)?.[1] ? `${texto(value).match(/\b(12|15|18|24|30)\b/)?.[1]} meses` : undefined;
}

function pagamento(value: RespostaFormulario | undefined): string | undefined {
  const normalized = normalizar(texto(value));
  if (normalized.includes("boleto")) return "Boleto";
  if (normalized.includes("cartao")) return "Cartão";
  return undefined;
}

function enumId(definitions: Record<string, BitrixFieldDefinition>, fieldName: string, wanted?: string): string | undefined {
  if (!wanted) return undefined;
  const target = normalizar(wanted);
  const item = definitions[fieldName]?.items?.find((candidate) => normalizar(candidate.VALUE ?? candidate.value ?? "") === target);
  return item?.ID ?? item?.id;
}

function localidade(value: RespostaFormulario | undefined) {
  const raw = texto(value);
  if (!raw) return { bairro: undefined, cidade: undefined };
  const parts = raw.split(/\s*,\s*/).filter(Boolean);
  if (parts.length >= 2) return { bairro: parts[0], cidade: parts.slice(1).join(", ") };
  return { bairro: raw, cidade: undefined };
}

function set(fields: Record<string, unknown>, name: string, value: unknown) {
  if (value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length)) fields[name] = value;
}

export function validarPayloadCapitalizacao(value: unknown): CapitalizacaoFormPayload {
  if (!value || typeof value !== "object") throw new Error("Payload inválido");
  const payload = value as Partial<CapitalizacaoFormPayload>;
  if (payload.formId !== "1aazIlD6x06iPaEzW6MZlwqO3N5aaADyrvZOtQxDb958") throw new Error("Formulário não autorizado");
  if (!payload.responseId || typeof payload.responseId !== "string") throw new Error("responseId ausente");
  if (!payload.submittedAt || typeof payload.submittedAt !== "string") throw new Error("submittedAt ausente");
  if (!payload.answers || typeof payload.answers !== "object") throw new Error("answers ausente");
  return payload as CapitalizacaoFormPayload;
}

export async function criarCardCapitalizacao(payload: CapitalizacaoFormPayload) {
  const duplicate = await bitrix<BitrixListResponse>("crm.item.list", {
    entityTypeId: ENTITY_TYPE_ID,
    filter: { [FIELD.responseId]: payload.responseId },
    select: ["id", "title"],
  });
  if (duplicate.result.items.length) return { created: false, item: duplicate.result.items[0] };

  const definitionResponse = await bitrix<BitrixFieldsResponse>("crm.item.fields", { entityTypeId: ENTITY_TYPE_ID });
  const definitions = definitionResponse.result.fields;
  const answer = (id: string) => payload.answers[id];
  const locality = localidade(answer(ITEM.imovelLocalidade));
  const locatarioPf = normalizar(texto(answer(ITEM.tipoLocatario))).includes("fisica");
  const locadorPf = normalizar(texto(answer(ITEM.tipoLocador))).includes("fisica");
  const title = texto(answer(locatarioPf ? ITEM.locatPfNome : ITEM.locatPjRazao))
    || texto(answer(ITEM.imobiliaria))
    || texto(answer(ITEM.corretor))
    || `Capitalização ${payload.responseId}`;
  const email = texto(answer(ITEM.emailImobiliaria)) || texto(answer(ITEM.emailCorretor)) || texto(payload.respondentEmail);
  const address = [texto(answer(ITEM.imovelEndereco)), texto(answer(ITEM.imovelLocalidade))].filter(Boolean).join(" — ");

  const fields: Record<string, unknown> = {
    title,
    categoryId: CATEGORY_ID,
    stageId: STAGE_ID,
  };
  set(fields, FIELD.origem, enumId(definitions, FIELD.origem,
    normalizar(texto(answer(ITEM.origem))).includes("imobiliaria") ? "Imobiliária"
      : normalizar(texto(answer(ITEM.origem))).includes("corretor") ? "Corretor individual" : "Proprietário"));
  set(fields, FIELD.imobiliaria, texto(answer(ITEM.imobiliaria)));
  set(fields, FIELD.corretor, texto(answer(ITEM.corretor)));
  set(fields, FIELD.email, email);
  set(fields, FIELD.premioTotal, dinheiroBr(answer(ITEM.premioTotal)));
  set(fields, FIELD.encargos, enumId(definitions, FIELD.encargos,
    normalizar(texto(answer(ITEM.encargos))).startsWith("sim") ? "Sim" : "Não"));
  set(fields, FIELD.prazo, enumId(definitions, FIELD.prazo, prazo(answer(ITEM.prazo))));
  set(fields, FIELD.pagamento, enumId(definitions, FIELD.pagamento, pagamento(answer(ITEM.pagamento))));
  set(fields, FIELD.titularCartao, lista(answer(ITEM.titularCartao)));
  set(fields, FIELD.cpfCartao, lista(answer(ITEM.cpfCartao)));
  set(fields, FIELD.tipoLocatario, enumId(definitions, FIELD.tipoLocatario, locatarioPf ? "Pessoa física" : "Pessoa jurídica"));
  set(fields, FIELD.locatEmail, texto(answer(locatarioPf ? ITEM.locatEmail : ITEM.locatPjEmail)));
  set(fields, FIELD.locatTelefone, texto(answer(locatarioPf ? ITEM.locatTelefone : ITEM.locatPjTelefone)));
  if (locatarioPf) {
    set(fields, FIELD.locatPfNome, texto(answer(ITEM.locatPfNome)));
    set(fields, FIELD.locatPfCpf, texto(answer(ITEM.locatPfCpf)));
    set(fields, FIELD.locatPfNascimento, dataIso(answer(ITEM.locatPfNascimento)));
    set(fields, FIELD.locatPfDocumento, texto(answer(ITEM.locatPfDocumento)));
    set(fields, FIELD.locatPfOrgao, texto(answer(ITEM.locatPfOrgao)));
    set(fields, FIELD.locatPfUf, enumId(definitions, FIELD.locatPfUf, texto(answer(ITEM.locatPfUf))));
    set(fields, FIELD.locatPfEmissao, dataIso(answer(ITEM.locatPfEmissao)));
    set(fields, FIELD.locatPfCivil, enumId(definitions, FIELD.locatPfCivil, texto(answer(ITEM.locatPfCivil))));
    set(fields, FIELD.locatPfProfissao, texto(answer(ITEM.locatPfProfissao)));
    set(fields, FIELD.locatPfRenda, dinheiroBr(answer(ITEM.locatPfRenda)));
  } else {
    set(fields, FIELD.locatPjRazao, texto(answer(ITEM.locatPjRazao)));
    set(fields, FIELD.locatPjCnpj, texto(answer(ITEM.locatPjCnpj)));
    set(fields, FIELD.locatPjFundacao, dataIso(answer(ITEM.locatPjFundacao)));
    set(fields, FIELD.locatPjInscricao, texto(answer(ITEM.locatPjInscricao)));
    set(fields, FIELD.locatPjSocio, texto(answer(ITEM.locatPjSocio)));
    set(fields, FIELD.locatPjCpf, texto(answer(ITEM.locatPjCpf)));
    set(fields, FIELD.locatPjRenda, dinheiroBr(answer(ITEM.locatPjRenda)));
  }
  set(fields, FIELD.imovelCep, texto(answer(ITEM.imovelCep)));
  set(fields, FIELD.imovelEndereco, address);
  set(fields, FIELD.imovelBairro, locality.bairro);
  set(fields, FIELD.imovelCidade, locality.cidade);
  set(fields, FIELD.tipoLocador, enumId(definitions, FIELD.tipoLocador, locadorPf ? "Pessoa física" : "Pessoa jurídica"));
  if (locadorPf) {
    set(fields, FIELD.locadorPfNome, texto(answer(ITEM.locadorPfNome)));
    set(fields, FIELD.locadorPfCpf, texto(answer(ITEM.locadorPfCpf)));
    set(fields, FIELD.locadorPfNascimento, dataIso(answer(ITEM.locadorPfNascimento)));
    set(fields, FIELD.locadorPfDocumento, texto(answer(ITEM.locadorPfDocumento)));
    set(fields, FIELD.locadorPfOrgao, texto(answer(ITEM.locadorPfOrgao)));
    set(fields, FIELD.locadorPfUf, enumId(definitions, FIELD.locadorPfUf, texto(answer(ITEM.locadorPfUf))));
  } else {
    set(fields, FIELD.locadorPjRazao, texto(answer(ITEM.locadorPjRazao)));
    set(fields, FIELD.locadorPjCnpj, texto(answer(ITEM.locadorPjCnpj)));
    set(fields, FIELD.locadorPjFundacao, dataIso(answer(ITEM.locadorPjFundacao)));
    set(fields, FIELD.locadorPjInscricao, texto(answer(ITEM.locadorPjInscricao)));
    set(fields, FIELD.locadorPjSocio, texto(answer(ITEM.locadorPjSocio)));
    set(fields, FIELD.locadorPjCpf, texto(answer(ITEM.locadorPjCpf)));
    set(fields, FIELD.locadorPjTelefone, texto(answer(ITEM.locadorPjTelefone)));
  }
  set(fields, FIELD.responseId, payload.responseId);
  set(fields, FIELD.responseUrl, payload.editResponseUrl ?? undefined);
  set(fields, FIELD.submittedAt, payload.submittedAt);
  set(fields, FIELD.source, "Google Forms — Ficha Online - Capitalização");

  const added = await bitrix<BitrixAddResponse>("crm.item.add", { entityTypeId: ENTITY_TYPE_ID, fields });
  return { created: true, item: added.result.item };
}

const BITRIX_BASE_URL = "https://o2seguros.bitrix24.com.br";

// Notifica cap@o2seguros.com.br a cada envio de /capitalizacao -- o card já
// é criado na SPA "Título de Capitalização" (acima), mas essa caixa de
// e-mail é o jeito de alguém saber na hora que chegou uma ficha nova.
// Reaproveita o mesmo objeto DadosCapitalizacaoPlanilha já montado em
// capitalizacao/actions.ts pra planilha de conferência -- campos já vêm
// nomeados de forma limpa, sem precisar ler de novo o Record<string,string>
// "answers" indexado por ITEM.*.
export function montarEmailCapitalizacao(d: DadosCapitalizacaoPlanilha, resultado: { created: boolean; item: { id: number } }): { assunto: string; html: string } {
  const linkCard = `${BITRIX_BASE_URL}/crm/type/${ENTITY_TYPE_ID}/details/${resultado.item.id}/`;
  const ehLocatarioPf = d.tipoLocatario === "PF";
  const ehLocadorPf = d.tipoLocador === "PF";

  const enderecoImovel = [
    [d.imovelLogradouro, d.imovelNumero].filter(Boolean).join(", "),
    d.imovelComplemento,
    d.imovelBairro,
    [d.imovelCidade, d.imovelUf].filter(Boolean).join("/"),
    d.imovelCep,
  ]
    .filter(Boolean)
    .join(" — ");

  const nomePrincipal = (ehLocatarioPf ? d.locatPfNome : d.locatPjRazao) || d.imobiliariaNome || d.corretorNome;

  const corpoHtml = [
    blocoSecao(
      "Contato / origem",
      [
        linhaCampo("Seu e-mail", d.emailContato),
        linhaCampo("Quem administra", d.quemAdministra),
        linhaCampo("Imobiliária — Nome", d.imobiliariaNome),
        linhaCampo("Imobiliária — E-mail", d.imobiliariaEmail),
        linhaCampo("Corretor — Nome", d.corretorNome),
        linhaCampo("Corretor — E-mail", d.corretorEmail),
      ].join("")
    ),
    blocoSecao(
      "Título de Capitalização",
      [
        linhaCampo("Valor do título", d.valorTitulo ? `R$ ${d.valorTitulo}` : ""),
        linhaCampo("Encargos considerados", d.encargosConsiderados),
        linhaCampo("Prazo", d.prazo),
        linhaCampo("Forma de pagamento", d.formaPagamento),
        linhaCampo("Titular do cartão", d.titularCartao),
        linhaCampo("CPF do titular do cartão", d.cpfCartao),
      ].join("")
    ),
    blocoSecao(
      "Imóvel",
      [linhaCampo("Endereço", enderecoImovel)].join("")
    ),
    ehLocatarioPf
      ? blocoSecao(
          "Locatário (Pessoa Física)",
          [
            linhaCampo("Nome", d.locatPfNome),
            linhaCampo("CPF", d.locatPfCpf),
            linhaCampo("Nascimento", formatarData(d.locatPfNascimento)),
            linhaCampo("RG", d.locatPfRg),
            linhaCampo("Órgão expedidor", d.locatPfRgOrgao),
            linhaCampo("UF do RG", d.locatPfRgUf),
            linhaCampo("Data de emissão", formatarData(d.locatPfRgEmissao)),
            linhaCampo("Estado civil", d.locatPfEstadoCivil),
            linhaCampo("Profissão", d.locatPfProfissao),
            linhaCampo("Renda mensal", d.locatPfRenda ? `R$ ${d.locatPfRenda}` : ""),
            linhaCampo("E-mail", d.locatEmail),
            linhaCampo("Telefone", d.locatTelefone),
          ].join("")
        )
      : blocoSecao(
          "Locatário (Pessoa Jurídica)",
          [
            linhaCampo("Razão social", d.locatPjRazao),
            linhaCampo("CNPJ", d.locatPjCnpj),
            linhaCampo("Fundação", formatarData(d.locatPjFundacao)),
            linhaCampo("Inscrição estadual", d.locatPjInscricao),
            linhaCampo("Sócio responsável", d.locatPjSocio),
            linhaCampo("CPF do sócio", d.locatPjSocioCpf),
            linhaCampo("Faturamento mensal", d.locatPjRenda ? `R$ ${d.locatPjRenda}` : ""),
            linhaCampo("E-mail", d.locatEmail),
            linhaCampo("Telefone", d.locatTelefone),
          ].join("")
        ),
    ehLocadorPf
      ? blocoSecao(
          "Locador (Pessoa Física)",
          [
            linhaCampo("Nome", d.locadorPfNome),
            linhaCampo("CPF", d.locadorPfCpf),
            linhaCampo("Nascimento", formatarData(d.locadorPfNascimento)),
            linhaCampo("RG", d.locadorPfRg),
            linhaCampo("Órgão expedidor", d.locadorPfRgOrgao),
            linhaCampo("UF do RG", d.locadorPfRgUf),
          ].join("")
        )
      : blocoSecao(
          "Locador (Pessoa Jurídica)",
          [
            linhaCampo("Razão social", d.locadorPjRazao),
            linhaCampo("CNPJ", d.locadorPjCnpj),
            linhaCampo("Fundação", formatarData(d.locadorPjFundacao)),
            linhaCampo("Inscrição estadual", d.locadorPjInscricao),
            linhaCampo("Sócio responsável", d.locadorPjSocio),
            linhaCampo("CPF do sócio", d.locadorPjSocioCpf),
            linhaCampo("Telefone", d.locadorPjTelefone),
          ].join("")
        ),
    botaoPill(linkCard, resultado.created ? "Ver card no Bitrix →" : "Ver card existente no Bitrix →"),
  ].join("");

  const html = envolverEmailO2({
    badge: "Capitalização",
    titulo: "Nova ficha preenchida! 💰",
    introducao: resultado.created
      ? `${nomePrincipal} acabou de preencher a ficha de Capitalização pela Plataforma O2. Confira tudo o que foi informado abaixo:`
      : `${nomePrincipal} preencheu a ficha de novo — o protocolo já existia, então o card no Bitrix não foi duplicado.`,
    corpoHtml,
    protocolo: d.responseId,
    origem: "/capitalizacao",
  });

  return { assunto: `Nova cotação Capitalização — ${nomePrincipal}`, html };
}
