// E-mails automáticos das seguradoras que PROVAM emissão (catálogo erp_emails_controle_emissao_catalogo): extrai o nº da apólice do assunto, liga ao
// documento do ERP (mesma seguradora, 1 só candidato) e grava a evidência em erp_emails_evidencia_emissao (nível 5 do guia: e-mail sozinho confirma, não muda valor/data).
// Ensaio por padrão; --gravar grava. Só Porto, Tokio e Alfa têm nº no assunto.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/emails-emissao-evidencia.ts [--gravar]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";

const GRAVAR = process.argv.includes("--gravar");
const sb = createServiceClient();
type Regra = { codigo: string; seg: string; dominio: string; assunto: RegExp; extrai: (a: string) => string | null; prova: string };
const dig = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");
const REGRAS: Regra[] = [
  { codigo: "porto_apolice_fianca", seg: "PORT", dominio: "portoseguro", assunto: /ap[oó]lice do seu porto seguro fianca locaticia foi emitida/i, extrai: (a) => { const m = /Documento:\s*\d+\s*\/\s*\d+\s*\/\s*(\d+)/i.exec(a); return m ? dig(m[1]) : null; }, prova: "emissao_apolice" },
  { codigo: "porto_endosso_fianca", seg: "PORT", dominio: "portoseguro", assunto: /endosso do seu porto seguro fianca locaticia foi emitido/i, extrai: (a) => { const m = /Documento:\s*\d+\s*\/\s*\d+\s*\/\s*(\d+)/i.exec(a); return m ? dig(m[1]) : null; }, prova: "emissao_endosso" },
  { codigo: "porto_endosso_seguro", seg: "PORT", dominio: "portoseguro", assunto: /endosso do seu seguro foi emitido/i, extrai: (a) => { const m = /Ap[oó]lice:\s*#?\s*([\d.\/ -]+)/i.exec(a); return m ? dig(m[1]) : null; }, prova: "emissao_endosso" },
  { codigo: "tokio_apolice_digital", seg: "TOKI", dominio: "tokiomarine", assunto: /ap[oó]lice digital/i, extrai: (a) => { const m = /Ap[oó]lice Digital\s*-?\s*([\d.]+)/i.exec(a); return m ? dig(m[1].split(".").pop() ?? "") : null; }, prova: "emissao_apolice" },
  { codigo: "alfa_faturamento_apolice", seg: "ALFA", dominio: "alfaseg", assunto: /faturamento - ap[oó]lice/i, extrai: (a) => { const m = /\(\s*([\d.]+)\s*\)/.exec(a); return m ? dig(m[1]) : null; }, prova: "faturamento_apolice" },
];

(async () => {
  const { data: segs } = await sb.from("erp_seguradoras").select("id,abreviacao");
  const segId = new Map<string, string[]>();
  for (const s of segs ?? []) (segId.get(s.abreviacao) ?? segId.set(s.abreviacao, []).get(s.abreviacao)!).push(s.id);
  const res: Record<string, { emails: number; semNumero: number; ligado: number; ambiguo: number; semDoc: number }> = {};
  const evid: { documento_id: string; message_id: string; criterio: string; palavra: string; numero_citado: string }[] = [];
  for (const r of REGRAS) {
    const x = (res[r.codigo] = { emails: 0, semNumero: 0, ligado: 0, ambiguo: 0, semDoc: 0 });
    const emails: { message_id: string; assunto: string }[] = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await sb.from("erp_emails").select("message_id,assunto").ilike("de", `%@%${r.dominio}%`).order("message_id").range(de, de + 999);
      if (error) throw new Error(error.message);
      emails.push(...((data ?? []) as any[]).filter((e) => r.assunto.test((e.assunto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")) || r.assunto.test(e.assunto ?? "")));
      if (!data || data.length < 1000) break;
    }
    for (const e of emails) {
      x.emails++;
      const n = r.extrai(e.assunto ?? "");
      if (!n || n.length < 5) { x.semNumero++; continue; }
      const ids = segId.get(r.seg) ?? [];
      const { data: ds } = await sb.from("erp_documentos").select("id,numero_apolice").in("seguradora_id", ids).like("numero_apolice", `%${n}`).limit(4);
      const exatos = (ds ?? []).filter((d) => dig(d.numero_apolice ?? "").endsWith(n));
      if (exatos.length === 1) { x.ligado++; evid.push({ documento_id: exatos[0].id, message_id: e.message_id, criterio: "numero_apolice", palavra: r.prova, numero_citado: n }); }
      else if (exatos.length > 1) x.ambiguo++; else x.semDoc++;
    }
  }
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"} — evidências de emissão por e-mail de controle`);
  for (const [k, v] of Object.entries(res)) console.log(`${k}: e-mails ${v.emails} | sem nº no assunto ${v.semNumero} | ligados a 1 documento ${v.ligado} | ambíguos ${v.ambiguo} | sem documento no ERP ${v.semDoc}`);
  console.log(`total de evidências: ${evid.length} em ${new Set(evid.map((e) => e.documento_id)).size} documentos`);
  if (!GRAVAR) return;
  const unicas = [...new Map(evid.map((e) => [`${e.documento_id}|${e.message_id}`, e])).values()]; // mesmo e-mail pode casar duas vezes
  for (let i = 0; i < unicas.length; i += 200) {
    const { error } = await sb.from("erp_emails_evidencia_emissao").upsert(unicas.slice(i, i + 200), { onConflict: "documento_id,message_id" });
    if (error) throw new Error(error.message);
  }
  console.log(`gravadas ${unicas.length}`);
})();
