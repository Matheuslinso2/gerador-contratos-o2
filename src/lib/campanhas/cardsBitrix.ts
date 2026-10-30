import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarTodasPaginasFlat, chamarBitrix } from "@/lib/bitrix/client";
import { buscarEmLotes } from "@/lib/supabase/emLotes";
import { imobiliariasDaCampanha } from "./imobiliariasDaCampanha";
import { participantesDaCampanha } from "./metasCampanha";

// Cards do funil Campanhas do Bitrix (30/10/2026). Cada card = UMA imobiliária
// dentro de UMA campanha do Workspace. A ligação fica em campanhas_cards_bitrix
// (campanha + imobiliária da base única + card). Duas operações:
//  - vincularCardsExistentes: só LÊ o Bitrix e grava a ligação (campanhas que já
//    tinham cards, como o Clube Elite). Não cria nada no Bitrix.
//  - criarCardsDaCampanha: cria, para cada imobiliária sem card, a Empresa (se
//    ela ainda não existir no Bitrix) e o card no funil Campanhas. Idempotente:
//    quem já tem ligação é pulado, então rodar duas vezes não duplica.

export const FUNIL_CAMPANHAS = 12;
export const ETAPA_INICIAL = "C12:NEW"; // Preparação da campanha
const CAMPO_INICIO = "UF_CRM_1791415305057";
const CAMPO_FIM = "UF_CRM_1791415322176";
const BITRIX_BASE_URL = "https://o2seguros.bitrix24.com.br";

export const linkDoCard = (dealId: number | string) => `${BITRIX_BASE_URL}/crm/deal/details/${dealId}/`;

type CampanhaMin = { id: string; nome: string; valido_de: string | null; valido_ate: string | null; imobiliarias_selecionadas?: string[] | null; criado_por_email?: string | null };
type DealBruto = { ID: string; TITLE: string; COMPANY_ID: string | null; UF_CRM_1791415290699?: string | null };
type LigacaoRow = { imobiliaria_id: string; bitrix_deal_id: number; bitrix_company_id: number | null; origem: string; titulo: string | null };

const ehTeste = (titulo: string) => /^teste t[eé]cnico/i.test(titulo.trim());

export function tituloDoCard(nomeImobiliaria: string, nomeCampanha: string): string {
  return `${nomeImobiliaria.trim()} — ${nomeCampanha.trim()}`.slice(0, 250);
}

async function dealsDoFunil(): Promise<DealBruto[]> {
  return buscarTodasPaginasFlat<DealBruto>("crm.deal.list", {
    "filter[CATEGORY_ID]": FUNIL_CAMPANHAS,
    "select[]": ["ID", "TITLE", "COMPANY_ID", "UF_CRM_1791415290699"],
  } as never);
}

async function empresasConfirmadas(db: SupabaseClient, idsImobiliarias: string[]): Promise<Map<string, number>> {
  const linhas = await buscarEmLotes<{ imobiliaria_id: string; chave_externa: string }>(idsImobiliarias, (lote) =>
    db.from("imobiliaria_registros_fonte").select("imobiliaria_id, chave_externa").eq("fonte", "bitrix_empresa").eq("situacao", "confirmado").in("imobiliaria_id", lote)
  );
  const mapa = new Map<string, number>();
  // Se a imobiliária tem mais de uma empresa confirmada, vale a de menor ID (a mais antiga).
  for (const l of linhas.sort((a, b) => Number(b.chave_externa) - Number(a.chave_externa))) mapa.set(l.imobiliaria_id, Number(l.chave_externa));
  return mapa;
}

export type ResultadoVinculo = {
  vinculados: number;
  jaVinculados: number;
  semEmpresaVinculada: { cardId: number; titulo: string; empresaId: number | null }[];
  foraDaCampanha: { cardId: number; titulo: string; imobiliaria: string }[];
  semCardNoBitrix: number;
};

// Liga à campanha os cards que JÁ existem no funil, pela Empresa do card (vínculo
// confirmado na base única), nunca pelo título. Só considera imobiliárias que
// participam da campanha. Não cria nem altera nada no Bitrix.
export async function vincularCardsExistentes(db: SupabaseClient, campanha: CampanhaMin, por: string, confirmar: boolean): Promise<ResultadoVinculo> {
  const idsImobs = await imobiliariasDaCampanha(db, campanha);
  const { participantes } = await participantesDaCampanha(db, campanha.id, idsImobs);
  const participam = new Set(idsImobs);
  void participantes;

  const deals = (await dealsDoFunil()).filter((d) => !ehTeste(d.TITLE ?? ""));
  const empresasIds = [...new Set(deals.map((d) => String(d.COMPANY_ID ?? "")).filter((x) => x && x !== "0"))];
  const regs = await buscarEmLotes<{ imobiliaria_id: string | null; chave_externa: string }>(empresasIds, (lote) =>
    db.from("imobiliaria_registros_fonte").select("imobiliaria_id, chave_externa").eq("fonte", "bitrix_empresa").eq("situacao", "confirmado").in("chave_externa", lote)
  );
  const empresaParaImob = new Map(regs.filter((r) => r.imobiliaria_id).map((r) => [r.chave_externa, r.imobiliaria_id as string]));

  const { data: existentes } = await db.from("campanhas_cards_bitrix").select("imobiliaria_id, bitrix_deal_id").eq("campanha_id", campanha.id);
  const jaImob = new Set(((existentes ?? []) as { imobiliaria_id: string }[]).map((e) => e.imobiliaria_id));
  const jaDeal = new Set(((existentes ?? []) as { bitrix_deal_id: number }[]).map((e) => Number(e.bitrix_deal_id)));

  const resultado: ResultadoVinculo = { vinculados: 0, jaVinculados: 0, semEmpresaVinculada: [], foraDaCampanha: [], semCardNoBitrix: 0 };
  const paraGravar: { campanha_id: string; imobiliaria_id: string; bitrix_deal_id: number; bitrix_company_id: number | null; origem: "vinculado"; titulo: string; criado_por: string }[] = [];
  const imobsComCard = new Set<string>();
  const nomesFora = new Map<string, string>();

  for (const d of deals) {
    const dealId = Number(d.ID);
    const empresaId = d.COMPANY_ID && d.COMPANY_ID !== "0" ? Number(d.COMPANY_ID) : null;
    const imobId = empresaId ? empresaParaImob.get(String(empresaId)) : undefined;
    if (!imobId) {
      resultado.semEmpresaVinculada.push({ cardId: dealId, titulo: d.TITLE, empresaId });
      continue;
    }
    if (!participam.has(imobId)) {
      nomesFora.set(imobId, "");
      resultado.foraDaCampanha.push({ cardId: dealId, titulo: d.TITLE, imobiliaria: imobId });
      continue;
    }
    if (jaDeal.has(dealId)) {
      resultado.jaVinculados++;
      imobsComCard.add(imobId);
      continue;
    }
    // Uma imobiliária com dois cards no funil: vale o primeiro; o outro fica para a equipe decidir.
    if (jaImob.has(imobId) || imobsComCard.has(imobId)) continue;
    imobsComCard.add(imobId);
    paraGravar.push({ campanha_id: campanha.id, imobiliaria_id: imobId, bitrix_deal_id: dealId, bitrix_company_id: empresaId, origem: "vinculado", titulo: d.TITLE, criado_por: por });
  }
  resultado.semCardNoBitrix = [...participam].filter((i) => !imobsComCard.has(i) && !jaImob.has(i)).length;
  resultado.vinculados = paraGravar.length;

  if (confirmar && paraGravar.length) {
    const { error } = await db.from("campanhas_cards_bitrix").upsert(paraGravar, { onConflict: "campanha_id,imobiliaria_id", ignoreDuplicates: true });
    if (error) throw new Error("Não consegui gravar os vínculos: " + error.message);
  }

  // Troca o ID da imobiliária pelo nome nas listas que vão para a tela.
  if (nomesFora.size) {
    const nomes = await buscarEmLotes<{ id: string; nome: string }>([...nomesFora.keys()], (lote) => db.from("imobiliarias").select("id, nome").in("id", lote));
    const m = new Map(nomes.map((n) => [n.id, n.nome]));
    resultado.foraDaCampanha = resultado.foraDaCampanha.map((f) => ({ ...f, imobiliaria: m.get(f.imobiliaria) ?? f.imobiliaria }));
  }
  return resultado;
}

export type PreviaCriacao = {
  participantes: number;
  jaTemCard: number;
  paraCriar: { imobiliariaId: string; nome: string; empresaBitrixId: number | null; responsavelEmail: string | null }[];
  semEmpresaNoBitrix: number;
  semResponsavel: number;
};

// O que a criação faria agora, sem tocar no Bitrix.
export async function previaCriacaoCards(db: SupabaseClient, campanha: CampanhaMin): Promise<PreviaCriacao> {
  const idsImobs = await imobiliariasDaCampanha(db, campanha);
  const { participantes } = await participantesDaCampanha(db, campanha.id, idsImobs);
  const imobsParticipantes = [...new Set(participantes.flatMap((p) => (p.imobiliaria_id ? [p.imobiliaria_id] : [])))];

  const { data: ligacoes } = await db.from("campanhas_cards_bitrix").select("imobiliaria_id").eq("campanha_id", campanha.id);
  const jaTem = new Set(((ligacoes ?? []) as { imobiliaria_id: string }[]).map((l) => l.imobiliaria_id));
  const pendentes = imobsParticipantes.filter((i) => !jaTem.has(i));

  const [nomes, empresas] = await Promise.all([
    buscarEmLotes<{ id: string; nome: string }>(pendentes, (lote) => db.from("imobiliarias").select("id, nome").in("id", lote)),
    empresasConfirmadas(db, pendentes),
  ]);
  const nomePorId = new Map(nomes.map((n) => [n.id, n.nome]));
  const respPorImob = new Map(participantes.filter((p) => p.imobiliaria_id).map((p) => [p.imobiliaria_id as string, p.responsavel_email]));

  const paraCriar = pendentes
    .map((id) => ({ imobiliariaId: id, nome: nomePorId.get(id) ?? "(sem nome)", empresaBitrixId: empresas.get(id) ?? null, responsavelEmail: respPorImob.get(id) ?? null }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return {
    participantes: imobsParticipantes.length,
    jaTemCard: jaTem.size,
    paraCriar,
    semEmpresaNoBitrix: paraCriar.filter((p) => !p.empresaBitrixId).length,
    semResponsavel: paraCriar.filter((p) => !p.responsavelEmail).length,
  };
}

const cacheUsuarios = new Map<string, number | null>();
async function usuarioBitrixPorEmail(email: string | null | undefined): Promise<number | null> {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return null;
  if (cacheUsuarios.has(e)) return cacheUsuarios.get(e) ?? null;
  try {
    const r = await chamarBitrix<{ result: { ID: string }[] }>("user.get", { "FILTER[EMAIL]": e }, "BITRIX_WEBHOOK_URL_USUARIOS");
    const id = r.result?.[0]?.ID ? Number(r.result[0].ID) : null;
    cacheUsuarios.set(e, id);
    return id;
  } catch {
    return null;
  }
}

async function criarEmpresaNoBitrix(db: SupabaseClient, imob: { id: string; nome: string; cnpj: string | null }, por: string): Promise<number> {
  const r = await chamarBitrix<{ result: number }>("crm.company.add", {
    "fields[TITLE]": imob.nome,
    "fields[COMPANY_TYPE]": "PARTNER",
    "fields[COMMENTS]": `Cadastro criado automaticamente pelo Workspace O2 (campanha) em ${new Date().toLocaleDateString("pt-BR")}. CNPJ: ${imob.cnpj ?? "não informado"}.`,
  });
  const empresaId = Number(r.result);
  // Registra na base única (enriquece a ficha existente; não cria imobiliária nova).
  const { error } = await db.from("imobiliaria_registros_fonte").upsert(
    {
      fonte: "bitrix_empresa",
      chave_externa: String(empresaId),
      nome_original: imob.nome,
      imobiliaria_id: imob.id,
      situacao: "confirmado",
      metodo_vinculo: "criado_pela_campanha",
      confirmado_por_email: por,
      confirmado_em: new Date().toISOString(),
    },
    { onConflict: "fonte,chave_externa" }
  );
  if (error) throw new Error("Empresa criada no Bitrix (" + empresaId + ") mas não consegui registrar na base única: " + error.message);
  return empresaId;
}

export type ResultadoCriacao = { criados: number; empresasCriadas: number; restantes: number; falhas: { nome: string; erro: string }[] };

// Cria os cards que faltam, no máximo `limite` por chamada (o Bitrix limita a
// taxa de pedidos e a função tem tempo máximo). Chame de novo para continuar.
export async function criarCardsDaCampanha(db: SupabaseClient, campanha: CampanhaMin, por: string, limite = 25): Promise<ResultadoCriacao> {
  const previa = await previaCriacaoCards(db, campanha);
  const lote = previa.paraCriar.slice(0, limite);
  const resultado: ResultadoCriacao = { criados: 0, empresasCriadas: 0, restantes: previa.paraCriar.length, falhas: [] };
  if (!lote.length) return resultado;

  const { data: cadastro } = await db.from("imobiliarias").select("id, nome, cnpj").in("id", lote.map((l) => l.imobiliariaId));
  const cad = new Map(((cadastro ?? []) as { id: string; nome: string; cnpj: string | null }[]).map((c) => [c.id, c]));
  const doCriador = await usuarioBitrixPorEmail(campanha.criado_por_email);

  for (const item of lote) {
    try {
      const imob = cad.get(item.imobiliariaId);
      if (!imob) throw new Error("ficha da imobiliária não encontrada");
      // Confere de novo (outra execução pode ter criado enquanto esta rodava).
      const { data: jaExiste } = await db.from("campanhas_cards_bitrix").select("id").eq("campanha_id", campanha.id).eq("imobiliaria_id", imob.id).maybeSingle();
      if (jaExiste) continue;

      let empresaId = item.empresaBitrixId;
      if (!empresaId) {
        empresaId = await criarEmpresaNoBitrix(db, imob, por);
        resultado.empresasCriadas++;
      }
      const responsavel = (await usuarioBitrixPorEmail(item.responsavelEmail)) ?? doCriador;
      const titulo = tituloDoCard(imob.nome, campanha.nome);
      const params: Record<string, string | number> = {
        "fields[TITLE]": titulo,
        "fields[CATEGORY_ID]": FUNIL_CAMPANHAS,
        "fields[STAGE_ID]": ETAPA_INICIAL,
        "fields[COMPANY_ID]": empresaId,
        "fields[COMMENTS]": `Campanha: ${campanha.nome}. Card criado pelo Workspace O2 ao enviar os e-mails da campanha.`,
      };
      if (responsavel) params["fields[ASSIGNED_BY_ID]"] = responsavel;
      if (campanha.valido_de) params[`fields[${CAMPO_INICIO}]`] = campanha.valido_de;
      if (campanha.valido_ate) params[`fields[${CAMPO_FIM}]`] = campanha.valido_ate;
      const r = await chamarBitrix<{ result: number }>("crm.deal.add", params);
      const dealId = Number(r.result);
      const { error } = await db.from("campanhas_cards_bitrix").insert({
        campanha_id: campanha.id,
        imobiliaria_id: imob.id,
        bitrix_deal_id: dealId,
        bitrix_company_id: empresaId,
        origem: "criado",
        titulo,
        criado_por: por,
      });
      if (error) throw new Error(`card ${dealId} criado no Bitrix mas a ligação não foi gravada: ${error.message}`);
      resultado.criados++;
      resultado.restantes--;
    } catch (e) {
      resultado.falhas.push({ nome: item.nome, erro: e instanceof Error ? e.message : "falha desconhecida" });
    }
  }
  return resultado;
}

export async function resumoDosCards(db: SupabaseClient, campanhaId: string): Promise<{ total: number; criados: number; vinculados: number }> {
  const { data } = await db.from("campanhas_cards_bitrix").select("origem").eq("campanha_id", campanhaId);
  const linhas = (data ?? []) as { origem: string }[];
  return { total: linhas.length, criados: linhas.filter((l) => l.origem === "criado").length, vinculados: linhas.filter((l) => l.origem === "vinculado").length };
}

export type { LigacaoRow };
