import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarTodasPaginasFlat } from "@/lib/bitrix/client";

// Últimos contatos com cada imobiliária da campanha (22/10/2026): ligações,
// WhatsApp (canal aberto), e-mails e reuniões registrados no Bitrix na
// EMPRESA e nos NEGÓCIOS dela, mais os e-mails da própria campanha enviados
// pelo Workspace. Serve para ver quem está sem contato há mais de 7 dias.

export const DIAS_SEM_CONTATO_ALERTA = 7;
const JANELA_DIAS = 90;

export type UltimosContatos = {
  email: string | null; // ISO
  ligacao: string | null;
  whatsapp: string | null;
  reuniao: string | null;
  ultimo: string | null;
  diasSemContato: number | null; // null = nenhum contato na janela
  semEmpresaNoBitrix: boolean;
};

type Atividade = { OWNER_TYPE_ID: string; OWNER_ID: string; TYPE_ID: string; PROVIDER_ID: string | null; CREATED: string };

function tipoDoContato(a: Atividade): keyof Pick<UltimosContatos, "email" | "ligacao" | "whatsapp" | "reuniao"> | null {
  const provedor = a.PROVIDER_ID ?? "";
  if (provedor === "VOXIMPLANT_CALL" || a.TYPE_ID === "2") return "ligacao";
  if (provedor === "IMOPENLINES_SESSION") return "whatsapp";
  if (provedor === "CRM_EMAIL" || a.TYPE_ID === "4") return "email";
  if (a.TYPE_ID === "1") return "reuniao";
  return null; // tarefas e demais registros internos não contam como contato
}

const maisRecente = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

function emLotes<T>(lista: T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho));
  return lotes;
}

export async function ultimosContatosPorImobiliaria(
  db: SupabaseClient,
  idsImobiliarias: string[],
  emailsDaCampanha: Map<string, string> // imobiliária -> último e-mail da campanha enviado (ISO)
): Promise<Map<string, UltimosContatos>> {
  const resultado = new Map<string, UltimosContatos>();
  if (!idsImobiliarias.length) return resultado;

  // Imobiliária -> empresas no Bitrix (vínculos confirmados da base única).
  const { data: registros } = await db
    .from("imobiliaria_registros_fonte")
    .select("imobiliaria_id, chave_externa")
    .eq("fonte", "bitrix_empresa")
    .eq("situacao", "confirmado")
    .in("imobiliaria_id", idsImobiliarias);
  const empresasPorImob = new Map<string, number[]>();
  for (const r of (registros ?? []) as { imobiliaria_id: string; chave_externa: string | null }[]) {
    const id = Number(r.chave_externa);
    if (!Number.isFinite(id) || id <= 0) continue;
    empresasPorImob.set(r.imobiliaria_id, [...(empresasPorImob.get(r.imobiliaria_id) ?? []), id]);
  }
  const imobPorEmpresa = new Map<number, string>();
  for (const [imob, empresas] of empresasPorImob) for (const e of empresas) imobPorEmpresa.set(e, imob);
  const empresas = [...imobPorEmpresa.keys()];

  const desde = new Date(Date.now() - JANELA_DIAS * 86_400_000).toISOString().slice(0, 10);
  const selecao = ["ID", "OWNER_TYPE_ID", "OWNER_ID", "TYPE_ID", "PROVIDER_ID", "CREATED"];
  const atividades: Atividade[] = [];
  const imobPorNegocio = new Map<number, string>();

  if (empresas.length) {
    for (const lote of emLotes(empresas, 50)) {
      atividades.push(
        ...(await buscarTodasPaginasFlat<Atividade>("crm.activity.list", {
          "filter[OWNER_TYPE_ID]": 4,
          "filter[OWNER_ID]": lote,
          "filter[>=CREATED]": desde,
          select: selecao,
        }).catch(() => [] as Atividade[]))
      );
    }
    for (const lote of emLotes(empresas, 50)) {
      const negocios = await buscarTodasPaginasFlat<{ ID: string; COMPANY_ID: string }>("crm.deal.list", {
        "filter[COMPANY_ID]": lote,
        select: ["ID", "COMPANY_ID"],
      }).catch(() => []);
      for (const n of negocios) {
        const imob = imobPorEmpresa.get(Number(n.COMPANY_ID));
        if (imob) imobPorNegocio.set(Number(n.ID), imob);
      }
    }
    for (const lote of emLotes([...imobPorNegocio.keys()], 50)) {
      atividades.push(
        ...(await buscarTodasPaginasFlat<Atividade>("crm.activity.list", {
          "filter[OWNER_TYPE_ID]": 2,
          "filter[OWNER_ID]": lote,
          "filter[>=CREATED]": desde,
          select: selecao,
        }).catch(() => [] as Atividade[]))
      );
    }
  }

  const hoje = Date.now();
  for (const imob of idsImobiliarias) {
    resultado.set(imob, {
      email: emailsDaCampanha.get(imob) ?? null,
      ligacao: null,
      whatsapp: null,
      reuniao: null,
      ultimo: null,
      diasSemContato: null,
      semEmpresaNoBitrix: !empresasPorImob.has(imob),
    });
  }
  for (const a of atividades) {
    const imob = a.OWNER_TYPE_ID === "4" ? imobPorEmpresa.get(Number(a.OWNER_ID)) : imobPorNegocio.get(Number(a.OWNER_ID));
    const tipo = tipoDoContato(a);
    if (!imob || !tipo) continue;
    const c = resultado.get(imob);
    if (!c) continue;
    c[tipo] = maisRecente(c[tipo], new Date(a.CREATED).toISOString());
  }
  for (const c of resultado.values()) {
    c.ultimo = [c.email, c.ligacao, c.whatsapp, c.reuniao].reduce<string | null>((m, d) => maisRecente(m, d), null);
    c.diasSemContato = c.ultimo ? Math.floor((hoje - Date.parse(c.ultimo)) / 86_400_000) : null;
  }
  return resultado;
}

// Junta os contatos de várias unidades (participante = grupo).
export function juntarContatos(lista: UltimosContatos[]): UltimosContatos | null {
  if (!lista.length) return null;
  const j: UltimosContatos = { email: null, ligacao: null, whatsapp: null, reuniao: null, ultimo: null, diasSemContato: null, semEmpresaNoBitrix: lista.every((c) => c.semEmpresaNoBitrix) };
  for (const c of lista) {
    j.email = maisRecente(j.email, c.email);
    j.ligacao = maisRecente(j.ligacao, c.ligacao);
    j.whatsapp = maisRecente(j.whatsapp, c.whatsapp);
    j.reuniao = maisRecente(j.reuniao, c.reuniao);
  }
  j.ultimo = [j.email, j.ligacao, j.whatsapp, j.reuniao].reduce<string | null>((m, d) => maisRecente(m, d), null);
  j.diasSemContato = j.ultimo ? Math.floor((Date.now() - Date.parse(j.ultimo)) / 86_400_000) : null;
  return j;
}
