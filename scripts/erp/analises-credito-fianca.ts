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
  // 2ª passada (Matheus 01/11: "qualquer dado de qualquer apólice de qualquer período"): o que não achou card liga ao DOCUMENTO de Fiança da Tokio no ERP pelo nome do
  // pretendente (cliente ou parte do item), de qualquer época, só com 1 documento. O investigado é o vigente, mas o antigo também é guardado e ligado.
  const docsTokio = await todas<any>("erp_documentos", "id,locatario_id,imobiliaria_principal_id,seguradora_id,seguradora:erp_seguradoras!inner(abreviacao),ramo:erp_ramos!inner(produto)", (q) => q.eq("ramo.produto", "fianca").eq("seguradora.abreviacao", "TOKI"));
  const nomeDoc = new Map<string, Set<string>>(); const infoDoc = new Map(docsTokio.map((d) => [d.id, d]));
  const addNome = (id: string, n: unknown) => { const k = normNome(String(n ?? "")); if (k.split(" ").length >= 2) (nomeDoc.get(k) ?? nomeDoc.set(k, new Set()).get(k)!).add(id); };
  const locIds = [...new Set(docsTokio.map((d) => d.locatario_id).filter(Boolean))] as string[];
  const locNome = new Map<string, string>();
  for (let i = 0; i < locIds.length; i += 200) { const { data } = await sb.from("locatarios").select("id,nome").in("id", locIds.slice(i, i + 200)); for (const l of data ?? []) locNome.set(l.id, l.nome); }
  for (const d of docsTokio) addNome(d.id, locNome.get(d.locatario_id));
  const docIds = docsTokio.map((d) => d.id);
  for (let i = 0; i < docIds.length; i += 150) {
    const { data: its } = await sb.from("erp_documento_itens").select("id,documento_id").in("documento_id", docIds.slice(i, i + 150));
    const itemDoc = new Map((its ?? []).map((x) => [x.id, x.documento_id]));
    const itemIds = [...itemDoc.keys()];
    for (let j = 0; j < itemIds.length; j += 150) { const { data: ps } = await sb.from("erp_item_partes").select("item_id,nome").in("item_id", itemIds.slice(j, j + 150)); for (const p of ps ?? []) addNome(itemDoc.get(p.item_id)!, p.nome); }
  }
  let porDocumento = 0;
  for (const l of linhas) {
    if (l.origem_id || !l.pretendente_nome) continue;
    const c = [...(nomeDoc.get(normNome(l.pretendente_nome)) ?? [])];
    if (c.length === 1) { const d = infoDoc.get(c[0]); l.documento_id = c[0]; l.imobiliaria_id = d?.imobiliaria_principal_id ?? null; l.seguradora_id = d?.seguradora_id ?? null; l.ligacao = "nome_documento"; l.motivo_sem_vinculo = null; porDocumento++; }
    else if (c.length > 1) l.motivo_sem_vinculo = "o nome casa mais de um documento de Fiança da Tokio";
    else if (!l.motivo_sem_vinculo) l.motivo_sem_vinculo = "nenhum card nem documento de Fiança da Tokio com esse nome";
  }
  console.log(`2ª passada: ligados ao documento pelo nome (sem card): ${porDocumento}`);
  const ligados = linhas.filter((l) => l.origem_id || l.documento_id);
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"} — análises de crédito Tokio: ${linhas.length} e-mails com resultado (${r.semResultado} sem resultado reconhecido); cards de Fiança lidos: ${cards.length}`);
  console.log(`por resultado: ${JSON.stringify(porResultado)}`);
  console.log(`ligados ao card: ${ligados.length} (pela cotação ${r.porCotacao}, pelo nome ${r.porNome}) | ambíguos ${r.ambiguo} | sem card ${r.semCard}`);
  console.log(`cards com análise: ${new Set(linhas.filter((l) => l.card_item_id).map((l) => l.card_item_id)).size} | documentos com análise: ${new Set(ligados.map((l) => l.documento_id).filter(Boolean)).size} | e-mails sem vínculo ${linhas.length - ligados.length}`);
  if (!GRAVAR) return;
  const unicas = [...new Map(linhas.map((l) => [l.message_id, l])).values()];
  for (let i = 0; i < unicas.length; i += 200) { const { error } = await sb.from("erp_fianca_analise_credito").upsert(unicas.slice(i, i + 200), { onConflict: "message_id" }); if (error) throw new Error(error.message); }
  console.log(`gravadas ${unicas.length}`);
})();
