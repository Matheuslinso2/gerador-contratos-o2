import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { CAIXAS_O2, lerCaixa, type EmailLido } from "@/lib/erp/emails";

// ERP O2 — prova de emissão nos e-mails (27/10/2026), SÓ LEITURA do Gmail e SEM escrever em erp_documentos.
// Alvo: propostas pendentes (situacao='proposta' e sem nº de apólice). Procura nas caixas O2 e-mails de fora da O2 com
// "apólice/endosso/emitida/emissão" e liga ao documento pelo nº da proposta ou pelo nome do segurado. A evidência vai para
// erp_emails (ligacao 'emissao') + erp_emails_evidencia_emissao; quem decide gravar é o Matheus, depois de ver a taxa de acerto.

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// Texto já normalizado (sem acento, maiúsculo). Só vale como prova frase positiva de emissão e nenhum termo de
// cobrança/cancelamento/espera ("fico no aguardo da apólice" é o contrário de emitida).
const POSITIVAS: [RegExp, string][] = [
  [/APOLICE (DIGITAL|EMITIDA|ANEXA|EM ANEXO|ENVIADA)|SEGUE (EM ANEXO )?(A |SUA |NOVA )?APOLICE|NOVA APOLICE|APOLICE N[O0 ]/, "apólice enviada"],
  [/ENDOSSO (EMITIDO|ANEXO|EM ANEXO|DIGITAL)|SEGUE (O )?ENDOSSO/, "endosso emitido"],
  [/EMITID[AO]/, "emitida"],
];
const NEGATIVAS = /CANCELAMENT|ENCERRAMENT|COBRANCA|COMUNICADO|AGUARD|NAO EMITID|PREVISAO|INADIMPL|BOLETO|PENDENT|ESTORNO/;
const NUM_APOS_PALAVRA = /(?:ap[oó]lice|endosso)[^0-9]{0,20}(\d[\d.\-/]{4,25}\d)/i;

type Alvo = { id: string; tipo: string; origem: string; proposta: string | null; nomes: string[]; dt: string | null };

async function lerTudo<T>(pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await pagina(de, de + 999);
    if (error) throw new Error(error.message);
    todas.push(...(data ?? []));
    if ((data ?? []).length < 1000) return todas;
  }
}

export async function carregarAlvos(sb: SupabaseClient): Promise<{ alvos: Alvo[]; desde: string }> {
  const docs = await lerTudo<{ id: string; tipo: string; origem: string; numero_proposta: string | null; locatario_id: string | null; dt_proposta: string | null; created_at: string }>(
    (a, b) =>
      sb.from("erp_documentos").select("id,tipo,origem,numero_proposta,locatario_id,dt_proposta,created_at").eq("situacao", "proposta").is("numero_apolice", null).order("id").range(a, b)
  );
  const nomes = new Map<string, Set<string>>();
  const add = (id: string, n: string | null) => {
    const v = norm(n ?? "");
    if (v.split(" ").length >= 2 && v.length >= 8) (nomes.get(id) ?? nomes.set(id, new Set()).get(id)!).add(v);
  };
  const locIds = [...new Set(docs.map((d) => d.locatario_id).filter((x): x is string => !!x))];
  const locNome = new Map<string, string>();
  for (let i = 0; i < locIds.length; i += 100) {
    const { data, error } = await sb.from("locatarios").select("id,nome").in("id", locIds.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const l of data ?? []) locNome.set(l.id, l.nome);
  }
  for (const d of docs) if (d.locatario_id) add(d.id, locNome.get(d.locatario_id) ?? null);
  for (let i = 0; i < docs.length; i += 100) {
    const grupo = docs.slice(i, i + 100).map((d) => d.id);
    const { data: itens, error } = await sb.from("erp_documento_itens").select("id,documento_id").in("documento_id", grupo);
    if (error) throw new Error(error.message);
    const porItem = new Map((itens ?? []).map((it) => [it.id, it.documento_id]));
    const ids = [...porItem.keys()];
    for (let j = 0; j < ids.length; j += 100) {
      const { data: partes, error: e2 } = await sb.from("erp_item_partes").select("item_id,nome").in("item_id", ids.slice(j, j + 100));
      if (e2) throw new Error(e2.message);
      for (const p of partes ?? []) add(porItem.get(p.item_id)!, p.nome);
    }
  }
  const alvos = docs.map((d) => ({
    id: d.id, tipo: d.tipo, origem: d.origem,
    proposta: d.numero_proposta && d.numero_proposta.replace(/\D/g, "").length >= 5 ? d.numero_proposta.trim() : null,
    nomes: [...(nomes.get(d.id) ?? [])],
    dt: d.dt_proposta,
  }));
  const menor = docs.map((d) => d.dt_proposta ?? d.created_at.slice(0, 10)).sort()[0];
  return { alvos, desde: menor };
}

/** O e-mail só prova a emissão se for de depois da proposta (3 dias de folga) — nome igual de apólice antiga não vale. */
const depois = (dataMsg: string | null, a: Alvo) => !a.dt || !dataMsg || dataMsg.slice(0, 10) >= new Date(Date.parse(a.dt) - 3 * 864e5).toISOString().slice(0, 10);

type Evidencia = { documento_id: string; criterio: string; palavra: string | null; numero_citado: string | null };

/** Quais alvos o e-mail comprova (nome completo/parcial ou nº da proposta) — só vale se o texto fala de emissão. */
export function casar(texto: string, dataMsg: string | null, alvos: Alvo[], idxNome: Map<string, Alvo[]>, idxProp: Map<string, Alvo[]>): Evidencia[] {
  const t = norm(texto);
  const palavra = NEGATIVAS.test(t) ? null : POSITIVAS.find(([r]) => r.test(t))?.[1] ?? null;
  const numero = NUM_APOS_PALAVRA.exec(texto)?.[1] ?? null;
  const achados = new Map<string, Evidencia>();
  const palavrasDoTexto = new Set(t.split(" "));
  for (const p of palavrasDoTexto) {
    for (const alvo of idxNome.get(p) ?? []) {
      if (!depois(dataMsg, alvo)) continue;
      for (const n of alvo.nomes) {
        if (!n.endsWith(" " + p) && !n.startsWith(p + " ")) continue; // indexado pelo 1º ou último nome
        const completo = (" " + t + " ").includes(" " + n + " ");
        const parcial = !completo && n.split(" ").length >= 3 && n.split(" ").every((x) => palavrasDoTexto.has(x));
        if ((completo || parcial) && palavra && !achados.has(alvo.id))
          achados.set(alvo.id, { documento_id: alvo.id, criterio: completo ? "nome_completo" : "nome_parcial", palavra, numero_citado: numero });
      }
    }
  }
  for (const m of palavra ? texto.match(/\d{5,}/g) ?? [] : []) {
    for (const alvo of (idxProp.get(m) ?? []).filter((a) => depois(dataMsg, a))) achados.set(alvo.id, { documento_id: alvo.id, criterio: "proposta", palavra, numero_citado: numero });
  }
  return [...achados.values()];
}

function indices(alvos: Alvo[]) {
  const idxNome = new Map<string, Alvo[]>();
  const idxProp = new Map<string, Alvo[]>();
  for (const a of alvos) {
    for (const n of a.nomes) {
      const ps = n.split(" ");
      for (const p of new Set([ps[0], ps[ps.length - 1]])) (idxNome.get(p) ?? idxNome.set(p, []).get(p)!).push(a);
    }
    if (a.proposta) {
      const so = a.proposta.replace(/\D/g, "");
      (idxProp.get(so) ?? idxProp.set(so, []).get(so)!).push(a);
    }
  }
  return { idxNome, idxProp };
}

export type ResumoEmissao = { alvos: number; semChave: number; pares: number; pulados: number; lidos: number; casados: number; truncados: number; erros: string[] };

/** Meses (AAAA-MM) de `desde` até hoje, limitados a `meses` para trás. */
function janelas(desde: string, meses: number): { chave: string; apos: string; antes: string }[] {
  const hoje = new Date();
  const limite = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - meses, 1));
  let ini = new Date(desde + "T00:00:00Z");
  ini = new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth(), 1));
  if (ini < limite) ini = limite;
  const saida: { chave: string; apos: string; antes: string }[] = [];
  for (let d = ini; d <= hoje; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const prox = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const f = (x: Date) => `${x.getUTCFullYear()}/${String(x.getUTCMonth() + 1).padStart(2, "0")}/01`;
    saida.push({ chave: `emissao:${d.toISOString().slice(0, 7)}`, apos: f(d), antes: f(prox) });
  }
  return saida;
}

export async function buscarProvasDeEmissao(
  sb: SupabaseClient,
  o: { meses: number; limitePorBusca: number; paralelo: number; caixas?: string[]; log?: (m: string) => void }
): Promise<ResumoEmissao> {
  const log = o.log ?? (() => {});
  const { alvos, desde } = await carregarAlvos(sb);
  const uteis = alvos.filter((a) => a.nomes.length || a.proposta);
  const { idxNome, idxProp } = indices(uteis);
  const resumo: ResumoEmissao = { alvos: alvos.length, semChave: alvos.length - uteis.length, pares: 0, pulados: 0, lidos: 0, casados: 0, truncados: 0, erros: [] };
  const caixas = (o.caixas ?? CAIXAS_O2).filter((c) => CAIXAS_O2.includes(c));
  const jan = janelas(desde, o.meses);
  const feitos = new Set<string>();
  for (const l of await lerTudo<{ caixa: string; lote: string }>((a, b) => sb.from("erp_emails_progresso").select("caixa,lote").like("lote", "emissao:%").order("caixa").order("lote").range(a, b)))
    feitos.add(`${l.caixa}|${l.lote}`);
  const pendentes = new Map<string, typeof jan>();
  for (const c of caixas) {
    const falta = jan.filter((j) => !feitos.has(`${c}|${j.chave}`));
    resumo.pares += falta.length;
    resumo.pulados += jan.length - falta.length;
    if (falta.length) pendentes.set(c, falta);
  }
  log(`${alvos.length} alvos (${uteis.length} com nome/proposta, ${resumo.semChave} sem chave), ${jan.length} meses x ${caixas.length} caixas; a fazer ${resumo.pares}, já feitos ${resumo.pulados}`);

  let fila: Promise<unknown> = Promise.resolve();
  const gravar = (caixa: string, chave: string, msgs: EmailLido[], truncado: boolean) => {
    fila = fila.then(async () => {
      const casadas = new Map<string, { m: EmailLido; ev: Evidencia[] }>();
      for (const m of msgs) {
        const ev = casar(`${m.assunto} ${m.trecho}`, m.data, uteis, idxNome, idxProp);
        if (!ev.length) continue;
        if (!casadas.has(m.message_id)) casadas.set(m.message_id, { m, ev });
      }
      const lista = [...casadas.values()];
      for (let i = 0; i < lista.length; i += 100) {
        const grupo = lista.slice(i, i + 100);
        const { data: ex, error } = await sb.from("erp_emails").select("message_id,caixas,ligacao").in("message_id", grupo.map((g) => g.m.message_id));
        if (error) throw new Error(error.message);
        const existentes = new Map((ex ?? []).map((r) => [r.message_id, r]));
        const novos = grupo.filter((g) => !existentes.has(g.m.message_id)).map(({ m }) => ({
          message_id: m.message_id, thread_id: m.thread_id, caixas: [caixa], data: m.data, de: m.de, para: m.para, cc: m.cc,
          assunto: m.assunto, trecho: m.trecho, tem_anexo: m.tem_anexo, ligacao: ["emissao"],
        }));
        if (novos.length) {
          const { error: e } = await sb.from("erp_emails").upsert(novos, { onConflict: "message_id", ignoreDuplicates: true });
          if (e) throw new Error(`erp_emails: ${e.message}`);
        }
        for (const g of grupo) {
          const r = existentes.get(g.m.message_id);
          if (!r) continue;
          const caixasNovas = [...new Set([...(r.caixas ?? []), caixa])];
          const ligNova = [...new Set([...(r.ligacao ?? []), "emissao"])];
          if (caixasNovas.length !== (r.caixas ?? []).length || ligNova.length !== (r.ligacao ?? []).length) {
            const { error: e } = await sb.from("erp_emails").update({ caixas: caixasNovas, ligacao: ligNova }).eq("message_id", g.m.message_id);
            if (e) throw new Error(`erp_emails: ${e.message}`);
          }
        }
        const evid = grupo.flatMap((g) => g.ev.map((e) => ({ ...e, message_id: g.m.message_id })));
        for (let k = 0; k < evid.length; k += 200) {
          const { error: e } = await sb.from("erp_emails_evidencia_emissao").upsert(evid.slice(k, k + 200), { onConflict: "documento_id,message_id" });
          if (e) throw new Error(`evidencia: ${e.message}`);
        }
        resumo.casados += grupo.length;
      }
      const { error } = await sb.from("erp_emails_progresso").upsert({ caixa, lote: chave, dias: o.meses * 30, lidos: msgs.length, truncado }, { onConflict: "caixa,lote" });
      if (error) throw new Error(`progresso: ${error.message}`);
    });
    return fila;
  };

  const caixasFila = [...pendentes.keys()];
  let feitosPares = 0;
  const trabalhador = async () => {
    for (let c = caixasFila.shift(); c; c = caixasFila.shift()) {
      for (const j of pendentes.get(c)!) {
        const busca = `(apólice OR apolice OR endosso OR emitida OR emitido OR emissão OR emissao) -from:o2seguros.com.br after:${j.apos} before:${j.antes}`;
        try {
          const { mensagens, truncado } = await lerCaixa(c, busca, o.limitePorBusca);
          resumo.lidos += mensagens.length;
          if (truncado) resumo.truncados++;
          await gravar(c, j.chave, mensagens, truncado);
        } catch (e) {
          resumo.erros.push(`${c} ${j.chave}: ${(e as Error).message.slice(0, 100)}`);
          if (/delegation|unauthorized_client|invalid_grant|Caixa fora/i.test((e as Error).message)) break;
        }
        feitosPares++;
        if (feitosPares % 50 === 0) log(`${feitosPares}/${resumo.pares} pares, ${resumo.lidos} lidos, ${resumo.casados} e-mails com evidência, ${resumo.erros.length} erros`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.paralelo) }, trabalhador));
  await fila;
  return resumo;
}
