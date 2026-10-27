import { createServiceClient } from "@/lib/supabase/service";
import JanelaEmails, { type AnexoDoEmail, type EmailDaConversa } from "./JanelaEmails";

// ERP O2 — botão "E-mails (n)" da ficha do documento (27/10/2026). A página só deve renderizar isto para a equipe O2
// (ela já confere isso). Lê erp_emails e erp_documento_anexos pelo documento (o mesmo para o Código O2 e para o nosso número
// do Corp); nada é copiado. Conversa = e-mails ligados ao documento + outras mensagens da mesma conversa (mesmo thread_id).
const LIMITE = 150;

export default async function EmailsDoDocumento({ documentoId, codigoO2 }: { documentoId: string; codigoO2: string }) {
  const sb = createServiceClient();
  const cols = "id,message_id,thread_id,data,de,para,assunto,trecho,tem_anexo";
  const [{ data: diretos }, { data: provas }] = await Promise.all([
    sb.from("erp_emails").select(cols).eq("documento_id", documentoId).limit(LIMITE),
    sb.from("erp_emails_evidencia_emissao").select("message_id").eq("documento_id", documentoId).limit(LIMITE),
  ]);
  const idsProva = new Set((provas ?? []).map((p) => p.message_id));
  const porProva = idsProva.size ? (await sb.from("erp_emails").select(cols).in("message_id", [...idsProva])).data ?? [] : [];
  const base = [...(diretos ?? []), ...porProva];
  const threads = [...new Set(base.map((m) => m.thread_id).filter((t): t is string => !!t))];
  const daConversa = threads.length ? (await sb.from("erp_emails").select(cols).in("thread_id", threads).limit(LIMITE * 2)).data ?? [] : [];

  const porMsg = new Map<string, (typeof base)[number]>();
  for (const m of [...base, ...daConversa]) porMsg.set(m.message_id, m);
  const emails: EmailDaConversa[] = [...porMsg.values()]
    .sort((a, b) => (a.data ?? "").localeCompare(b.data ?? ""))
    .slice(0, LIMITE)
    .map((m) => ({ id: m.id, data: m.data, de: m.de ?? "", para: m.para ?? "", assunto: m.assunto ?? "", trecho: m.trecho ?? "", tem_anexo: m.tem_anexo, prova: idsProva.has(m.message_id) }));

  const { data: anex } = await sb
    .from("erp_documento_anexos")
    .select("id,nome_arquivo,tipo,situacao,storage_path")
    .eq("documento_id", documentoId)
    .eq("origem", "email")
    .not("storage_path", "is", null);
  const caminhos = [...new Set((anex ?? []).map((a) => a.storage_path as string))];
  const { data: assinados } = caminhos.length ? await sb.storage.from("anexos-documentos").createSignedUrls(caminhos, 600) : { data: [] };
  const url = new Map((assinados ?? []).map((s) => [s.path, s.signedUrl]));
  const anexos: AnexoDoEmail[] = (anex ?? []).map((a) => ({ id: a.id, nome: a.nome_arquivo ?? "arquivo.pdf", tipo: a.tipo, situacao: a.situacao, url: url.get(a.storage_path as string) ?? null }));

  if (!emails.length && !anexos.length) return null;
  return <JanelaEmails codigoO2={codigoO2} emails={emails} anexos={anexos} />;
}
