// Propostas pendentes (situacao='proposta', sem nº de apólice): procura nas 34 caixas O2 PDFs enviados por seguradoras
// (apólice, endosso, cotação, proposta) e liga ao documento quando o PDF o confirma. SÓ LEITURA do Gmail. uso:
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/anexos-seguradoras.ts [--meses 30] [--caixas a@...] [--paralelo 4] [--gravar]
// Sem --gravar é ensaio. Aqui só vale 'confirmada' (CPF/CNPJ do documento + nº ou início da vigência no PDF): CPF sozinho
// ligaria o PDF ao documento errado de quem tem várias apólices. Retomável: erp_emails_progresso, lotes "segpdf:AAAA-MM".
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { CAIXAS_O2, lerAnexosPdf, lerCaixa } from "@/lib/erp/emails";
import { avaliar, carregarDocs, documentosNoTexto, guardarAnexo, textoDoPdf, tipoDoPdf, type DocAlvo } from "@/lib/erp/anexosEmail";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const GRAVAR = process.argv.includes("--gravar");
const MESES = Number(arg("meses") ?? 30);
const PARALELO = Number(arg("paralelo") ?? 4);
const caixas = (arg("caixas")?.split(",") ?? CAIXAS_O2).filter((c) => CAIXAS_O2.includes(c));
const sb = createServiceClient();
const SEGURADORAS = "tokiomarine.com.br OR portoseguro.com.br OR suhaiseguradora.com OR pottencial.com.br OR alfaseg.com.br OR yelum.com.br OR libertyseguros.com.br OR tooseguros.com.br OR hdi.com.br OR sompo.com.br OR brasilcap.com.br OR sulamerica.com.br OR mapfre.com.br OR bradesco.com.br";
const PALAVRAS = "apólice OR apolice OR endosso OR emitida OR emitido OR proposta OR cotação OR cotacao OR certificado";

function janelas() {
  const hoje = new Date();
  const saida: { chave: string; apos: string; antes: string }[] = [];
  for (let i = MESES; i >= 0; i--) {
    const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - i, 1));
    const p = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const f = (x: Date) => `${x.getUTCFullYear()}/${String(x.getUTCMonth() + 1).padStart(2, "0")}/01`;
    saida.push({ chave: `segpdf:${d.toISOString().slice(0, 7)}`, apos: f(d), antes: f(p) });
  }
  return saida;
}

(async () => {
  // alvos: propostas pendentes; índice CPF/CNPJ -> documentos
  const ids: string[] = [];
  for (let de = 0; ; de += 1000) {
    const { data } = await sb.from("erp_documentos").select("id").eq("situacao", "proposta").is("numero_apolice", null).order("id").range(de, de + 999);
    ids.push(...(data ?? []).map((d) => d.id));
    if ((data ?? []).length < 1000) break;
  }
  const docs = await carregarDocs(sb, ids);
  const porCpf = new Map<string, DocAlvo[]>();
  for (const d of docs.values()) for (const c of new Set(d.cpfs)) (porCpf.get(c) ?? porCpf.set(c, []).get(c)!).push(d);
  // Porto protege o PDF com os 4 primeiros dígitos do CPF/CNPJ do segurado: testa os prefixos dos alvos
  const prefixos4 = [...new Set([...porCpf.keys()].map((c) => c.slice(0, 4)))];
  const jan = janelas();
  const { data: feitosL } = await sb.from("erp_emails_progresso").select("caixa,lote").like("lote", "segpdf:%");
  const feitos = new Set((feitosL ?? []).map((l) => `${l.caixa}|${l.lote}`));
  const pares = caixas.flatMap((c) => jan.filter((j) => !feitos.has(`${c}|${j.chave}`)).map((j) => ({ c, j })));
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"}: ${docs.size} alvos (${porCpf.size} CPFs/CNPJs), ${pares.length} pares caixa x mês`);
  const r = { mensagens: 0, pdfs: 0, ligados: 0, docsLigados: 0, semTexto: 0, semCandidato: 0, erros: 0 };
  const ligadosDocs = new Set<string>();
  const amostra: string[] = [];
  const fila = [...pares];
  let feito = 0;
  const trabalhador = async () => {
    for (let p = fila.shift(); p; p = fila.shift()) {
      try {
        const busca = `from:(${SEGURADORAS}) has:attachment filename:pdf (${PALAVRAS}) after:${p.j.apos} before:${p.j.antes}`;
        const { mensagens } = await lerCaixa(p.c, busca, 2000);
        r.mensagens += mensagens.length;
        for (const m of mensagens) {
          const pdfs = await lerAnexosPdf(p.c, m.message_id);
          for (const a of pdfs) {
            r.pdfs++;
            const { t } = await textoDoPdf(a.buffer, prefixos4, [(d) => d]);
            if (!t || t.length < 50) { r.semTexto++; continue; }
            const cands = new Map<string, DocAlvo>();
            for (const cpf of documentosNoTexto(t)) for (const d of porCpf.get(cpf) ?? []) cands.set(d.id, d);
            let ligou = false;
            for (const d of cands.values()) {
              const av = avaliar(t, d, true);
              if (!av) continue;
              ligou = true;
              r.ligados++;
              ligadosDocs.add(d.id);
              const tipo = tipoDoPdf(t, a.nome);
              if (amostra.length < 15) amostra.push(`${tipo.padEnd(8)} cod.O2 ${d.nosso_numero}  ${a.nome.slice(0, 40)}  [nº:${av.num ? "s" : "n"} vig:${av.vig ? "s" : "n"}]  ${m.assunto.slice(0, 50)}`);
              if (GRAVAR) await guardarAnexo(sb, { doc: d, pdf: a.buffer, nome: a.nome, messageId: m.message_id, tipo, av, extra: { fonte: "seguradora" } });
            }
            if (!ligou) r.semCandidato++;
          }
        }
        if (GRAVAR) await sb.from("erp_emails_progresso").upsert({ caixa: p.c, lote: p.j.chave, dias: MESES * 30, lidos: mensagens.length, truncado: false }, { onConflict: "caixa,lote" });
      } catch (e) { r.erros++; console.log("erro:", p.c, p.j.chave, (e as Error).message.slice(0, 100)); }
      if (++feito % 50 === 0) console.log(`${feito}/${pares.length} pares, ${r.pdfs} PDFs, ${ligadosDocs.size} documentos ligados`);
    }
  };
  await Promise.all(Array.from({ length: PARALELO }, trabalhador));
  r.docsLigados = ligadosDocs.size;
  console.log(JSON.stringify(r));
  console.log(amostra.join("\n"));
})();
