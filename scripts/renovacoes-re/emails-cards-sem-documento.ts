// Só leitura: para os cards de renovação que não ligam a nenhum documento do ERP, procura nos e-mails já indexados (erp_emails) o que aconteceu.
// Saída: renovacoes-re/corp-2027-01/cards-sem-documento-emails.csv (contém nomes de clientes; não enviar a terceiros).
process.loadEnvFile(".env.local");
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { casarCardsComDocumentos, lerCardsRenovacao, lerDocumentosParaLigar } from "@/lib/erp/renovacaoCards";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const norm = (t: string) => (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const PALAVRAS = /CANCEL|RENOV|EMISS|APOLICE|ENDOSSO|RECUS|PROPOSTA|NAO RENOV|VENCIMENTO|PERDA/;
(async () => {
  const cards = await lerCardsRenovacao(); const docs = await lerDocumentosParaLigar(sb);
  const { cardsSemDocumento: s } = casarCardsComDocumentos(cards, docs);
  const linhas: string[] = ["Funil;Card;Etapa;Título;Vigência anterior;Termos buscados;E-mails achados;Data do mais recente;Assuntos relevantes (até 4)"];
  for (const c of s) {
    const partes = c.titulo.replace(/^RENOVA[^-]*-\s*/i, "").replace(/\s*-\s*\d{2}\.\d{4}.*$/, "").split(/\s+-\s+/).map((p) => p.trim()).filter((p) => p.length >= 5 && !/^(TOKIO|YELL?UM|PORTO|ALLIANZ|SEM PARCERIA)$/i.test(p));
    const termos = [...new Set([...partes.map((p) => norm(p).replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim()).filter((p) => p.length >= 6), ...c.apolices.map((a) => a.replace(/\D/g, "").slice(-8)).filter((a) => a.length >= 7)])].slice(0, 3);
    const achados = new Map<string, { data: string; assunto: string }>();
    for (const t of termos) {
      const { data } = await sb.from("erp_emails").select("message_id,assunto,data").or(`assunto.ilike.%${t}%,trecho.ilike.%${t}%`).order("data", { ascending: false }).limit(40);
      for (const e of data ?? []) achados.set(e.message_id, { data: String(e.data).slice(0, 10), assunto: String(e.assunto ?? "") });
    }
    const lista = [...achados.values()].sort((a, b) => b.data.localeCompare(a.data));
    const relev = lista.filter((e) => PALAVRAS.test(norm(e.assunto))).slice(0, 4).map((e) => `${e.data} ${e.assunto.slice(0, 90)}`);
    linhas.push([c.funil, c.id, c.etapa.split(":")[1], c.titulo, c.fim ?? "", termos.join(" / "), lista.length, lista[0]?.data ?? "", relev.join(" || ")].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(";"));
    console.log(c.id, c.etapa.split(":")[1], c.titulo.slice(0, 45), "| e-mails:", lista.length, "|", relev[0] ?? "(nenhum assunto de renovação/emissão/cancelamento)");
  }
  fs.writeFileSync("../renovacoes-re/corp-2027-01/cards-sem-documento-emails.csv", "\ufeff" + linhas.join("\r\n"));
})();
