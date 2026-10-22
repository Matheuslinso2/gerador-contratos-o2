// Cria o card de intake na SPA "Ramos Elementares" (entityTypeId 1046,
// categoria 22 "Contratações", etapa inicial DT1046_22:NEW) a partir da
// ficha preenchida na landing page /seguro-incendio. Mesmo espírito de
// seguroAuto.ts/capitalizacao.ts: sem SDK, fetch puro contra o
// BITRIX_WEBHOOK_URL.
//
// Campos confirmados via crm.item.fields em 21/08/2026. Essa SPA é
// compartilhada com o painel interno de Ramos Elementares (ver
// src/lib/ramos-elementares/fonteBitrix.ts) e não tem campo de observações
// estruturado pros dados brutos do proprietário/imóvel (CPF, aluguel...) --
// só campos de produção (seguradora, prêmio, comissão, preenchidos depois
// pela equipe). Por isso os dados brutos da ficha individual continuam indo
// também formatados em texto dentro de "Observações operacionais"
// (ufCrm12Observacoes), igual um atendente digitaria ao criar o card na mão.
//
// Endereço do imóvel: pedido do Matheus, 22/09/2026 -- a equipe criou campos
// próprios pra CEP/Logradouro/Número/Complemento/Bairro-Cidade (e um campo
// de Aluguel) na SPA, confirmados via crm.item.fields em 22/09/2026. Os
// campos de endereço só existem pro fluxo individual (Residencial/
// Empresarial) -- Imobiliário é uma planilha com vários endereços, sem
// campo estruturado por item.
//
// O campo "Planilha de itens" (ufCrm12PlanilhaItens) é MÚLTIPLO
// (isMultiple: true) -- diferente dos campos de arquivo único do Seguro
// Auto, aqui o valor precisa ser uma lista de tuplas [nome, base64].
import type { SupabaseClient } from "@supabase/supabase-js";
import { envolverEmailO2, linhaCampo, blocoSecao, botaoPill } from "./emailO2";

const ENTITY_TYPE_ID = 1046;
const CATEGORY_ID = 22;
const STAGE_ID = "DT1046_22:NEW";

const FIELD = {
  tipoProcesso: "ufCrm12TipoProcesso",
  produto: "ufCrm12Produto",
  origemProducao: "ufCrm12OrigemProducao",
  cotadorOrigem: "ufCrm12CotadorOrigem",
  observacoes: "ufCrm12Observacoes",
  qtdEnderecos: "ufCrm12QtdEnderecos",
  referenciaPlanilha: "ufCrm12ReferenciaPlanilha",
  planilhaItens: "ufCrm12PlanilhaItens",
  // Endereço do imóvel (só fluxo individual) -- códigos confirmados via
  // crm.item.fields em 22/09/2026.
  imovelLogradouro: "ufCrm12_1790085424526",
  imovelNumero: "ufCrm12_1790085444491",
  imovelComplemento: "ufCrm12_1790085448344",
  imovelBairroCidade: "ufCrm12_1790085451655",
  imovelCep: "ufCrm12_1790085456047",
  imovelAluguel: "ufCrm12_1790085479280",
} as const;

export type ModalidadeIncendio = "Residencial" | "Empresarial" | "Imobiliario";

const PRODUTO_POR_MODALIDADE: Record<ModalidadeIncendio, string> = {
  Residencial: "Incêndio Individual Residencial",
  Empresarial: "Incêndio Individual Empresarial",
  Imobiliario: "Incêndio Imobiliário",
};

// Coberturas que a pessoa pode marcar na ficha Individual (Residencial e
// Empresarial -- o Imobiliário segue só com a planilha). Tudo opcional: a
// pessoa informa um valor OU marca "tenho interesse" sem valor, e a equipe
// orienta depois. A "dica" é o texto do ⓘ ensinando como chegar no valor.
export const COBERTURAS_INCENDIO = [
  {
    chave: "incendio",
    label: "Incêndio, raio e explosão",
    dica: "É a cobertura principal. Sugerimos informar o valor de reconstrução do imóvel (quanto custaria reconstruí-lo do zero, sem contar o terreno).",
  },
  {
    chave: "danosEletricos",
    label: "Danos elétricos",
    dica: "Cobre a queima de aparelhos por curto-circuito ou variação de tensão. Some o valor de todos os equipamentos elétricos e eletrônicos do imóvel e informe o total.",
  },
  {
    chave: "rouboFurto",
    label: "Roubo e furto de bens",
    dica: "Some o valor dos móveis, eletrodomésticos e pertences que ficam no imóvel e informe o total.",
  },
  {
    chave: "vendavalFumaca",
    label: "Vendaval e fumaça",
    dica: "Danos causados por ventos fortes e fumaça. Normalmente acompanha o mesmo valor da cobertura de incêndio (valor de reconstrução).",
  },
  {
    chave: "responsabilidadeCivil",
    label: "Responsabilidade civil",
    dica: "Cobre danos que o imóvel cause a terceiros (por exemplo, um incêndio que atinja o vizinho). Informe o valor máximo de proteção que você gostaria de ter.",
  },
  {
    chave: "perdaAluguel",
    label: "Perda/pagamento de aluguel",
    dica: "Se o imóvel ficar inabitável após um sinistro, cobre o aluguel no período. Sugerimos multiplicar o valor do aluguel pelos meses que você quer cobrir (ex.: 12).",
  },
  {
    chave: "lucrosCessantes",
    label: "Lucros cessantes",
    apenasEmpresarial: true,
    dica: "Cobre o lucro que a empresa deixa de ter enquanto o imóvel está parado após um sinistro. Estime o lucro bruto mensal e multiplique pelos meses de paralisação que quer cobrir.",
  },
  {
    chave: "equipamentosMercadorias",
    label: "Equipamentos eletrônicos e mercadorias",
    apenasEmpresarial: true,
    dica: "Some o valor dos equipamentos eletrônicos e do estoque de mercadorias da empresa e informe o total.",
  },
] as const;

type CoberturaIncendioDef = (typeof COBERTURAS_INCENDIO)[number];

export function coberturasDaModalidade(modalidade: ModalidadeIncendio): CoberturaIncendioDef[] {
  if (modalidade === "Imobiliario") return [];
  return COBERTURAS_INCENDIO.filter((c) => !("apenasEmpresarial" in c) || modalidade === "Empresarial");
}

// valor "" = "tenho interesse", sem valor informado (equipe orienta depois)
export type CoberturaSelecionada = { chave: string; label: string; valor: string };

function textoCobertura(c: CoberturaSelecionada): string {
  return c.valor ? `R$ ${c.valor}` : "tenho interesse, sem valor informado (orientar)";
}

export type SeguroIncendioPayload = {
  responseId: string;
  modalidade: ModalidadeIncendio;
  coberturas: CoberturaSelecionada[]; // só Residencial/Empresarial
  // Individual (Residencial ou Empresarial)
  email: string;
  solicitante: string; // "Proprietário" | "Inquilino" | "Imobiliária/Administradora"
  finsLocacao: string; // "Sim" | "Não" -- só perguntado quando solicitante é Proprietário
  nomeProprietario: string;
  cpfProprietario: string;
  atividadeComercial: string; // só Empresarial
  imovelCep: string;
  imovelLogradouro: string;
  imovelNumero: string;
  imovelComplemento: string;
  imovelBairro: string;
  imovelCidade: string;
  imovelUf: string;
  metragem: string;
  valorAluguel: string;
  administradoPorImobiliaria: string; // "Sim" | "Não"
  nomeImobiliaria: string;
  preferencias: string;
  telefone: string;
  // Imobiliário
  qtdEnderecos: string;
  anexoPlanilha: string; // caminho no bucket seguro-incendio-anexos, "" se não enviado
  anexoPlanilhaNome: string;
};

const BUCKET_ANEXOS = "seguro-incendio-anexos";

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
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`Bitrix ${method}: ${data.error_description || data.error || `HTTP ${response.status}`}`);
  }
  return data as T;
}

function normalizar(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function enumId(defs: Record<string, BitrixFieldDefinition>, campo: string, desejado: string): string | undefined {
  if (!desejado) return undefined;
  const alvo = normalizar(desejado);
  const item = defs[campo]?.items?.find((i) => normalizar(i.VALUE ?? "") === alvo);
  return item?.ID;
}

function set(fields: Record<string, unknown>, name: string, value: unknown) {
  if (value !== undefined && value !== null && value !== "") fields[name] = value;
}

export type ArquivoBaixado = {
  /** Nome original que a pessoa enviou (vai pro e-mail). */
  nome: string;
  /** Nome só com caracteres seguros (vai pro Bitrix). */
  nomeBitrix: string;
  conteudo: Buffer;
  tipo: string;
};

const TIPO_POR_EXTENSAO: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  pdf: "application/pdf",
};

// Baixa a planilha do Storage (service role). Quem chama decide o que fazer
// com ela (campo do card e/ou anexo do e-mail). Se o download falhar, LANÇA
// erro com o motivo -- antes isso era engolido e o card saía sem arquivo, sem
// ninguém saber.
export async function baixarPlanilhaIncendio(supabase: SupabaseClient, payload: SeguroIncendioPayload): Promise<ArquivoBaixado | undefined> {
  if (!payload.anexoPlanilha) return undefined;
  const { data, error } = await supabase.storage.from(BUCKET_ANEXOS).download(payload.anexoPlanilha);
  if (error || !data) {
    throw new Error(`Não foi possível baixar a planilha do Storage (${payload.anexoPlanilha}): ${error?.message ?? "arquivo vazio"}`);
  }
  const conteudo = Buffer.from(await data.arrayBuffer());
  const extensao = (payload.anexoPlanilha.split(".").pop() || "bin").toLowerCase();
  return {
    nome: payload.anexoPlanilhaNome || `planilha-incendio-imobiliario.${extensao}`,
    nomeBitrix: `planilha-incendio-imobiliario.${extensao}`,
    conteudo,
    tipo: TIPO_POR_EXTENSAO[extensao] ?? "application/octet-stream",
  };
}

type BitrixGetResponse = { result: { item: Record<string, unknown> } };

function campoTemArquivo(valor: unknown): boolean {
  if (Array.isArray(valor)) return valor.length > 0;
  return Boolean(valor);
}

// "Planilha de itens" é um campo de arquivo MÚLTIPLO. O Bitrix pode aceitar a
// chamada sem erro e mesmo assim deixar o campo vazio quando o formato do
// valor não é o esperado (foi o que fez o card sair sem a planilha). Por isso
// cada tentativa é conferida lendo o card de volta (crm.item.get), e só vale se
// o campo realmente ficou preenchido.
async function anexarPlanilhaAoCard(itemId: number, arquivo: ArquivoBaixado): Promise<{ ok: boolean; motivo?: string }> {
  const par: [string, string] = [arquivo.nomeBitrix, arquivo.conteudo.toString("base64")];
  const tentativas: Array<{ formato: string; valor: unknown }> = [
    { formato: "lista de objetos fileData", valor: [{ fileData: par }] },
    { formato: "lista de pares [nome, base64]", valor: [par] },
  ];
  let ultimoMotivo = "";
  for (const tentativa of tentativas) {
    try {
      await bitrix("crm.item.update", {
        entityTypeId: ENTITY_TYPE_ID,
        id: itemId,
        fields: { [FIELD.planilhaItens]: tentativa.valor },
      });
      const lido = await bitrix<BitrixGetResponse>("crm.item.get", { entityTypeId: ENTITY_TYPE_ID, id: itemId });
      if (campoTemArquivo(lido.result.item[FIELD.planilhaItens])) return { ok: true };
      ultimoMotivo = `o Bitrix aceitou o formato "${tentativa.formato}" mas o campo continuou vazio`;
    } catch (erro) {
      ultimoMotivo = `formato "${tentativa.formato}": ${erro instanceof Error ? erro.message : String(erro)}`;
    }
  }
  return { ok: false, motivo: ultimoMotivo };
}

// Combina bairro+cidade+UF no mesmo texto que vai pro campo único
// "BAIRRO/CIDADE" do Bitrix (a SPA não separa cidade de UF).
function bairroCidadeTexto(p: SeguroIncendioPayload): string {
  return [p.imovelBairro, [p.imovelCidade, p.imovelUf].filter(Boolean).join("/")].filter(Boolean).join(", ");
}

// Mesma lógica de paraNumero em actions.ts (o valor já chega mascarado em
// pt-BR, ex: "2.000,00"), mas aqui devolve undefined em vez de 0 pra "set"
// poder pular o campo quando não há aluguel aplicável.
function paraNumeroAluguel(valor: string): number | undefined {
  if (!valor) return undefined;
  const limpo = valor.replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
  const numero = Number(limpo);
  return Number.isFinite(numero) ? numero : undefined;
}

function montarObservacoes(p: SeguroIncendioPayload): string {
  if (p.modalidade === "Imobiliario") {
    return [
      `Imobiliária: ${p.nomeImobiliaria}`,
      `E-mail: ${p.email}`,
      `Telefone: ${p.telefone}`,
      p.qtdEnderecos ? `Quantidade de endereços na planilha: ${p.qtdEnderecos}` : "",
      "Origem: ficha online /seguro-incendio (modalidade Imobiliário, planilha em anexo)",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `E-mail: ${p.email}`,
    `Quem solicitou: ${p.solicitante}`,
    p.solicitante === "Proprietário" ? `Cotação para fins de locação a terceiros: ${p.finsLocacao}` : "",
    `Nome do proprietário: ${p.nomeProprietario}`,
    `CPF do proprietário: ${p.cpfProprietario}`,
    `Finalidade do imóvel: ${p.modalidade === "Empresarial" ? "Comercial" : "Residencial"}`,
    p.atividadeComercial ? `Atividade comercial: ${p.atividadeComercial}` : "",
    `CEP do imóvel: ${p.imovelCep}`,
    `Logradouro: ${p.imovelLogradouro}`,
    p.imovelNumero ? `Número: ${p.imovelNumero}` : "",
    p.imovelComplemento ? `Complemento: ${p.imovelComplemento}` : "",
    bairroCidadeTexto(p) ? `Bairro/Cidade: ${bairroCidadeTexto(p)}` : "",
    p.metragem ? `Metragem: ${p.metragem} m²` : "",
    p.valorAluguel ? `Valor do aluguel: R$ ${p.valorAluguel}` : "",
    `Administrado por imobiliária: ${p.administradoPorImobiliaria}${
      p.administradoPorImobiliaria === "Sim" && p.nomeImobiliaria ? ` (${p.nomeImobiliaria})` : ""
    }`,
    p.coberturas.length ? `Coberturas de interesse:\n${p.coberturas.map((c) => `- ${c.label}: ${textoCobertura(c)}`).join("\n")}` : "",
    p.preferencias ? `Preferências: ${p.preferencias}` : "",
    `Telefone: ${p.telefone}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export type ResultadoAnexoPlanilha = {
  /** Arquivo baixado do Storage (para anexar também ao e-mail). Ausente se o download falhou. */
  arquivo?: ArquivoBaixado;
  /** true só quando o campo "Planilha de itens" do card ficou realmente preenchido. */
  noCard: boolean;
  motivo?: string;
};

export type ResultadoCardIncendio = {
  created: boolean;
  item: { id: number; title?: string };
  anexo?: ResultadoAnexoPlanilha;
};

export async function criarCardSeguroIncendio(payload: SeguroIncendioPayload, supabase: SupabaseClient): Promise<ResultadoCardIncendio> {
  // Dedup por xmlId ("ID externo") -- mesmo padrão do Seguro Auto: essa SPA
  // não tem campo de responseId próprio pra usar como chave de dedup.
  const duplicata = await bitrix<BitrixListResponse>("crm.item.list", {
    entityTypeId: ENTITY_TYPE_ID,
    filter: { xmlId: payload.responseId },
    select: ["id", "title"],
  });
  if (duplicata.result.items.length) return { created: false, item: duplicata.result.items[0] };

  const definitionResponse = await bitrix<BitrixFieldsResponse>("crm.item.fields", { entityTypeId: ENTITY_TYPE_ID });
  const defs = definitionResponse.result.fields;

  const title =
    payload.modalidade === "Imobiliario"
      ? payload.nomeImobiliaria || `Incêndio Imobiliário ${payload.responseId}`
      : payload.nomeProprietario || `Incêndio ${payload.responseId}`;

  const fields: Record<string, unknown> = {
    title,
    xmlId: payload.responseId,
    categoryId: CATEGORY_ID,
    stageId: STAGE_ID,
  };

  set(fields, FIELD.tipoProcesso, enumId(defs, FIELD.tipoProcesso, "Novo"));
  set(fields, FIELD.produto, enumId(defs, FIELD.produto, PRODUTO_POR_MODALIDADE[payload.modalidade]));
  set(fields, FIELD.origemProducao, enumId(defs, FIELD.origemProducao, "Ficha"));
  if (payload.modalidade === "Imobiliario") set(fields, FIELD.cotadorOrigem, payload.nomeImobiliaria);
  else if (payload.administradoPorImobiliaria === "Sim") set(fields, FIELD.cotadorOrigem, payload.nomeImobiliaria);
  set(fields, FIELD.observacoes, montarObservacoes(payload));

  if (payload.modalidade === "Imobiliario") {
    set(fields, FIELD.qtdEnderecos, payload.qtdEnderecos ? Number(payload.qtdEnderecos) : undefined);
    set(fields, FIELD.referenciaPlanilha, payload.anexoPlanilhaNome);
    // A planilha em si é anexada DEPOIS de criar o card (ver mais abaixo), com
    // conferência de que o campo realmente ficou preenchido.
  } else {
    set(fields, FIELD.imovelCep, payload.imovelCep);
    set(fields, FIELD.imovelLogradouro, payload.imovelLogradouro);
    set(fields, FIELD.imovelNumero, payload.imovelNumero);
    set(fields, FIELD.imovelComplemento, payload.imovelComplemento);
    set(fields, FIELD.imovelBairroCidade, bairroCidadeTexto(payload));
    const aluguel = paraNumeroAluguel(payload.valorAluguel);
    if (aluguel !== undefined) fields[FIELD.imovelAluguel] = `${aluguel}|BRL`;
  }

  const added = await bitrix<BitrixAddResponse>("crm.item.add", { entityTypeId: ENTITY_TYPE_ID, fields });

  // Planilha do fluxo Imobiliário: o card já existe, então qualquer falha aqui
  // NÃO derruba o envio -- vira um aviso (no log, no e-mail e na resposta).
  let anexo: ResultadoAnexoPlanilha | undefined;
  if (payload.modalidade === "Imobiliario" && payload.anexoPlanilha) {
    try {
      const arquivo = await baixarPlanilhaIncendio(supabase, payload);
      if (arquivo) {
        const resultadoCard = await anexarPlanilhaAoCard(added.result.item.id, arquivo);
        anexo = { arquivo, noCard: resultadoCard.ok, motivo: resultadoCard.motivo };
      }
    } catch (erro) {
      anexo = { noCard: false, motivo: erro instanceof Error ? erro.message : String(erro) };
    }
    if (anexo && !anexo.noCard) {
      console.error(`Seguro Incêndio: planilha NÃO anexada ao card ${added.result.item.id}: ${anexo.motivo}`);
    }
  }
  return { created: true, item: added.result.item, anexo };
}

const BITRIX_BASE_URL = "https://o2seguros.bitrix24.com.br";

// Notifica incendio@o2seguros.com.br a cada envio de /seguro-incendio -- o
// card já é criado na SPA "Ramos Elementares" (acima), mas essa caixa de
// e-mail é o jeito de alguém saber na hora que chegou uma ficha nova.
export function montarEmailSeguroIncendio(p: SeguroIncendioPayload, resultado: ResultadoCardIncendio): { assunto: string; html: string } {
  const linkCard = `${BITRIX_BASE_URL}/crm/type/${ENTITY_TYPE_ID}/details/${resultado.item.id}/`;
  const nomePrincipal = p.modalidade === "Imobiliario" ? p.nomeImobiliaria : p.nomeProprietario;

  const secoesHtml =
    p.modalidade === "Imobiliario"
      ? [
          blocoSecao(
            "Imobiliária",
            [
              linhaCampo("Nome da imobiliária", p.nomeImobiliaria),
              linhaCampo("E-mail", p.email),
              linhaCampo("Telefone", p.telefone),
            ].join("")
          ),
          blocoSecao(
            "Planilha de itens",
            [
              linhaCampo("Quantidade de endereços", p.qtdEnderecos),
              linhaCampo("Arquivo enviado", p.anexoPlanilhaNome ? `📎 ${p.anexoPlanilhaNome}` : "— Não enviado"),
              resultado.anexo
                ? linhaCampo(
                    "Anexo no card do Bitrix",
                    resultado.anexo.noCard
                      ? "✅ Anexada ao card"
                      : `⚠️ NÃO foi anexada ao card automaticamente${resultado.anexo.arquivo ? " — a planilha segue anexada neste e-mail, é só subir no card" : " e não foi possível anexá-la a este e-mail; peça o arquivo ao cliente"}.`
                  )
                : "",
            ].join("")
          ),
        ].join("")
      : [
          blocoSecao(
            "Solicitante",
            [
              linhaCampo("Quem solicitou", p.solicitante),
              p.solicitante === "Proprietário" ? linhaCampo("Cotação para fins de locação a terceiros", p.finsLocacao) : "",
            ].join("")
          ),
          blocoSecao(
            "Proprietário",
            [
              linhaCampo("Nome completo", p.nomeProprietario),
              linhaCampo("CPF", p.cpfProprietario),
              linhaCampo("E-mail", p.email),
              linhaCampo("Telefone", p.telefone),
            ].join("")
          ),
          blocoSecao(
            "Imóvel",
            [
              linhaCampo("Finalidade", p.modalidade === "Empresarial" ? "Comercial" : "Residencial"),
              linhaCampo("Atividade comercial", p.atividadeComercial),
              linhaCampo("CEP", p.imovelCep),
              linhaCampo("Logradouro", p.imovelLogradouro),
              linhaCampo("Número", p.imovelNumero),
              linhaCampo("Complemento", p.imovelComplemento),
              linhaCampo("Bairro/Cidade", bairroCidadeTexto(p)),
              linhaCampo("Metragem", p.metragem ? `${p.metragem} m²` : ""),
              linhaCampo("Valor do aluguel", p.valorAluguel ? `R$ ${p.valorAluguel}` : ""),
            ].join("")
          ),
          blocoSecao(
            "Coberturas de interesse",
            p.coberturas.map((c) => linhaCampo(c.label, textoCobertura(c))).join("")
          ),
          blocoSecao(
            "Administração",
            [
              linhaCampo("Administrado por imobiliária", p.administradoPorImobiliaria),
              linhaCampo("Nome da imobiliária", p.nomeImobiliaria),
              linhaCampo("Preferências", p.preferencias),
            ].join("")
          ),
        ].join("");

  const corpoHtml = secoesHtml + botaoPill(linkCard, resultado.created ? "Ver card no Bitrix →" : "Ver card existente no Bitrix →");

  const html = envolverEmailO2({
    badge: `Seguro Incêndio — ${p.modalidade}`,
    titulo: "Nova ficha preenchida! 🔥",
    introducao: resultado.created
      ? `${nomePrincipal} acabou de preencher a ficha de Seguro Incêndio pela Plataforma O2. Confira tudo o que foi informado abaixo:`
      : `${nomePrincipal} preencheu a ficha de novo — o protocolo já existia, então o card no Bitrix não foi duplicado.`,
    corpoHtml,
    protocolo: p.responseId,
    origem: "/seguro-incendio",
  });

  return { assunto: `Nova cotação Seguro Incêndio (${p.modalidade}) — ${nomePrincipal}`, html };
}
