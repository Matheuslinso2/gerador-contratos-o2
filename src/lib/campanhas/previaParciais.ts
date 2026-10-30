import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { montarDesempenhoCampanha, produtosBaseDaCampanha } from "./desempenho";
import { participantesDaCampanha } from "./metasCampanha";
import { imobiliariasDaCampanha } from "./imobiliariasDaCampanha";
import { produtosDaCampanha } from "./produtos";
import { dadosDoPanorama, historicoPorParticipante } from "./panoramaCampanha";

// Gera a PRÉVIA das parciais de uma campanha (30/10/2026): uma versão do
// panorama por imobiliária (ou grupo) COM meta, com os números de agora, gravada
// como status "previa". Não envia nada. As prévias anteriores ainda não enviadas
// são descartadas (uma prévia aberta por campanha).
export async function gerarPreviaParciais(
  db: SupabaseClient,
  campanha: Record<string, unknown> & { id: string },
  criadoPor: string | null
): Promise<{ ok: true; lote: string; total: number; semMeta: number } | { ok: false; erro: string }> {
  if (campanha.campanha_pai_id) return { ok: false, erro: "As parciais saem da campanha principal." };
  if (!campanha.meta_metrica || !campanha.valido_de || !campanha.valido_ate) return { ok: false, erro: "Defina a meta e o período da campanha antes de enviar parciais." };

  const idsImobs = await imobiliariasDaCampanha(db, campanha as never);
  const { participantes } = await participantesDaCampanha(db, campanha.id, idsImobs);
  const comMeta = participantes.filter((p) => p.meta !== null && p.meta > 0);
  if (!comMeta.length) return { ok: false, erro: "Nenhuma imobiliária tem meta: preencha as metas no quadro antes de enviar parciais." };

  const config = {
    nome: campanha.nome as string,
    produtos: produtosBaseDaCampanha(produtosDaCampanha(campanha as never)),
    metrica: campanha.meta_metrica as string,
    inicio: campanha.valido_de as string,
    fim: campanha.valido_ate as string,
    premiacao_descricao: (campanha.premiacao_descricao as string | null) ?? null,
    custo_premiacao_geral: Number(campanha.custo_premiacao_geral) || 0,
  };
  const desempenho = await montarDesempenhoCampanha(db, config, comMeta);
  const historico = await historicoPorParticipante(db, campanha.id);

  const gruposIds = comMeta.filter((p) => p.grupo_id).map((p) => p.grupo_id as string);
  const membros = new Map<string, string[]>();
  if (gruposIds.length) {
    const { data } = await db.from("imobiliarias").select("id, grupo_id").in("grupo_id", gruposIds);
    for (const m of (data ?? []) as { id: string; grupo_id: string }[]) membros.set(m.grupo_id, [...(membros.get(m.grupo_id) ?? []), m.id]);
  }

  const lote = randomUUID();
  const linhas = comMeta
    .map((p) => {
      const linha = desempenho.linhas.find((l) => l.participanteId === p.id);
      const destinatarios = p.imobiliaria_id ? [p.imobiliaria_id] : (membros.get(p.grupo_id as string) ?? []);
      if (!linha || !destinatarios.length) return null;
      const anteriores = historico.get(p.id) ?? [];
      const dados = dadosDoPanorama(config, linha, desempenho, anteriores.length + 1, anteriores);
      return { campanha_id: campanha.id, lote_id: lote, participante_id: p.id, imobiliaria_ids: destinatarios, nome: dados.participante, versao: dados.versao, status: "previa", dados, criado_por: criadoPor };
    })
    .filter((l): l is NonNullable<typeof l> => !!l);
  if (!linhas.length) return { ok: false, erro: "Nenhuma imobiliária com meta tem destinatário para a parcial." };

  await db.from("campanhas_panoramas").update({ status: "descartada" }).eq("campanha_id", campanha.id).eq("status", "previa");
  const { error } = await db.from("campanhas_panoramas").insert(linhas);
  if (error) return { ok: false, erro: `Não consegui gerar a prévia: ${error.message}` };
  return { ok: true, lote, total: linhas.length, semMeta: participantes.length - comMeta.length };
}
