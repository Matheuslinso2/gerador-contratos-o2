import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarTodasPaginasFlat, chamarBitrix } from "@/lib/bitrix/client";

// Engajamento da imobiliária (03/11/2026). Duas medidas separadas:
//   ESFORÇO   = quanto a O2 procurou a imobiliária (dose);
//   RESPOSTA  = quanto a imobiliária procurou/respondeu a O2 (engajamento de verdade).
// Só metadados (data, canal, direção, duração): nunca o conteúdo das conversas.
// Cotações e contratações ficam FORA do índice (são o resultado que se quer medir).
//
// Regras aprovadas pelo Matheus (03/11/2026): resposta ativa vale bem mais que
// passiva (3 x 1); janela de 90 dias; ligação só conta como conversa se atendida e
// com mais de 1 minuto. Sem empresa no Bitrix = "indisponível", nunca zero.

export const PESO_ATIVA = 3;
export const PESO_PASSIVA = 1;
export const LIMITE_CONVERSA_SEGUNDOS = 60;
const MAX_CAMPANHAS_ABERTAS = 5; // abertura de e-mail é sinal fraco: limita o quanto pesa

export type Sinais = {
  ligRecebidaConversa: number; // recebida, atendida, > 1 min  (resposta ativa)
  ligRecebidaCurta: number; // recebida, atendida, ≤ 1 min      (resposta passiva)
  ligPerdida: number; // recebida e perdida: ela tentou falar (resposta passiva)
  ligFeitaConversa: number; // feita pela O2 e conversa > 1 min  (esforço + resposta ativa)
  ligFeitaSemConversa: number; // feita pela O2 sem conversa      (esforço)
  wppIniciadoCliente: number; // conversa iniciada pela imobiliária (resposta ativa)
  wppIniciadoNos: number; // conversa iniciada pela O2 (esforço)
  emailRecebido: number; // e-mail dela no CRM (resposta ativa)
  emailEnviado: number; // e-mail nosso no CRM (esforço)
  campanhasAbertas: number; // e-mails de campanha abertos (sinal fraco; só desde 15/09/2026)
  campanhasClicadas: number; // cliques em e-mail de campanha (resposta ativa)
  parcialLida: number; // imagem do panorama carregada (resposta passiva)
  botaoClique: number; // clique no botão da parcial (resposta ativa)
  contatosManuais: number; // lançados à mão pela equipe (esforço)
};

export const SINAIS_ZERO: Sinais = {
  ligRecebidaConversa: 0, ligRecebidaCurta: 0, ligPerdida: 0, ligFeitaConversa: 0, ligFeitaSemConversa: 0,
  wppIniciadoCliente: 0, wppIniciadoNos: 0, emailRecebido: 0, emailEnviado: 0,
  campanhasAbertas: 0, campanhasClicadas: 0, parcialLida: 0, botaoClique: 0, contatosManuais: 0,
};

export function somarSinais(a: Sinais, b: Sinais): Sinais {
  const r = { ...a } as Record<string, number>;
  for (const k of Object.keys(b)) r[k] = (r[k] ?? 0) + (b as Record<string, number>)[k];
  return r as unknown as Sinais;
}

export function pontosDe(s: Sinais): { esforco: number; resposta: number } {
  const ativa = s.ligRecebidaConversa + s.ligFeitaConversa + s.wppIniciadoCliente + s.emailRecebido + s.campanhasClicadas + s.botaoClique;
  const passiva = s.ligRecebidaCurta + s.ligPerdida + Math.min(s.campanhasAbertas, MAX_CAMPANHAS_ABERTAS) + s.parcialLida;
  const esforco = s.ligFeitaConversa + s.ligFeitaSemConversa + s.wppIniciadoNos + s.emailEnviado + s.contatosManuais;
  return { esforco, resposta: ativa * PESO_ATIVA + passiva * PESO_PASSIVA };
}

type Atividade = {
  ID: string;
  OWNER_TYPE_ID: string;
  OWNER_ID: string;
  PROVIDER_ID: string | null;
  DIRECTION: string | null;
  START_TIME: string | null;
  END_TIME: string | null;
  SETTINGS: { MISSED_CALL?: boolean } | null;
};

const SELECAO = ["ID", "OWNER_TYPE_ID", "OWNER_ID", "PROVIDER_ID", "DIRECTION", "START_TIME", "END_TIME", "SETTINGS"];
const PROVEDORES = ["VOXIMPLANT_CALL", "IMOPENLINES_SESSION", "CRM_EMAIL"];

const emLotes = <T>(l: T[], n: number): T[][] => {
  const r: T[][] = [];
  for (let i = 0; i < l.length; i += n) r.push(l.slice(i, i + n));
  return r;
};

/** Classifica uma atividade do Bitrix em sinais (ou nada, se não for contato). */
export function sinaisDaAtividade(a: Atividade): Partial<Sinais> | null {
  const entrada = a.DIRECTION === "1";
  if (a.PROVIDER_ID === "VOXIMPLANT_CALL") {
    const duracao = a.START_TIME && a.END_TIME ? Math.max(0, Math.round((Date.parse(a.END_TIME) - Date.parse(a.START_TIME)) / 1000)) : 0;
    if (entrada) {
      if (a.SETTINGS?.MISSED_CALL) return { ligPerdida: 1 };
      return duracao > LIMITE_CONVERSA_SEGUNDOS ? { ligRecebidaConversa: 1 } : { ligRecebidaCurta: 1 };
    }
    return duracao > LIMITE_CONVERSA_SEGUNDOS ? { ligFeitaConversa: 1 } : { ligFeitaSemConversa: 1 };
  }
  if (a.PROVIDER_ID === "IMOPENLINES_SESSION") return entrada ? { wppIniciadoCliente: 1 } : { wppIniciadoNos: 1 };
  if (a.PROVIDER_ID === "CRM_EMAIL") return entrada ? { emailRecebido: 1 } : { emailEnviado: 1 };
  return null;
}

export type ResultadoBitrix = {
  porFicha: Map<string, Sinais>;
  fichasComEmpresa: Set<string>; // fichas com Empresa confirmada no Bitrix; as demais ficam "indisponível"
  atividadesLidas: number;
  atividadesSemDono: number; // não ligadas a nenhuma ficha
  semDonoPorMotivo: Record<string, number>; // por que não ligou (tipo do dono / empresa sem vínculo)
};

/** Atividades do Bitrix (ligação, WhatsApp, e-mail) numa janela, ligadas à ficha pela Empresa confirmada. */
export async function engajamentoBitrix(db: SupabaseClient, desde: string, ate: string): Promise<ResultadoBitrix> {
  // Empresa -> ficha (vínculos confirmados da base única).
  const registros: { imobiliaria_id: string; chave_externa: string }[] = [];
  for (let de = 0; ; de += 1000) {
    const { data } = await db.from("imobiliaria_registros_fonte").select("imobiliaria_id, chave_externa").eq("fonte", "bitrix_empresa").eq("situacao", "confirmado").not("imobiliaria_id", "is", null).range(de, de + 999);
    registros.push(...((data ?? []) as { imobiliaria_id: string; chave_externa: string }[]));
    if (!data || data.length < 1000) break;
  }
  const fichaPorEmpresa = new Map<number, string>();
  for (const r of registros) fichaPorEmpresa.set(Number(r.chave_externa), r.imobiliaria_id);
  const fichasComEmpresa = new Set(registros.map((r) => r.imobiliaria_id));

  const atividades: Atividade[] = [];
  for (const prov of PROVEDORES) {
    atividades.push(
      ...(await buscarTodasPaginasFlat<Atividade>("crm.activity.list", {
        "filter[PROVIDER_ID]": prov,
        "filter[>=CREATED]": `${desde}T00:00:00`,
        "filter[<=CREATED]": `${ate}T23:59:59`,
        select: SELECAO,
      }))
    );
  }

  // Dono -> empresa: empresa (4) direto; negócio (2) e contato (3) pela empresa deles.
  const idsNegocio = [...new Set(atividades.filter((a) => a.OWNER_TYPE_ID === "2").map((a) => Number(a.OWNER_ID)))];
  const idsContato = [...new Set(atividades.filter((a) => a.OWNER_TYPE_ID === "3").map((a) => Number(a.OWNER_ID)))];
  // Item de SPA (Fiança 1042, Ramos 1046, Capitalização 1048, Auto 1050): empresa do próprio card.
  const TIPOS_SPA = ["1042", "1046", "1048", "1050"];
  const empresaDoItem = new Map<string, number>(); // `${tipo}:${id}` -> empresa
  for (const tipo of TIPOS_SPA) {
    const ids = [...new Set(atividades.filter((a) => a.OWNER_TYPE_ID === tipo).map((a) => Number(a.OWNER_ID)))];
    for (const lote of emLotes(ids, 50)) {
      try {
        const r = await chamarBitrix<{ result: { items: { id: number | string; companyId: number | string | null }[] } }>("crm.item.list", { entityTypeId: Number(tipo), "filter[@id]": lote, select: ["id", "companyId"] });
        for (const it of r.result?.items ?? []) if (it.companyId && Number(it.companyId) > 0) empresaDoItem.set(`${tipo}:${it.id}`, Number(it.companyId));
      } catch {
        // sem a empresa desse lote: as atividades ficam em "sem ficha" (aparece no motivo)
      }
    }
  }
  const empresaDoNegocio = new Map<number, number>();
  const empresaDoContato = new Map<number, number>();
  for (const lote of emLotes(idsNegocio, 50)) {
    const r = await buscarTodasPaginasFlat<{ ID: string; COMPANY_ID: string | null }>("crm.deal.list", { "filter[ID]": lote, select: ["ID", "COMPANY_ID"] }).catch(() => []);
    for (const n of r) if (n.COMPANY_ID && n.COMPANY_ID !== "0") empresaDoNegocio.set(Number(n.ID), Number(n.COMPANY_ID));
  }
  for (const lote of emLotes(idsContato, 50)) {
    const r = await buscarTodasPaginasFlat<{ ID: string; COMPANY_ID: string | null }>("crm.contact.list", { "filter[ID]": lote, select: ["ID", "COMPANY_ID"] }).catch(() => []);
    for (const c of r) if (c.COMPANY_ID && c.COMPANY_ID !== "0") empresaDoContato.set(Number(c.ID), Number(c.COMPANY_ID));
  }

  const porFicha = new Map<string, Sinais>();
  let semDono = 0;
  const motivos: Record<string, number> = {};
  const TIPO: Record<string, string> = { "1": "lead", "2": "negócio", "3": "contato", "4": "empresa" };
  for (const a of atividades) {
    const s = sinaisDaAtividade(a);
    if (!s) continue;
    const empresa = a.OWNER_TYPE_ID === "4" ? Number(a.OWNER_ID) : a.OWNER_TYPE_ID === "2" ? empresaDoNegocio.get(Number(a.OWNER_ID)) : a.OWNER_TYPE_ID === "3" ? empresaDoContato.get(Number(a.OWNER_ID)) : empresaDoItem.get(`${a.OWNER_TYPE_ID}:${a.OWNER_ID}`);
    const ficha = empresa ? fichaPorEmpresa.get(empresa) : undefined;
    if (!ficha) {
      semDono++;
      const tipo = TIPO[a.OWNER_TYPE_ID] ?? `outro tipo (${a.OWNER_TYPE_ID})`;
      const motivo = empresa ? `${tipo}: empresa sem ficha confirmada` : `${tipo}: sem empresa associada`;
      motivos[motivo] = (motivos[motivo] ?? 0) + 1;
      continue;
    }
    porFicha.set(ficha, somarSinais(porFicha.get(ficha) ?? SINAIS_ZERO, { ...SINAIS_ZERO, ...s }));
  }
  return { porFicha, fichasComEmpresa, atividadesLidas: atividades.length, atividadesSemDono: semDono, semDonoPorMotivo: motivos };
}

/** Campanhas por e-mail (abertura/clique, só desde 15/09/2026), parcial lida/clique no botão e contatos lançados à mão. */
export async function engajamentoInterno(db: SupabaseClient, desde: string, ate: string): Promise<Map<string, Sinais>> {
  const porFicha = new Map<string, Sinais>();
  const somar = (ficha: string, parcial: Partial<Sinais>) => porFicha.set(ficha, somarSinais(porFicha.get(ficha) ?? SINAIS_ZERO, { ...SINAIS_ZERO, ...parcial }));
  const inicio = `${desde}T00:00:00-03:00`;
  const fim = `${ate}T23:59:59-03:00`;

  const abertas = new Map<string, Set<string>>();
  const clicadas = new Map<string, Set<string>>();
  for (let de = 0; ; de += 1000) {
    const { data } = await db.from("campanhas_envios").select("imobiliaria_id, campanha_id, aberto_em, clicado_em").not("imobiliaria_id", "is", null).or(`aberto_em.gte.${inicio},clicado_em.gte.${inicio}`).range(de, de + 999);
    for (const e of (data ?? []) as { imobiliaria_id: string; campanha_id: string; aberto_em: string | null; clicado_em: string | null }[]) {
      if (e.aberto_em && e.aberto_em >= inicio && e.aberto_em <= fim) abertas.set(e.imobiliaria_id, (abertas.get(e.imobiliaria_id) ?? new Set()).add(e.campanha_id));
      if (e.clicado_em && e.clicado_em >= inicio && e.clicado_em <= fim) clicadas.set(e.imobiliaria_id, (clicadas.get(e.imobiliaria_id) ?? new Set()).add(e.campanha_id));
    }
    if (!data || data.length < 1000) break;
  }
  for (const [f, c] of abertas) somar(f, { campanhasAbertas: c.size });
  for (const [f, c] of clicadas) somar(f, { campanhasClicadas: c.size });

  const { data: manuais } = await db.from("imobiliaria_contatos").select("imobiliaria_id").gte("data_contato", desde).lte("data_contato", ate);
  for (const m of (manuais ?? []) as { imobiliaria_id: string }[]) somar(m.imobiliaria_id, { contatosManuais: 1 });

  // Parcial lida e clique no botão (só existem depois do primeiro envio real).
  const { data: ev } = await db.from("campanhas_panoramas_eventos").select("tipo, panorama_id, created_at").gte("created_at", inicio).lte("created_at", fim);
  const eventos = (ev ?? []) as { tipo: string; panorama_id: string }[];
  if (eventos.length) {
    const { data: pans } = await db.from("campanhas_panoramas").select("id, imobiliaria_ids").in("id", [...new Set(eventos.map((e) => e.panorama_id))]);
    const imobsDe = new Map(((pans ?? []) as { id: string; imobiliaria_ids: string[] }[]).map((p) => [p.id, p.imobiliaria_ids]));
    for (const e of eventos) for (const f of imobsDe.get(e.panorama_id) ?? []) somar(f, e.tipo === "imagem" ? { parcialLida: 1 } : { botaoClique: 1 });
  }
  return porFicha;
}

/** Posição (0–100) de um valor entre os valores da carteira de referência (empates pela metade). */
export function percentil(valor: number, referencia: number[]): number {
  if (!referencia.length) return 0;
  const menores = referencia.filter((v) => v < valor).length;
  const iguais = referencia.filter((v) => v === valor).length;
  return Math.round(((menores + iguais / 2) / referencia.length) * 100);
}

export type Nivel = "Alto" | "Médio" | "Baixo" | "Sem contato" | "Indisponível";
export function nivelDe(pontos: number, pct: number, disponivel: boolean): Nivel {
  if (!disponivel) return "Indisponível";
  if (pontos <= 0) return "Sem contato";
  return pct >= 67 ? "Alto" : pct >= 34 ? "Médio" : "Baixo";
}
