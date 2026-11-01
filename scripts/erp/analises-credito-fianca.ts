// Pareceres de crédito da Tokio (aprovado, pré-aprovado, reprovado, pendência cadastral) são ANÁLISES DO SEGURO FIANÇA (fase de cotação), NÃO emissão
// (correção do Matheus, 01/11). Liga cada e-mail ao card da SPA de Fiança (erp_origens, entity 1042) pelo nº da cotação ("Processo - Tokio") ou, sem isso,
// pelo nome do pretendente = Nome do Locatário do card (só com 1 card). Grava em erp_fianca_analise_credito (nível 5, só campos estruturados; sem texto do e-mail).
// Ensaio por padrão; --gravar grava (upsert por message_id).
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/analises-credito-fianca.ts [--gravar]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { normNome } from "@/lib/erp/tarefaCadastro";

const GRAVAR = process.argv.includes("--gravar");
const LOTE = `ANALISE-CREDITO-${new Date().toISOString().slice(0, 10)}`;
const sb = createServiceClient();
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const dig = (s: unknown) => String(s ?? "").replace(/\D/g, "");

async function todas<T>(tabela: string, cols: string, filtro?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    let q: any = sb.from(tabela).select(cols).order("id").range(de, de + 999); if (filtro) q = filtro(q);
    const { data, error } = await q; if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...(data ?? [])); if (!data || data.length < 1000) break;
  }
  return out;
}

(async () => {
  // cards de Fiança: cotação (Processo - Tokio) e nomes dos locatários
  const cards = await todas<any>("erp_origens", "id,item_id,documento_id,dados_legiveis", (q) => q.eq("entity_type_id", 1042));
  const docs = new Map<string, { imobiliaria_id: string | null; seguradora_id: string | null }>();
  const ids = [...new Set(cards.map((c) => c.documento_id).filter(Boolean))] as string[];
  for (let i = 0; i < ids.length; i += 200) { const { data } = await sb.from("erp_documentos").select("id,imobiliaria_principal_id,seguradora_id").in("id", ids.slice(i, i + 200)); for (const d of data ?? []) docs.set(d.id, { imobiliaria_id: d.imobiliaria_principal_id, seguradora_id: d.seguradora_id }); }
  const porCotacao = new Map<string, any[]>(); const porNome = new Map<string, any[]>();
  for (const c of cards) {
    const l = c.dados_legiveis ?? {};
    const cot = dig(l["Processo - Tokio"]); if (cot.length >= 8) (porCotacao.get(cot) ?? porCotacao.set(cot, []).get(cot)!).push(c);
    for (const k of ["Nome do Locatário 1", "Nome Completo 2", "Nome"]) { const n = normNome(String(l[k] ?? "")); if (n.split(" ").length >= 2) (porNome.get(n) ?? porNome.set(n, []).get(n)!).push(c); }
  }

  const emails = await todas<any>("erp_emails", "id,message_id,assunto,trecho,tem_anexo,data", (q) => q.ilike("de", "%@%tokiomarine%").or("assunto.ilike.%parecer de cr%,assunto.ilike.%pend_ncia cadastral%"));
  const linhas: any[] = []; const r = { emails: 0, semResultado: 0, porCotacao: 0, porNome: 0, ambiguo: 0, semCard: 0 };
  const porResultado: Record<string, number> = {};
  for (const e of emails) {
    const a = sem(e.assunto ?? "").toLowerCase();
    const resultado = /reprovado/.test(a) ? "reprovado" : /pre aprovado/.test(a) ? "pre_aprovado" : /cadastro aprovado/.test(a) ? "aprovado" : /pendencia cadastral/.test(a) ? "pendencia_cadastral" : null;
    if (!resultado) { r.semResultado++; continue; }
    r.emails++; porResultado[resultado] = (porResultado[resultado] ?? 0) + 1;
    const m = /pretendente\s+(.+?)\s+vinculado ao neg[oó]cio\s+(\d+)(?:\s+e cota[cç][aã]o\s+(\d+))?/i.exec(e.trecho ?? "");
    const negocio = /Neg[oó]cio:\s*(\d+)/i.exec(e.assunto ?? "")?.[1] ?? m?.[2] ?? null;
    const cotacao = m?.[3] ?? /cota[cç][aã]o (?:n[uú]mero )?(\d+)/i.exec(e.trecho ?? "")?.[1] ?? null;
    const nome = m ? m[1].trim() : null;
    let card: any = null; let ligacao: "cotacao" | "nome" | null = null; let motivo: string | null = null;
    const pc = cotacao ? porCotacao.get(dig(cotacao)) ?? [] : [];
    if (pc.length === 1) { card = pc[0]; ligacao = "cotacao"; r.porCotacao++; }
    else if (pc.length > 1) { motivo = "mais de um card com a mesma cotação"; r.ambiguo++; }
    else if (nome) {
      const pn = porNome.get(normNome(nome)) ?? [];
      if (pn.length === 1) { card = pn[0]; ligacao = "nome"; r.porNome++; }
      else if (pn.length > 1) { motivo = "o nome casa mais de um card de Fiança"; r.ambiguo++; }
      else { motivo = "nenhum card de Fiança com essa cotação ou esse nome"; r.semCard++; }
    } else { motivo = "e-mail sem nome do pretendente nem cotação"; r.semCard++; }
    const d = card?.documento_id ? docs.get(card.documento_id) : null;
    linhas.push({ message_id: e.message_id, email_id: e.id, seguradora: "TOKI", data_email: e.data, resultado, negocio, cotacao, pretendente_nome: nome, anexo_pdf: e.tem_anexo, origem_id: card?.id ?? null, card_item_id: card?.item_id ?? null,
      documento_id: card?.documento_id ?? null, imobiliaria_id: d?.imobiliaria_id ?? null, seguradora_id: d?.seguradora_id ?? null, ligacao, motivo_sem_vinculo: motivo, lote: LOTE });
  }
  const ligados = linhas.filter((l) => l.origem_id);
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"} — análises de crédito Tokio: ${linhas.length} e-mails com resultado (${r.semResultado} sem resultado reconhecido); cards de Fiança lidos: ${cards.length}`);
  console.log(`por resultado: ${JSON.stringify(porResultado)}`);
  console.log(`ligados ao card: ${ligados.length} (pela cotação ${r.porCotacao}, pelo nome ${r.porNome}) | ambíguos ${r.ambiguo} | sem card ${r.semCard}`);
  console.log(`cards de Fiança com pelo menos 1 análise: ${new Set(ligados.map((l) => l.card_item_id)).size}`);
  if (!GRAVAR) return;
  const unicas = [...new Map(linhas.map((l) => [l.message_id, l])).values()];
  for (let i = 0; i < unicas.length; i += 200) { const { error } = await sb.from("erp_fianca_analise_credito").upsert(unicas.slice(i, i + 200), { onConflict: "message_id" }); if (error) throw new Error(error.message); }
  console.log(`gravadas ${unicas.length}`);
})();
