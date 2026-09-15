import type { SupabaseClient } from "@supabase/supabase-js";
import { emailsElegiveisCampanha } from "./elegibilidade";

// Compartilhada entre o disparo imediato (confirmarDisparoCampanha, sessão
// de usuário) e o cron que dispara agendamentos vencidos
// (src/app/api/cron/enviar-campanhas/route.ts, service role) -- mesma
// lógica de explodir a seleção salva (imobilarias_selecionadas +
// contatos_externos_selecionados) em linhas de campanhas_envios, pra não
// duplicar entre os dois chamadores. Recebe o client já pronto (sessão ou
// service role) porque cada chamador autentica de um jeito diferente.
export async function dispararCampanha(
  supabase: SupabaseClient,
  campanhaId: string
): Promise<{ ok: true; total: number } | { ok: false; erro: string }> {
  const { data: campanha } = await supabase
    .from("campanhas")
    .select("id, status, imobiliarias_selecionadas, contatos_externos_selecionados")
    .eq("id", campanhaId)
    .single();
  if (!campanha) return { ok: false, erro: "Campanha não encontrada." };
  if (campanha.status !== "rascunho" && campanha.status !== "agendada") {
    return { ok: false, erro: "Campanha não está mais pronta pra disparo." };
  }

  const imobiliariaIds = (campanha.imobiliarias_selecionadas as string[] | null) ?? [];
  const contatosExternosIds = (campanha.contatos_externos_selecionados as string[] | null) ?? [];
  if (!imobiliariaIds.length && !contatosExternosIds.length) {
    return { ok: false, erro: "Selecione ao menos um destinatário antes de disparar." };
  }

  const [{ data: imobiliariasData }, { data: descadastrosData }, { data: contatosExternosData }] = await Promise.all([
    imobiliariaIds.length
      ? supabase.from("imobiliarias").select("id, email, email_faturas, email_repasses, email_campanhas").in("id", imobiliariaIds)
      : Promise.resolve({ data: [] }),
    supabase.from("campanhas_descadastros").select("email"),
    contatosExternosIds.length
      ? supabase.from("campanhas_grupos_contatos").select("id, email").in("id", contatosExternosIds)
      : Promise.resolve({ data: [] }),
  ]);
  const descadastrados = new Set((descadastrosData ?? []).map((d) => d.email.toLowerCase()));

  const linhas: { campanha_id: string; imobiliaria_id: string | null; email: string }[] = [];
  const vistos = new Set<string>();
  for (const i of imobiliariasData ?? []) {
    for (const emailBruto of emailsElegiveisCampanha(i, descadastrados)) {
      const email = emailBruto.trim().toLowerCase();
      if (!email || vistos.has(email)) continue;
      vistos.add(email);
      linhas.push({ campanha_id: campanhaId, imobiliaria_id: i.id, email });
    }
  }
  // Contatos de prospecção não têm imobiliaria_id (não têm cadastro no
  // Workspace) -- campanhas_envios.imobiliaria_id já é nullable pra isso.
  for (const c of contatosExternosData ?? []) {
    const email = c.email.trim().toLowerCase();
    if (!email || vistos.has(email) || descadastrados.has(email)) continue;
    vistos.add(email);
    linhas.push({ campanha_id: campanhaId, imobiliaria_id: null, email });
  }

  if (!linhas.length) return { ok: false, erro: "Nenhum e-mail elegível entre os selecionados." };

  const { error: erroInsert } = await supabase
    .from("campanhas_envios")
    .upsert(linhas, { onConflict: "campanha_id,email", ignoreDuplicates: true });
  if (erroInsert) return { ok: false, erro: erroInsert.message };

  await supabase
    .from("campanhas")
    .update({ status: "enviando", total_destinatarios: linhas.length, disparada_em: new Date().toISOString() })
    .eq("id", campanhaId);

  return { ok: true, total: linhas.length };
}
