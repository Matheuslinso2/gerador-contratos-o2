import type { SupabaseClient } from "@supabase/supabase-js";

// Quem pode receber um reenvio: uma imobiliária (com todos os e-mails dela que já receberam a campanha) ou, para
// contatos sem cadastro de imobiliária (prospecção, equipe), um e-mail avulso.
export type GrupoReenvio = {
  chave: string; // imobiliaria_id, ou "email:<endereço>" quando não há imobiliária
  rotulo: string;
  emails: string[];
  abriu: boolean; // algum e-mail dela foi aberto em qualquer rodada (abertura é medida por imagem, aproximada)
};

// Reenvio na MESMA campanha (06/11/2026, correção do Matheus): o público sai de campanhas_envios (quem realmente
// recebeu/tentou receber), não da seleção atual da campanha -- a seleção pode ter mudado depois. Descadastrados
// (de antes ou de depois do disparo) ficam de fora sempre. Quem escolhe os destinatários é a tela.
export async function listarGruposReenvio(supabase: SupabaseClient, campanhaId: string): Promise<GrupoReenvio[]> {
  const [{ data: envios }, { data: descadastros }] = await Promise.all([
    supabase.from("campanhas_envios").select("imobiliaria_id, email, aberto_em").eq("campanha_id", campanhaId).in("status", ["enviado", "falhou"]),
    supabase.from("campanhas_descadastros").select("email"),
  ]);
  const descadastrados = new Set((descadastros ?? []).map((d) => String(d.email).trim().toLowerCase()));

  const grupos = new Map<string, { imobiliariaId: string | null; emails: Set<string>; abriu: boolean }>();
  for (const e of envios ?? []) {
    const email = String(e.email).trim().toLowerCase();
    if (descadastrados.has(email)) continue;
    const chave = e.imobiliaria_id ? String(e.imobiliaria_id) : `email:${email}`;
    const g = grupos.get(chave) ?? { imobiliariaId: e.imobiliaria_id ?? null, emails: new Set<string>(), abriu: false };
    g.emails.add(email);
    if (e.aberto_em) g.abriu = true;
    grupos.set(chave, g);
  }

  const ids = [...grupos.values()].map((g) => g.imobiliariaId).filter((id): id is string => !!id);
  const { data: imobs } = ids.length ? await supabase.from("imobiliarias").select("id, nome").in("id", ids) : { data: [] };
  const nomePorId = new Map((imobs ?? []).map((i) => [String(i.id), String(i.nome)]));

  return [...grupos.entries()]
    .map(([chave, g]) => ({
      chave,
      rotulo: g.imobiliariaId ? (nomePorId.get(g.imobiliariaId) ?? "Imobiliária sem nome") : [...g.emails][0],
      emails: [...g.emails],
      abriu: g.abriu,
    }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}

// AAAA-MM-DD de hoje no fuso de Brasília, pra comparar com colunas `date`
// (valido_ate) sem passar por Date/timezone do navegador.
export function hojeSaoPauloISO(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}
