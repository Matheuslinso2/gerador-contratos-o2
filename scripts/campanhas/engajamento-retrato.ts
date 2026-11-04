// Retrato de engajamento por unidade (ficha ou grupo) em duas janelas e gravação em
// imobiliaria_engajamento_snapshot. Só lê o Bitrix; não envia nada.
//   NODE_PATH="$TEMP/stub" npx tsx scripts/campanhas/engajamento-retrato.ts <campanha_id>
process.loadEnvFile(".env.local");
import { createClient } from "@supabase/supabase-js";
import { SINAIS_ZERO, engajamentoBitrix, engajamentoInterno, nivelDe, percentil, pontosDe, somarSinais, type Sinais } from "../../src/lib/campanhas/engajamento";

const JANELAS = { antes: { de: "2026-07-03", ate: "2026-09-30" }, durante: { de: "2026-10-01", ate: "2026-11-03" } };

async function main() {
  const campanhaId = process.argv[2];
  if (!campanhaId) throw new Error("Informe o id da campanha.");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Unidade = grupo (se tiver) ou a própria ficha.
  const { data: todas } = await db.from("imobiliarias").select("id, nome, apelido, grupo_id");
  const ficha = new Map((todas ?? []).map((f) => [f.id as string, f as { id: string; nome: string; apelido: string | null; grupo_id: string | null }]));
  const unidadeDe = (id: string) => ficha.get(id)?.grupo_id ?? id;
  const { data: grupos } = await db.from("imobiliaria_grupos").select("id, nome");
  const nomeGrupo = new Map((grupos ?? []).map((g) => [g.id as string, g.nome as string]));

  // Carteira ativa (referência dos percentis) + participantes da campanha.
  const { data: ativas } = await db.rpc("imobiliarias_ativas", { p_desde: "2025-10-01", p_ate: "2026-10-31" });
  const { data: metas } = await db.from("campanhas_metas").select("imobiliaria_id, grupo_id, meta").eq("campanha_id", campanhaId).gt("meta", 0);
  const unidades = new Map<string, Set<string>>();
  const addFicha = (id: string) => { const u = unidadeDe(id); (unidades.get(u) ?? unidades.set(u, new Set()).get(u)!).add(id); };
  for (const a of (ativas ?? []) as { imobiliaria_id: string }[]) addFicha(a.imobiliaria_id);
  const participantes: { chave: string; nome: string }[] = [];
  for (const m of (metas ?? []) as { imobiliaria_id: string | null; grupo_id: string | null }[]) {
    if (m.grupo_id) {
      for (const f of ficha.values()) if (f.grupo_id === m.grupo_id) addFicha(f.id);
      participantes.push({ chave: m.grupo_id, nome: nomeGrupo.get(m.grupo_id) ?? "Grupo" });
    } else if (m.imobiliaria_id) {
      const f = ficha.get(m.imobiliaria_id);
      if (f?.grupo_id && (metas ?? []).some((x) => x.grupo_id === f.grupo_id)) continue; // ficha dentro de rede em modo grupo
      addFicha(m.imobiliaria_id);
      participantes.push({ chave: unidadeDe(m.imobiliaria_id), nome: f?.apelido || f?.nome || m.imobiliaria_id });
    }
  }
  // Rede inteira entra com todas as fichas do grupo, mesmo as sem produção recente.
  for (const p of participantes) if (!unidades.has(p.chave)) unidades.set(p.chave, new Set([p.chave]));
  console.log(`unidades na carteira de referência: ${unidades.size} | participantes: ${participantes.length}`);

  const saida: Record<string, Map<string, { sinais: Sinais; esforco: number; resposta: number; disponivel: boolean }>> = {};
  for (const [rotulo, j] of Object.entries(JANELAS)) {
    console.log(`\nJanela ${rotulo}: ${j.de} a ${j.ate} — lendo o Bitrix…`);
    const [bx, interno] = await Promise.all([engajamentoBitrix(db, j.de, j.ate), engajamentoInterno(db, j.de, j.ate)]);
    console.log(`  atividades lidas: ${bx.atividadesLidas} | sem dono ligável à ficha: ${bx.atividadesSemDono}`);
    console.log("  por motivo:", JSON.stringify(bx.semDonoPorMotivo));
    const mapa = new Map<string, { sinais: Sinais; esforco: number; resposta: number; disponivel: boolean }>();
    for (const [u, fichas] of unidades) {
      let s = SINAIS_ZERO;
      let temEmpresa = false;
      for (const f of fichas) {
        s = somarSinais(s, bx.porFicha.get(f) ?? SINAIS_ZERO);
        s = somarSinais(s, interno.get(f) ?? SINAIS_ZERO);
        if (bx.fichasComEmpresa.has(f)) temEmpresa = true;
      }
      const p = pontosDe(s);
      mapa.set(u, { sinais: s, esforco: p.esforco, resposta: p.resposta, disponivel: temEmpresa });
    }
    saida[rotulo] = mapa;
    // Grava o retrato desta janela.
    const ref = [...mapa.values()].filter((x) => x.disponivel);
    const linhas = [...mapa.entries()].map(([u, v]) => {
      const pe = percentil(v.esforco, ref.map((x) => x.esforco));
      const pr = percentil(v.resposta, ref.map((x) => x.resposta));
      return { unidade: u, imobiliaria_ids: [...(unidades.get(u) ?? [])], nome: nomeGrupo.get(u) ?? (ficha.get(u)?.apelido || ficha.get(u)?.nome) ?? u, janela_inicio: j.de, janela_fim: j.ate, esforco_pontos: v.esforco, resposta_pontos: v.resposta, pct_esforco: pe, pct_resposta: pr, nivel_esforco: nivelDe(v.esforco, pe, v.disponivel), nivel_resposta: nivelDe(v.resposta, pr, v.disponivel), disponibilidade: v.disponivel ? "ok" : "sem_empresa_bitrix", sinais: v.sinais };
    });
    for (let i = 0; i < linhas.length; i += 100) {
      const { error } = await db.from("imobiliaria_engajamento_snapshot").upsert(linhas.slice(i, i + 100), { onConflict: "unidade,janela_inicio,janela_fim" });
      if (error) throw new Error(error.message);
    }
    console.log(`  gravadas ${linhas.length} linhas; ${linhas.filter((l) => l.disponibilidade !== "ok").length} sem empresa no Bitrix (indisponível)`);
  }

  console.log("\nParticipante | antes(90d): esforço/resposta → nível | durante(34d): esforço/resposta → nível");
  const pAntes = await db.from("imobiliaria_engajamento_snapshot").select("unidade, nivel_resposta, nivel_esforco, pct_resposta, esforco_pontos, resposta_pontos, disponibilidade").eq("janela_inicio", JANELAS.antes.de);
  const pDur = await db.from("imobiliaria_engajamento_snapshot").select("unidade, nivel_resposta, nivel_esforco, pct_resposta, esforco_pontos, resposta_pontos, disponibilidade").eq("janela_inicio", JANELAS.durante.de);
  const ia = new Map((pAntes.data ?? []).map((r) => [r.unidade as string, r]));
  const id = new Map((pDur.data ?? []).map((r) => [r.unidade as string, r]));
  for (const p of participantes.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))) {
    const a = ia.get(p.chave), d = id.get(p.chave);
    const f = (r: typeof a) => (!r ? "—" : r.disponibilidade !== "ok" ? "indisponível (sem empresa no Bitrix)" : `${r.esforco_pontos}/${r.resposta_pontos} (P${r.pct_resposta}) → resposta ${r.nivel_resposta}, esforço ${r.nivel_esforco}`);
    console.log(`${p.nome.padEnd(36)} | ${f(a)} | ${f(d)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
