import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarTodasPaginasFlat, chamarBitrix } from "@/lib/bitrix/client";
import type { CanalContato, ContatosImobiliaria, EventoContato, UltimosContatos } from "./contatosTipos";

export { DIAS_SEM_CONTATO_ALERTA } from "./contatosTipos";
export type { ContatosImobiliaria, UltimosContatos } from "./contatosTipos";

// Últimos contatos com cada imobiliária da campanha (22/10/2026): ligações,
// WhatsApp (canal aberto), e-mails e reuniões registrados no Bitrix na
// EMPRESA e nos NEGÓCIOS dela, os contatos feitos POR FORA do Bitrix
// (telefone/WhatsApp particular, visita -- tabela imobiliaria_contatos, na
// ficha da imobiliária) e os e-mails da própria campanha.
//
// Pedido do Matheus (22/10, 2ª rodada): o contador de dias olha PRIMEIRO o
// último contato do RESPONSÁVEL da imobiliária na campanha (quem fez a
// atividade no Bitrix = RESPONSIBLE_ID; o AUTHOR_ID das sessões de WhatsApp
// é sempre o usuário do sistema). Sem responsável definido, vale o último
// contato de qualquer pessoa da equipe. E-mail automático da campanha
// aparece à parte e não zera o contador (não é contato de alguém).

const JANELA_DIAS = 90;
const MAX_EVENTOS_NA_TELA = 4;

type Atividade = { OWNER_TYPE_ID: string; OWNER_ID: string; TYPE_ID: string; PROVIDER_ID: string | null; CREATED: string; RESPONSIBLE_ID: string | null };

function canalDaAtividade(a: Atividade): CanalContato | null {
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

async function emailsDosUsuarios(ids: number[]): Promise<Map<number, string>> {
  const mapa = new Map<number, string>();
  for (const lote of emLotes([...new Set(ids)].filter((id) => id > 0), 50)) {
    try {
      const r = await chamarBitrix<{ result: { ID: string; EMAIL: string | null }[] }>("user.get", { "FILTER[ID]": lote }, "BITRIX_WEBHOOK_URL_USUARIOS");
      for (const u of r.result) if (u.EMAIL) mapa.set(Number(u.ID), u.EMAIL.trim().toLowerCase());
    } catch {
      // Sem o nome de quem fez, o contato continua contando para a equipe.
    }
  }
  return mapa;
}

export async function ultimosContatosPorImobiliaria(
  db: SupabaseClient,
  idsImobiliarias: string[],
  emailsDaCampanha: Map<string, string> // imobiliária -> último e-mail da campanha enviado (ISO)
): Promise<Map<string, ContatosImobiliaria>> {
  const resultado = new Map<string, ContatosImobiliaria>();
  if (!idsImobiliarias.length) return resultado;
  const desde = new Date(Date.now() - JANELA_DIAS * 86_400_000).toISOString().slice(0, 10);

  // Imobiliária -> empresas no Bitrix (vínculos confirmados da base única).
  const [{ data: registros }, { data: manuais }] = await Promise.all([
    db
      .from("imobiliaria_registros_fonte")
      .select("imobiliaria_id, chave_externa")
      .eq("fonte", "bitrix_empresa")
      .eq("situacao", "confirmado")
      .in("imobiliaria_id", idsImobiliarias),
    db
      .from("imobiliaria_contatos")
      .select("id, imobiliaria_id, canal, data_contato, feito_por_email, observacao")
      .in("imobiliaria_id", idsImobiliarias)
      .gte("data_contato", desde),
  ]);
  const empresasPorImob = new Map<string, number[]>();
  for (const r of (registros ?? []) as { imobiliaria_id: string; chave_externa: string | null }[]) {
    const id = Number(r.chave_externa);
    if (!Number.isFinite(id) || id <= 0) continue;
    empresasPorImob.set(r.imobiliaria_id, [...(empresasPorImob.get(r.imobiliaria_id) ?? []), id]);
  }
  const imobPorEmpresa = new Map<number, string>();
  for (const [imob, empresas] of empresasPorImob) for (const e of empresas) imobPorEmpresa.set(e, imob);
  const empresas = [...imobPorEmpresa.keys()];

  const selecao = ["ID", "OWNER_TYPE_ID", "OWNER_ID", "TYPE_ID", "PROVIDER_ID", "CREATED", "RESPONSIBLE_ID"];
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
  const emailPorUsuario = await emailsDosUsuarios(atividades.map((a) => Number(a.RESPONSIBLE_ID)));

  for (const imob of idsImobiliarias) {
    resultado.set(imob, { eventos: [], emailCampanha: emailsDaCampanha.get(imob) ?? null, semEmpresaNoBitrix: !empresasPorImob.has(imob) });
  }
  for (const a of atividades) {
    const imob = a.OWNER_TYPE_ID === "4" ? imobPorEmpresa.get(Number(a.OWNER_ID)) : imobPorNegocio.get(Number(a.OWNER_ID));
    const canal = canalDaAtividade(a);
    if (!imob || !canal) continue;
    resultado.get(imob)?.eventos.push({
      id: null,
      data: new Date(a.CREATED).toISOString(),
      canal,
      quem: emailPorUsuario.get(Number(a.RESPONSIBLE_ID)) ?? null,
      origem: "bitrix",
      observacao: null,
    });
  }
  for (const m of (manuais ?? []) as { id: string; imobiliaria_id: string; canal: CanalContato; data_contato: string; feito_por_email: string; observacao: string | null }[]) {
    resultado.get(m.imobiliaria_id)?.eventos.push({
      id: m.id,
      // Só a data é informada: meio-dia de Brasília para não cair no dia anterior.
      data: new Date(`${m.data_contato}T12:00:00-03:00`).toISOString(),
      canal: m.canal,
      quem: m.feito_por_email.toLowerCase(),
      origem: "manual",
      observacao: m.observacao,
    });
  }
  for (const c of resultado.values()) c.eventos.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
  return resultado;
}

// Junta as unidades da linha (participante = grupo) e aplica a regra do
// responsável. Lista vazia = sem informação (Bitrix fora do ar).
export function resumirContatos(lista: ContatosImobiliaria[], responsavelEmail: string | null): UltimosContatos | null {
  if (!lista.length) return null;
  const resp = responsavelEmail?.trim().toLowerCase() || null;
  const eventos = lista.flatMap((c) => c.eventos).sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
  const doResponsavel = resp ? eventos.find((e) => e.quem === resp) ?? null : null;
  const ultimo = resp ? doResponsavel?.data ?? null : eventos[0]?.data ?? null;
  // Mostra os mais recentes e garante que os lançados por fora apareçam
  // (é onde dá para corrigir/apagar).
  const naTela = eventos.slice(0, MAX_EVENTOS_NA_TELA);
  for (const e of eventos) if (e.origem === "manual" && !naTela.includes(e) && naTela.filter((x) => x.origem === "manual").length < 2) naTela.push(e);
  if (doResponsavel && !naTela.includes(doResponsavel)) naTela.push(doResponsavel);
  return {
    responsavelEmail: resp,
    doResponsavel,
    eventos: naTela,
    emailCampanha: lista.map((c) => c.emailCampanha).reduce<string | null>((m, d) => maisRecente(m, d), null),
    ultimo,
    diasSemContato: ultimo ? Math.max(0, Math.floor((Date.now() - Date.parse(ultimo)) / 86_400_000)) : null,
    semEmpresaNoBitrix: lista.every((c) => c.semEmpresaNoBitrix),
  };
}
