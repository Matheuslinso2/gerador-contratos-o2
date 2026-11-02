process.loadEnvFile(".env.local");
// ERP O2 — 02/11/2026 (Matheus: "nas apólices atuais ela deve mencionar a renovação — 'renovação congênere' ou 'renova apólice x'"): lê, SEM IA, o PDF da apólice SUCESSORA
// (a que renova) e grava em erp_apolice_renova_pdf o que o documento oficial diz sobre a renovação: nº citado ("Renova apólice nº: …"), "apólice anterior", "renovação congênere".
// Fonte nível 1 (documento oficial). Não altera erp_documentos. Desfazer: delete from erp_apolice_renova_pdf where lote = '<lote>'.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/ler-renova-apolice-pdfs.ts <lote> [paralelo=3] [limite]
import { createServiceClient } from "@/lib/supabase/service";
import { abrirTextoPdfComSenha, candidatosSenhaO2 } from "@/lib/pdfComSenha";

const NUM = "([\\d][\\d .\\-/]{4,30}\\d)";
const PADROES: { tipo: string; re: RegExp }[] = [
  { tipo: "renova_apolice_numero_antes_do_rotulo", re: new RegExp(NUM + "\\s*Renova\\s+ap[óo]lice\\s+n[ºo°]?\\s*:", "i") },
  { tipo: "renova_apolice_numero_depois_do_rotulo", re: new RegExp("Renova\\s+ap[óo]lice\\s+n[ºo°]?\\s*:?\\s*" + NUM, "i") },
  { tipo: "apolice_anterior", re: new RegExp("ap[óo]lice\\s+anterior[^\\d]{0,40}" + NUM, "i") },
  { tipo: "renovacao_da_apolice", re: new RegExp("renova[çc][ãa]o\\s+d[aoe]\\s+ap[óo]lice(?:\\s+n[ºo°]?)?\\s*:?\\s*" + NUM, "i") },
];
const CONGENERE = /renova[çc][ãa]o\s+cong[eê]nere|cong[eê]nere/i;

const digitos = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");

(async () => {
  const sb = createServiceClient();
  const lote = process.argv[2];
  const paralelo = Number(process.argv[3] ?? 3);
  const limite = Number(process.argv[4] ?? 100000);
  if (!lote) throw new Error("uso: <lote> [paralelo] [limite]");
  // sucessoras (ligadas ou prováveis) das renovações efetivadas, com PDF de apólice
  const alvo: { sid: string; anterior: string | null; chave: string }[] = [];
  for (let de = 0; ; de += 1000) {
    const { data } = await sb.from("erp_renovacao_planilha").select("chave, numero_apolice, documento_sucessor_id, documento_sucessor_provavel_id").eq("situacao", "efetivada").range(de, de + 999);
    for (const r of data ?? []) { const sid = r.documento_sucessor_id ?? r.documento_sucessor_provavel_id; if (sid) alvo.push({ sid, anterior: r.numero_apolice, chave: r.chave }); }
    if (!data || data.length < 1000) break;
  }
  const unicos = [...new Map(alvo.map((a) => [a.sid, a])).values()].slice(0, limite);
  console.log("sucessoras:", unicos.length);
  const res = { lidas: 0, sem_pdf: 0, sem_texto: 0, com_rotulo: 0, com_numero: 0, congenere: 0, erro: 0 };
  let i = 0;
  async function um(a: { sid: string; anterior: string | null }) {
    const { data: ax } = await sb.from("erp_documento_anexos").select("storage_path").eq("documento_id", a.sid).eq("tipo", "apolice").not("storage_path", "is", null).limit(1);
    if (!ax?.length) { res.sem_pdf++; return; }
    try {
      const { data } = await sb.storage.from("anexos-documentos").download(ax[0].storage_path);
      if (!data) { res.erro++; return; }
      const r = await abrirTextoPdfComSenha(Buffer.from(await data.arrayBuffer()), candidatosSenhaO2());
      const t = (r?.texto ?? "").replace(/\s+/g, " ");
      if (t.length < 200) { res.sem_texto++; return; }
      res.lidas++;
      let tipo: string | null = null, numero: string | null = null, trecho: string | null = null;
      for (const p of PADROES) { const m = p.re.exec(t); if (m) { tipo = p.tipo; numero = m[1].trim(); trecho = t.slice(Math.max(0, m.index - 60), m.index + m[0].length + 40); break; } }
      const rot = /Renova\s+ap[óo]lice/i.exec(t);
      const cong = CONGENERE.exec(t);
      if (rot || tipo) res.com_rotulo++;
      if (numero) res.com_numero++;
      if (cong) res.congenere++;
      const dn = numero ? digitos(numero) : null;
      const da = a.anterior ? digitos(a.anterior) : null;
      const confere = dn && da ? (dn === da || dn.endsWith(da) || da.endsWith(dn) ? true : false) : null;
      await sb.from("erp_apolice_renova_pdf").upsert({
        documento_id: a.sid, achou_rotulo: !!(rot || tipo), tipo, numero_citado: numero, numero_digitos: dn, trecho, congenere: !!cong,
        trecho_congenere: cong ? t.slice(Math.max(0, cong.index - 80), cong.index + 160) : null, anterior_planilha: a.anterior, confere_com_anterior: confere, texto_len: t.length, lote, lido_em: new Date().toISOString(),
      }, { onConflict: "documento_id" });
    } catch { res.erro++; }
    if ((res.lidas + res.sem_pdf + res.erro) % 100 === 0) console.log(JSON.stringify(res));
  }
  await Promise.all(Array.from({ length: paralelo }, async () => { while (i < unicos.length) { const a = unicos[i++]; await um(a); } }));
  console.log("FIM", JSON.stringify(res));
})().catch((e) => { console.error("ERRO", e.message); process.exit(1); });
