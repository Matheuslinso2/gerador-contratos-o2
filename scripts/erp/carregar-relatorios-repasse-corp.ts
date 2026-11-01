// Carrega os relatórios de repasse do Corp (Prg. 316) que a equipe enviou às imobiliárias por e-mail ("COMISSÃO <IMOB> - O2 SEGUROS - <MÊS>", anexo REPASSE ...pdf)
// para erp_repasse_cargas / erp_repasse_relatorios_corp / erp_repasse_relatorios_corp_linhas. Fonte nível 8 do guia (Corp = comparação). Registra TODOS os campos do
// relatório, menos dados bancários e e-mail do produtor (sensível). Cada PDF é uma carga (hash único) que pode ser desfeita (erp_repasse_desfazer_carga).
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/carregar-relatorios-repasse-corp.ts [--limite 100] [--gravar]
// Sem --gravar é ensaio: lê, confere (soma das linhas × total do rodapé) e mostra o resumo, sem escrever no banco.
process.loadEnvFile(".env.local");
import { createHash } from "node:crypto";
import { getDocumentProxy } from "unpdf";
import { createServiceClient } from "@/lib/supabase/service";
import { lerAnexosPdf } from "@/lib/erp/emails";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const GRAVAR = process.argv.includes("--gravar");
const LIMITE = Number(arg("limite") ?? 200);
const sb = createServiceClient();

type Item = { s: string; x: number; y: number };
type Linha = { ordem: number; segurado: string; seg_abrev: string; ramo: string; documento: string; tipo: string; parcela_n: number | null; parcela_total: number | null; previsao: string | null; pct_part: number | null; base: number | null; pct_rep: number | null; valor: number | null };
type Relatorio = { produtor_codigo: number | null; produtor_nome: string; agente: string; periodo_de: string | null; periodo_ate: string | null; gerado_no_corp: string | null; programa: string | null; total_base: number | null; total_repasse: number | null; desconto_pct: number | null; desconto_valor: number | null; total_liquido: number | null; qtde: number | null; linhas: Linha[] };

const num = (s: string | undefined) => (s === undefined || s === "" ? null : Number(s.replace(/\./g, "").replace(",", ".").replace("%", "")));
const iso = (d: string) => d.split("/").reverse().join("-");
const COLS = [150, 185, 215, 302, 326, 352, 400, 440, 497, 535];
const col = (x: number) => COLS.findIndex((c) => x < c) === -1 ? COLS.length : COLS.findIndex((c) => x < c);

async function ler(buf: Buffer): Promise<Relatorio[]> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const relatorios: Relatorio[] = [];
  let atual: Relatorio | null = null;
  let programa: string | null = null, gerado: string | null = null, de: string | null = null, ate: string | null = null, agente = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    const itens: Item[] = (tc.items as { str: string; transform: number[] }[]).filter((i) => i.str.trim()).map((i) => ({ s: i.str.trim(), x: Math.round(i.transform[4]), y: Math.round(i.transform[5]) }));
    const mapa = new Map<number, Item[]>();
    for (const it of itens) { const k = [...mapa.keys()].find((y) => Math.abs(y - it.y) <= 2) ?? it.y; (mapa.get(k) ?? mapa.set(k, []).get(k)!).push(it); }
    let filtros: string[] = [];
    let emFiltros = false;
    for (const y of [...mapa.keys()].sort((a, b) => b - a)) {
      const r = mapa.get(y)!.sort((a, b) => a.x - b.x);
      const txt = r.map((i) => i.s).join(" ");
      const dh = txt.match(/(\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2}:\d{2})/);
      if (dh && /SGCS/.test(txt)) gerado = `${iso(dh[1])}T${dh[2]}-03:00`;
      if (/Prg\./.test(txt)) programa = txt.match(/Prg\.\s*(\d+)/)?.[1] ?? programa;
      if (/^Filtros:/.test(txt)) { emFiltros = true; filtros = []; }
      if (emFiltros && !/^Agente:/.test(txt)) { filtros.push(txt); continue; }
      if (emFiltros) {
        emFiltros = false;
        const f = filtros.join(" ");
        de = f.match(/maior ou igual a (\d{2}\/\d{2}\/\d{4})/)?.[1] ? iso(f.match(/maior ou igual a (\d{2}\/\d{2}\/\d{4})/)![1]) : null;
        ate = f.match(/menor ou igual a (\d{2}\/\d{2}\/\d{4})/)?.[1] ? iso(f.match(/menor ou igual a (\d{2}\/\d{2}\/\d{4})/)![1]) : null;
      }
      if (/^Agente:/.test(txt)) { agente = txt.match(/Agente:\s*(.+?)\s+Produtor:/)?.[1] ?? ""; const pn = txt.match(/Produtor:\s*(.+)$/)?.[1] ?? ""; atual = { produtor_codigo: null, produtor_nome: pn, agente, periodo_de: de, periodo_ate: ate, gerado_no_corp: gerado, programa, total_base: null, total_repasse: null, desconto_pct: null, desconto_valor: null, total_liquido: null, qtde: null, linhas: [] }; relatorios.push(atual); continue; }
      if (!atual) continue;
      if (/^Segurado /.test(txt)) continue;
      const data = r.find((i) => i.x >= 340 && i.x <= 385 && /^\d{2}\/\d{2}\/\d{4}$/.test(i.s));
      const parc = r.find((i) => i.x >= 322 && i.x <= 350 && /^\d+\/\d+$/.test(i.s));
      if (data && parc) {
        const c: string[][] = Array.from({ length: COLS.length + 1 }, () => []);
        for (const i of r) c[col(i.x)].push(i.s);
        const [pn, pt] = parc.s.split("/").map(Number);
        atual.linhas.push({ ordem: atual.linhas.length + 1, segurado: c[0].join(" "), seg_abrev: c[1].join(" "), ramo: c[2].join(" "), documento: c[3].join(" "), tipo: c[4].join(" "), parcela_n: pn, parcela_total: pt, previsao: iso(data.s), pct_part: num(c[7][0]), base: num(c[8][0]), pct_rep: num(c[9][0]), valor: num(c[10][0]) });
        continue;
      }
      if (/Total do Produtor:/.test(txt)) {
        const nm = r.find((i) => i.x >= 100 && i.x < 300 && /^\d+\s/.test(i.s));
        if (nm) { atual.produtor_codigo = Number(nm.s.split(" ")[0]); }
        const vals = r.filter((i) => i.x >= 440 && /^-?[\d.]+,\d{2}$/.test(i.s));
        atual.total_base = num(vals[0]?.s); atual.total_repasse = num(vals[1]?.s ?? vals[0]?.s);
      } else if (/Desconto \(/.test(txt)) {
        atual.desconto_pct = num(txt.match(/Desconto \(([\d,]+)\s*%\)/)?.[1]);
        atual.desconto_valor = num(r.filter((i) => i.x >= 530 && /^-?[\d.]+,\d{2}$/.test(i.s)).pop()?.s);
      } else if (/^Qtde:/.test(txt)) {
        atual.qtde = Number(r.find((i) => i.x > 60 && /^\d+$/.test(i.s))?.s ?? NaN) || null;
      } else if (/Total Líquido:/.test(txt)) {
        atual.total_liquido = num(r.filter((i) => i.x >= 520 && /^-?[\d.]+,\d{2}$/.test(i.s)).pop()?.s);
      }
    }
  }
  return relatorios;
}

(async () => {
  const { data: emails } = await sb.from("erp_emails").select("message_id,caixas,assunto,data").ilike("de", "%nathalie%").ilike("assunto", "COMISS%").eq("tem_anexo", true).order("data").limit(LIMITE);
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"}: ${emails?.length ?? 0} e-mails da Nathalie com anexo`);
  let cargas = 0, rels = 0, linhasTot = 0, confere = 0, semConferir = 0, repetidas = 0, falhas = 0;
  const { data: imobs } = await sb.from("imobiliarias").select("id,codigo_produtor_corp").not("codigo_produtor_corp", "is", null);
  const porCodigo = new Map<string, string[]>();
  for (const i of imobs ?? []) (porCodigo.get(String(i.codigo_produtor_corp)) ?? porCodigo.set(String(i.codigo_produtor_corp), []).get(String(i.codigo_produtor_corp))!).push(i.id);
  const { data: segs } = await sb.from("erp_seguradoras").select("id,abreviacao");
  const segId = new Map((segs ?? []).map((s) => [s.abreviacao, s.id]));
  for (const m of emails ?? []) {
    let anexos;
    try { anexos = await lerAnexosPdf(m.caixas[0], m.message_id); } catch (e) { falhas++; console.log("falha ao ler anexos:", m.assunto, (e as Error).message); continue; }
    for (const a of anexos.filter((x) => /repasse/i.test(x.nome) && !/comprovante/i.test(x.nome))) {
      const hash = createHash("sha256").update(a.buffer).digest("hex");
      const { data: ja } = await sb.from("erp_repasse_cargas").select("id").eq("arquivo_hash", hash).maybeSingle();
      if (ja) { repetidas++; continue; }
      let lista: Relatorio[];
      try { lista = await ler(a.buffer); } catch (e) { falhas++; console.log("falha ao ler PDF:", a.nome, (e as Error).message); continue; }
      const soma = (r: Relatorio) => Math.round(r.linhas.reduce((s, l) => s + (l.valor ?? 0), 0) * 100) / 100;
      for (const r of lista) { rels++; linhasTot += r.linhas.length; if (r.total_repasse !== null && Math.abs(soma(r) - r.total_repasse) <= 0.05) confere++; else { semConferir++; console.log("  não confere:", m.assunto, r.produtor_nome, "linhas", soma(r), "rodapé", r.total_repasse); } }
      cargas++;
      if (!GRAVAR) continue;
      const { data: carga, error: e1 } = await sb.from("erp_repasse_cargas").insert({ fonte: "relatorio_corp_prg316_email", nivel_guia: 8, arquivo: a.nome, arquivo_hash: hash, email_message_id: m.message_id, email_data: m.data, email_assunto: m.assunto, lido_por: "robô/sessão Repasses ERP", linhas: lista.reduce((s, r) => s + r.linhas.length, 0), observacao: "Relatório de repasse do Corp (Prg. 316) enviado à imobiliária; comparação, nunca âncora. Sem dados bancários nem e-mail do produtor." }).select("id").single();
      if (e1 || !carga) { falhas++; console.log("erro carga:", e1?.message); continue; }
      for (const r of lista) {
        const ids = porCodigo.get(String(r.produtor_codigo)) ?? [];
        const { data: rel, error: e2 } = await sb.from("erp_repasse_relatorios_corp").insert({ carga_id: carga.id, produtor_codigo: r.produtor_codigo, produtor_nome: r.produtor_nome, agente: r.agente, imobiliaria_id: ids.length === 1 ? ids[0] : null, periodo_de: r.periodo_de, periodo_ate: r.periodo_ate, gerado_no_corp: r.gerado_no_corp, programa: r.programa, total_base: r.total_base, total_repasse: r.total_repasse, desconto_pct: r.desconto_pct, desconto_valor: r.desconto_valor, total_liquido: r.total_liquido, qtde: r.qtde, linhas_lidas: r.linhas.length, soma_linhas_confere: r.total_repasse !== null && Math.abs(soma(r) - r.total_repasse) <= 0.05 }).select("id").single();
        if (e2 || !rel) { falhas++; console.log("erro relatório:", e2?.message); continue; }
        const linhas = [];
        for (const l of r.linhas) {
          const apol = l.documento.replace(/\s*\/\s*\d+$/, "").trim();
          let documentoId: string | null = null;
          const sid = segId.get(l.seg_abrev);
          if (sid && apol) {
            const { data: ds } = await sb.from("erp_documentos").select("id,numero_apolice").eq("seguradora_id", sid).or(`numero_apolice.eq.${apol},numero_apolice.like.%${apol}`).limit(3);
            if (ds && ds.length === 1) documentoId = ds[0].id;
          }
          linhas.push({ relatorio_id: rel.id, ...l, documento_id: documentoId });
        }
        if (linhas.length) { const { error: e3 } = await sb.from("erp_repasse_relatorios_corp_linhas").insert(linhas); if (e3) { falhas++; console.log("erro linhas:", e3.message); } }
      }
    }
  }
  console.log(JSON.stringify({ cargas, relatorios: rels, linhas: linhasTot, soma_confere_rodape: confere, nao_confere: semConferir, repetidas, falhas }));
})();
