// "Emitida pela seguradora, sem documento no ERP": percorre os e-mails de controle de emissão (catálogo), extrai nº da apólice/endosso, seguradora, data, anexo e,
// quando casa, o nome do segurado de uma proposta pendente de emissão (erp_emissao_fila_pronta). Classifica: ja_tratado (nº já existe em documento),
// forte (nº NÃO existe e o nome casa uma proposta pendente), provavel (só nome casa), sem_registro. Grava em erp_emissao_sem_documento (nível 5, só leitura de e-mails).
// Nada sai da tela de Emissão sozinho. Ensaio por padrão; --gravar grava (upsert por message_id).
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/emissao-sem-documento.ts [--gravar]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { normNome } from "@/lib/erp/tarefaCadastro";

const GRAVAR = process.argv.includes("--gravar");
const LOTE = `EMISSAO-SEM-DOC-${new Date().toISOString().slice(0, 10)}`;
const sb = createServiceClient();
const dig = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

type Padrao = { codigo: string; seg: string; dominio: string; assunto: RegExp; tipo: "apolice" | "endosso" | "faturamento"; numero: (a: string, t: string) => string | null };
const docPorto = (a: string) => { const m = /Documento:\s*\d+\s*\/\s*\d+\s*\/\s*(\d+)/i.exec(a); return m ? dig(m[1]) : null; };
const PADROES: Padrao[] = [
  { codigo: "porto_apolice_fianca", seg: "PORT", dominio: "portoseguro", assunto: /apolice do seu porto seguro fianca locaticia foi emitida/i, tipo: "apolice", numero: docPorto },
  { codigo: "porto_endosso_fianca", seg: "PORT", dominio: "portoseguro", assunto: /endosso do seu porto seguro fianca locaticia foi emitido/i, tipo: "endosso", numero: docPorto },
  { codigo: "porto_apolice_seguro", seg: "PORT", dominio: "portoseguro", assunto: /a apolice do seu seguro foi emitida/i, tipo: "apolice", numero: () => null },
  { codigo: "porto_endosso_seguro", seg: "PORT", dominio: "portoseguro", assunto: /endosso do seu seguro foi emitido/i, tipo: "endosso", numero: (a) => { const m = /Ap[oó]lice:\s*#?\s*([\d./ -]+)/i.exec(a); return m ? dig(m[1]) : null; } },
  { codigo: "tokio_apolice_digital", seg: "TOKI", dominio: "tokiomarine", assunto: /apolice digital/i, tipo: "apolice", numero: (a) => { const m = /Ap[oó]lice Digital\s*-?\s*([\d.]+)/i.exec(a); return m ? dig((m[1].split(".").pop() ?? "")) : null; } },
  { codigo: "alfa_faturamento_apolice", seg: "ALFA", dominio: "alfaseg", assunto: /faturamento - apolice/i, tipo: "faturamento", numero: (a) => { const m = /\(\s*([\d.]+)\s*\)/.exec(a); return m ? dig(m[1]) : null; } },
  { codigo: "suhai_apolice_emitida", seg: "SUHAI", dominio: "suhai", assunto: /apolice do seu seguro ja foi emitida/i, tipo: "apolice", numero: (a) => { const m = /EMITIDA:\s*(\d+)/i.exec(a); return m ? dig(m[1]) : null; } },
  { codigo: "hdi_apolice", seg: "HDI", dominio: "hdi", assunto: /apolice hdi/i, tipo: "apolice", numero: () => null },
];

async function todas<T>(tabela: string, cols: string, filtro?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    let q: any = sb.from(tabela).select(cols).range(de, de + 999); if (filtro) q = filtro(q);
    const { data, error } = await q; if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...(data ?? [])); if (!data || data.length < 1000) break;
  }
  return out;
}

(async () => {
  const pend = await todas<any>("erp_emissao_fila_pronta", "id,cliente,seguradora,imobiliaria_id");
  const nomesPend = pend.map((p) => ({ id: p.id, nome: normNome(String(p.cliente ?? "")), imobiliaria_id: p.imobiliaria_id, seg: String(p.seguradora ?? "") })).filter((p) => p.nome.split(" ").length >= 2);
  const { data: segs } = await sb.from("erp_seguradoras").select("id,abreviacao");
  const segIds = new Map<string, string[]>(); for (const s of segs ?? []) (segIds.get(s.abreviacao) ?? segIds.set(s.abreviacao, []).get(s.abreviacao)!).push(s.id);

  const linhas: any[] = []; const resumo: Record<string, Record<string, number>> = {};
  for (const p of PADROES) {
    const emails = (await todas<any>("erp_emails", "id,message_id,assunto,trecho,tem_anexo,data", (q) => q.ilike("de", `%@%${p.dominio}%`))).filter((e) => p.assunto.test(semAcento(e.assunto ?? "").toLowerCase()));
    const r = (resumo[p.codigo] = { emails: emails.length, ja_tratado: 0, forte: 0, provavel: 0, sem_registro: 0 });
    for (const e of emails) {
      const numero = p.numero(e.assunto ?? "", e.trecho ?? "");
      let documento_id: string | null = null;
      // Porto "apólice do seu seguro": o trecho cita "proposta 1913668816" -> numero_proposta do ERP
      const propostaTrecho = /proposta\s+(\d{6,})/i.exec(e.trecho ?? "")?.[1] ?? null;
      if (propostaTrecho) {
        const { data: dp } = await sb.from("erp_documentos").select("id").in("seguradora_id", segIds.get(p.seg) ?? []).eq("numero_proposta", propostaTrecho).limit(2);
        if (dp?.length === 1) documento_id = dp[0].id;
      }
      // Porto endosso: o nº vem com 20 dígitos; o nº curto da apólice está dentro, antes do "0001" final
      if (!documento_id && numero && numero.length >= 17 && p.seg === "PORT") {
        for (const cand of [numero.slice(0, -4).slice(-7), numero.slice(0, -4).slice(-8)]) {
          const { data: dd } = await sb.from("erp_documentos").select("id,numero_apolice").in("seguradora_id", segIds.get(p.seg) ?? []).like("numero_apolice", `%${cand}`).limit(3);
          const ex2 = (dd ?? []).filter((d) => dig(d.numero_apolice ?? "").endsWith(cand));
          if (ex2.length === 1) { documento_id = ex2[0].id; break; }
        }
      }
      if (!documento_id && numero && numero.length >= 5 && numero.length < 17) {
        const { data: ds } = await sb.from("erp_documentos").select("id,numero_apolice").in("seguradora_id", segIds.get(p.seg) ?? []).like("numero_apolice", `%${numero}`).limit(4);
        const ex = (ds ?? []).filter((d) => dig(d.numero_apolice ?? "").endsWith(numero));
        if (ex.length >= 1) documento_id = ex[0].id;
      }
      let classificacao: "ja_tratado" | "forte" | "provavel" | "sem_registro"; let proposta: any = null; let nome: string | null = null;
      if (documento_id) classificacao = "ja_tratado";
      else {
        const texto = normNome(`${e.assunto ?? ""} ${e.trecho ?? ""}`);
        const cand = nomesPend.filter((n) => texto.includes(n.nome));
        if (cand.length === 1) { proposta = cand[0]; nome = cand[0].nome; classificacao = numero ? "forte" : "provavel"; } else classificacao = "sem_registro";
      }
      r[classificacao]++;
      linhas.push({ message_id: e.message_id, email_id: e.id, seguradora: p.seg, codigo_padrao: p.codigo, data_email: e.data, tipo: p.tipo, numero_extraido: numero, segurado_nome: nome, anexo_pdf: e.tem_anexo, classificacao,
        documento_id, proposta_documento_id: proposta?.id ?? null, imobiliaria_id: proposta?.imobiliaria_id ?? null, seguradora_id: (segIds.get(p.seg) ?? [])[0] ?? null,
        baixar_no_portal: classificacao === "forte" || classificacao === "provavel" || classificacao === "sem_registro",
        motivo: classificacao === "ja_tratado" ? null : classificacao === "sem_registro" ? "emissão sem proposta ou documento correspondente no ERP" : classificacao === "provavel" ? "só o nome do segurado casa com uma proposta pendente (sem nº)" : "nº não existe em documento; nome casa 1 proposta pendente",
        lote: LOTE });
    }
  }
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"} — emitida pela seguradora x ERP (${nomesPend.length} propostas pendentes com nome)`);
  for (const [k, v] of Object.entries(resumo)) console.log(`${k}: e-mails ${v.emails} | já tratado ${v.ja_tratado} | forte ${v.forte} | provável ${v.provavel} | sem registro ${v.sem_registro}`);
  const unicas = [...new Map(linhas.map((l) => [l.message_id, l])).values()];
  console.log(`total ${unicas.length} e-mails`);
  if (!GRAVAR) return;
  for (let i = 0; i < unicas.length; i += 200) {
    const { error } = await sb.from("erp_emissao_sem_documento").upsert(unicas.slice(i, i + 200), { onConflict: "message_id" });
    if (error) throw new Error(error.message);
  }
  console.log(`gravados ${unicas.length}`);
})();
