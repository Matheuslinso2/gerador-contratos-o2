import "server-only";

import { listarHistoricoEtapas, listarItensSpaCategoria } from "@/lib/bitrix/client";
import { auditarCardFianca, ENTITY_TYPE_FIANCA, ESPERA_MINUTOS, ETAPA_CONTRATO_RECEBIDO } from "@/lib/bitrix/auditoriaContratoCard";
import { createServiceClient } from "@/lib/supabase/service";

// Rotina automática do Auditor nos cards do Seguro Fiança (fechada com o Matheus em 04-05/11/2026):
//  - card entra em "Contrato Recebido" -> espera 30 min -> procura o contrato no Gmail -> roda o Auditor -> comenta o PARECER COMPLETO no card;
//  - vale para os cards que entrarem na etapa a partir de AUTOMATICO_A_PARTIR_DE (não mexe nos antigos);
//  - se a equipe já auditou esse locatário na tela depois da entrada, não duplica (e não gasta IA);
//  - contrato ainda não encontrado: tenta de novo a cada rodada, por até 24 h, SEM comentar nada no card;
//  - cada entrada na etapa gera no máximo um parecer (tabela auditoria_contrato_card, modo "automatico", chave item_id + entrada_em).
export const AUTOMATICO_A_PARTIR_DE = new Date("2026-11-05T13:30:00Z"); // 10:30 em Brasília
const JANELA_TENTATIVAS_H = 24;
const MAX_POR_RODADA = 4;

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

async function comentarNoCard(itemId: number, texto: string): Promise<void> {
  const base = process.env.BITRIX_WEBHOOK_URL;
  if (!base) throw new Error("BITRIX_WEBHOOK_URL não configurada");
  const resp = await fetch(`${base.endsWith("/") ? base : base + "/"}crm.timeline.comment.add.json`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields: { ENTITY_ID: itemId, ENTITY_TYPE: `dynamic_${ENTITY_TYPE_FIANCA}`, COMMENT: texto } }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok || dados.error) throw new Error(`Bitrix crm.timeline.comment.add: ${dados.error_description || dados.error || `HTTP ${resp.status}`}`);
}

export type ResultadoRodada = {
  devidos: { id: number; entrada: string; acao: string }[];
  limite: number;
};

// simular = só decide e devolve o que faria (nada é analisado nem comentado).
export async function rodarAuditoriaAutomatica(opts: { simular?: boolean; agora?: Date } = {}): Promise<ResultadoRodada> {
  const agora = opts.agora ?? new Date();
  const sb = createServiceClient();
  const corte = new Date(agora.getTime() - ESPERA_MINUTOS * 60_000);
  const inicioJanela = new Date(Math.max(AUTOMATICO_A_PARTIR_DE.getTime(), agora.getTime() - JANELA_TENTATIVAS_H * 3600_000));

  // Última entrada de cada card em "Contrato Recebido" dentro da janela.
  const historico = await listarHistoricoEtapas(ENTITY_TYPE_FIANCA);
  const entradas = new Map<number, Date>();
  for (const e of historico) {
    if (e.STAGE_ID !== ETAPA_CONTRATO_RECEBIDO) continue;
    const t = new Date(e.CREATED_TIME);
    if (t < inicioJanela) continue;
    const id = Number(e.OWNER_ID);
    if (!entradas.has(id) || t > entradas.get(id)!) entradas.set(id, t);
  }
  const resultado: ResultadoRodada = { devidos: [], limite: MAX_POR_RODADA };
  const aguardando = [...entradas.entries()].filter(([, t]) => t <= corte); // já passou a espera de 30 min
  if (!aguardando.length) return resultado;

  const ids = aguardando.map(([id]) => id);
  const { data: feitos } = await sb.from("auditoria_contrato_card").select("item_id, entrada_em, status").eq("modo", "automatico").in("item_id", ids);
  const chave = (f: { item_id: number; entrada_em: string }) => `${f.item_id}|${new Date(f.entrada_em).getTime()}`;
  const jaResolvido = new Set((feitos ?? []).filter((f) => f.status !== "SEM_CONTRATO" && f.status !== "ERRO").map(chave));
  // Erro que se repete (ex: IA fora do ar) não é refeito para sempre: no máximo 3 tentativas por entrada.
  const errosPorChave = new Map<string, number>();
  for (const f of feitos ?? []) if (f.status === "ERRO") errosPorChave.set(chave(f), (errosPorChave.get(chave(f)) ?? 0) + 1);
  for (const [k, n] of errosPorChave) if (n >= 3) jaResolvido.add(k);

  const cards = new Map((await listarItensSpaCategoria(ENTITY_TYPE_FIANCA, 20)).map((i) => [Number(i.id), i as Record<string, unknown>]));
  let processados = 0;
  for (const [id, entrada] of aguardando.sort((a, b) => a[1].getTime() - b[1].getTime())) {
    if (jaResolvido.has(`${id}|${entrada.getTime()}`)) continue;
    const item = cards.get(id);
    if (!item) continue;
    const titulo = String(item.title ?? "");
    if (opts.simular) {
      resultado.devidos.push({ id, entrada: entrada.toISOString(), acao: "analisaria" });
      continue;
    }
    if (processados >= MAX_POR_RODADA) break; // o resto fica para a próxima rodada

    // A equipe já auditou esse locatário na tela depois da entrada? Não duplica.
    const nome = norm(titulo.split("/")[0]).split(" ").slice(0, 2).join(" ");
    if (nome.length >= 5) {
      const desde = new Date(entrada.getTime() - 3600_000).toISOString();
      const { data: manual } = await sb.from("auditorias_contrato").select("id").gte("created_at", desde).or(`locatario_identificado.ilike.%${nome}%,nome_arquivo.ilike.%${nome}%`).limit(1);
      if (manual && manual.length) {
        await sb.from("auditoria_contrato_card").insert({ entity_type_id: ENTITY_TYPE_FIANCA, item_id: id, titulo, modo: "automatico", entrada_em: entrada.toISOString(), status: "JA_AUDITADO_PELA_EQUIPE" });
        resultado.devidos.push({ id, entrada: entrada.toISOString(), acao: "já auditado pela equipe" });
        continue;
      }
    }

    processados++;
    const t0 = Date.now();
    try {
      const rua = String(item.ufCrm10_1776351662 ?? "").trim();
      const num = String(item.ufCrm10_1776351686 ?? "").trim();
      const r = await auditarCardFianca({ id, titulo, endereco: rua ? `${rua} ${num}`.trim() : null });
      const segundos = Math.round((Date.now() - t0) / 1000);
      if (!r.ok) {
        // Sem contrato (ainda): registra a tentativa e segue sem comentar nada no card.
        await sb.from("auditoria_contrato_card").insert({ entity_type_id: ENTITY_TYPE_FIANCA, item_id: id, titulo, modo: "automatico", entrada_em: entrada.toISOString(), status: "SEM_CONTRATO", avisos: [r.motivo], segundos });
        resultado.devidos.push({ id, entrada: entrada.toISOString(), acao: "contrato não encontrado (tenta de novo)" });
        continue;
      }
      await comentarNoCard(id, r.parecer);
      await sb.from("auditoria_contrato_card").insert({
        entity_type_id: ENTITY_TYPE_FIANCA, item_id: id, titulo, modo: "automatico", entrada_em: entrada.toISOString(), status: r.relatorio.status_geral,
        parecer: r.parecer, relatorio: r.relatorio, arquivos: r.arquivos, avisos: r.avisos, segundos, comentario_postado_em: new Date().toISOString(),
      });
      resultado.devidos.push({ id, entrada: entrada.toISOString(), acao: `parecer postado (${r.relatorio.status_geral})` });
    } catch (e) {
      const msg = (e as Error).message;
      await sb.from("auditoria_contrato_card").insert({ entity_type_id: ENTITY_TYPE_FIANCA, item_id: id, titulo, modo: "automatico", entrada_em: entrada.toISOString(), status: "ERRO", avisos: [msg] });
      resultado.devidos.push({ id, entrada: entrada.toISOString(), acao: `erro: ${msg.slice(0, 120)}` });
    }
  }
  return resultado;
}
