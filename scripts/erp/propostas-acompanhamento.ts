// Classifica as propostas pendentes de EMISSÃO (erp_emissao_fila_pronta) pelo que aconteceu com elas, SÓ com prova (guia de fontes, nível 5 e-mail):
//  • Tokio "Parecer de Crédito": aprovado/pré-aprovado -> credito_aprovado_aguardando; reprovado -> recusada_pela_seguradora; "Pendência cadastral" -> pendencia_cadastral
//    (liga pelo nome do pretendente = garantido/locatário ou cliente da proposta; precisa de 1 só candidato; vale o e-mail mais recente)
//  • e-mail de emissão que casou (erp_emissao_sem_documento 'provavel'/'forte') -> emitida_pela_seguradora
//  • e-mails "RETRANSMISSÃO" e "cancel*" com o nome inteiro de uma só proposta -> retransmitida / cancelada (provável)
//  • o resto: sem_informacao (nunca chute). Nada sai da tela de Emissão sozinho. Ensaio por padrão; --gravar grava (upsert por documento_id).
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/propostas-acompanhamento.ts [--gravar]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { normNome } from "@/lib/erp/tarefaCadastro";

const GRAVAR = process.argv.includes("--gravar");
const LOTE = `PROPOSTAS-ACOMP-${new Date().toISOString().slice(0, 10)}`;
const sb = createServiceClient();
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const em = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

async function todas<T>(tabela: string, cols: string, filtro?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    let q: any = sb.from(tabela).select(cols).order("id").range(de, de + 999); if (filtro) q = filtro(q);
    const { data, error } = await q; if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...(data ?? [])); if (!data || data.length < 1000) break;
  }
  return out;
}

type Ev = { motivo: string; tipo: string; ref: string; resumo: string; data: string; confianca: "forte" | "provavel"; detalhes: Record<string, unknown> };

(async () => {
  const pend = await todas<any>("erp_emissao_fila_pronta", "id,cliente,seguradora,imobiliaria_id,nosso_numero");
  const ids = pend.map((p) => p.id);
  // nomes por proposta: cliente + partes dos itens (garantido/locatário)
  const nomes = new Map<string, Set<string>>();
  const add = (id: string, n: string | null | undefined) => { const k = normNome(String(n ?? "")); if (k.split(" ").length >= 2) (nomes.get(id) ?? nomes.set(id, new Set()).get(id)!).add(k); };
  for (const p of pend) add(p.id, p.cliente);
  for (const g of em(ids)) {
    const { data: its } = await sb.from("erp_documento_itens").select("id,documento_id").in("documento_id", g);
    const itemDoc = new Map((its ?? []).map((i) => [i.id, i.documento_id]));
    for (const h of em([...itemDoc.keys()])) {
      const { data: ps } = await sb.from("erp_item_partes").select("item_id,nome").in("item_id", h);
      for (const x of ps ?? []) add(itemDoc.get(x.item_id)!, x.nome);
    }
  }
  const porNome = new Map<string, Set<string>>(); // nome -> propostas
  for (const [id, set] of nomes) for (const n of set) (porNome.get(n) ?? porNome.set(n, new Set()).get(n)!).add(id);
  const segDoc = new Map(pend.map((p) => [p.id, String(p.seguradora ?? "")]));

  const evid = new Map<string, Ev[]>();
  const poe = (id: string, e: Ev) => (evid.get(id) ?? evid.set(id, []).get(id)!).push(e);

  // 1) Tokio: parecer de crédito e pendência cadastral (pretendente + negócio + cotação)
  const tokio = await todas<any>("erp_emails", "id,message_id,assunto,trecho,data", (q) => q.ilike("de", "%@%tokiomarine%").or("assunto.ilike.%parecer de cr%,assunto.ilike.%pend_ncia cadastral%"));
  let tokioSemNome = 0, tokioAmbiguo = 0, tokioSemProposta = 0;
  for (const e of tokio) {
    const a = sem(e.assunto ?? "").toLowerCase();
    const motivo = /reprovado/.test(a) ? "recusada_pela_seguradora" : /pendencia cadastral/.test(a) ? "pendencia_cadastral" : /aprovado/.test(a) ? "credito_aprovado_aguardando" : null;
    if (!motivo) continue;
    const m = /pretendente\s+(.+?)\s+vinculado ao neg[oó]cio\s+(\d+)(?:\s+e cota[cç][aã]o\s+(\d+))?/i.exec(e.trecho ?? "");
    const negocio = /Neg[oó]cio:\s*(\d+)/i.exec(e.assunto ?? "")?.[1] ?? m?.[2] ?? null;
    const nome = m ? normNome(m[1]) : null;
    if (!nome) { tokioSemNome++; continue; }
    const props = [...(porNome.get(nome) ?? [])].filter((id) => /TOKI/i.test(segDoc.get(id) ?? ""));
    if (props.length === 0) { tokioSemProposta++; continue; }
    if (props.length > 1) { tokioAmbiguo++; continue; }
    poe(props[0], { motivo, tipo: "email", ref: e.message_id, resumo: `Tokio: ${/reprovado/.test(a) ? "cadastro reprovado" : motivo === "pendencia_cadastral" ? "pendência cadastral" : "crédito aprovado"}`, data: e.data, confianca: "forte", detalhes: { negocio, cotacao: m?.[3] ?? null, padrao: "tokio_parecer_credito" } });
  }
  // 2) e-mail de emissão que casou com a proposta
  const emis = await todas<any>("erp_emissao_sem_documento", "message_id,data_email,classificacao,proposta_documento_id,seguradora,numero_extraido,codigo_padrao", (q) => q.in("classificacao", ["provavel", "forte"]).not("proposta_documento_id", "is", null));
  for (const x of emis) poe(x.proposta_documento_id, { motivo: "emitida_pela_seguradora", tipo: "email", ref: x.message_id, resumo: `E-mail de emissão (${x.codigo_padrao})`, data: x.data_email, confianca: x.classificacao === "forte" ? "forte" : "provavel", detalhes: { numero_no_email: x.numero_extraido, padrao: x.codigo_padrao } });
  // 3) retransmissão e cancelamento: nome inteiro de uma só proposta no assunto/trecho
  const outros = await todas<any>("erp_emails", "id,message_id,assunto,trecho,data", (q) => q.or("assunto.ilike.%retransmiss%,assunto.ilike.%cancel%"));
  for (const e of outros) {
    const a = sem(e.assunto ?? "").toLowerCase();
    const motivo = /retransmiss/.test(a) ? "retransmitida" : /cancel/.test(a) ? "cancelada" : null; if (!motivo) continue;
    const texto = normNome(`${e.assunto ?? ""} ${e.trecho ?? ""}`);
    const cand = new Set<string>(); for (const [n, set] of porNome) if (texto.includes(n)) for (const id of set) cand.add(id);
    if (cand.size === 1) poe([...cand][0], { motivo, tipo: "email", ref: e.message_id, resumo: motivo === "retransmitida" ? "E-mail de retransmissão" : "E-mail de cancelamento", data: e.data, confianca: "provavel", detalhes: { padrao: "assunto_" + motivo } });
  }

  // decisão por proposta: o e-mail mais recente de maior força
  const PESO: Record<string, number> = { emitida_pela_seguradora: 5, cancelada: 4, retransmitida: 4, recusada_pela_seguradora: 3, pendencia_cadastral: 2, credito_aprovado_aguardando: 1 };
  const linhas: any[] = []; const cont: Record<string, number> = {};
  for (const p of pend) {
    const evs = (evid.get(p.id) ?? []).sort((a, b) => (PESO[b.motivo] - PESO[a.motivo]) || String(b.data).localeCompare(String(a.data)));
    // o mais recente ENTRE os de parecer da Tokio manda sobre os anteriores; emissão e cancelamento/retransmissão têm prioridade
    const melhor = evs[0];
    const motivo = melhor?.motivo ?? "sem_informacao"; cont[motivo] = (cont[motivo] ?? 0) + 1;
    linhas.push({ documento_id: p.id, motivo, evidencia_tipo: melhor?.tipo ?? null, evidencia_ref: melhor?.ref ?? null, evidencia_resumo: melhor?.resumo ?? "nenhuma prova encontrada nos e-mails (nível 5)", data_evidencia: melhor?.data ?? null, confianca: melhor?.confianca ?? null,
      detalhes: melhor ? { ...melhor.detalhes, outras_evidencias: evs.length - 1 } : null, fonte: "email_controle_emissao", nivel: 5, imobiliaria_id: p.imobiliaria_id, lote: LOTE });
  }
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"}: ${pend.length} propostas pendentes (${nomes.size} com nome); e-mails Tokio de parecer/pendência ${tokio.length} (sem nome ${tokioSemNome}, sem proposta ${tokioSemProposta}, ambíguos ${tokioAmbiguo})`);
  console.log("por motivo:", JSON.stringify(cont));
  const porSeg: Record<string, Record<string, number>> = {};
  for (const l of linhas) { const s = segDoc.get(l.documento_id) ?? "?"; (porSeg[s] ??= {})[l.motivo] = (porSeg[s][l.motivo] ?? 0) + 1; }
  for (const [s, v] of Object.entries(porSeg).sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0)).slice(0, 8)) console.log(`  ${s}: ${JSON.stringify(v)}`);
  if (!GRAVAR) return;
  for (const g of em(linhas, 200)) { const { error } = await sb.from("erp_proposta_acompanhamento").upsert(g, { onConflict: "documento_id" }); if (error) throw new Error(error.message); }
  console.log(`gravadas ${linhas.length}`);
})();
