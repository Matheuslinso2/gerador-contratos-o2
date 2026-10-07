import "server-only";

// Envio pela API oficial do WhatsApp (Cloud API da Meta), mesmo app
// "Workspace O2" do Instagram. Em 06/10/2026 o app está em modo de teste:
// o remetente é o número de teste da Meta (+1 555 180-0364) e só recebe
// quem estiver cadastrado na lista de destinatários do painel da Meta
// (máx. 5). Mensagem iniciada pela plataforma tem que ser um modelo
// aprovado -- ver MODELO_WHATSAPP em lib/relatorioDiario/montar.ts.
//
// Variáveis no Vercel:
//   WHATSAPP_TOKEN            token PERMANENTE de Usuário do Sistema (o do
//                             botão "Gerar token" da tela de teste expira em ~24h)
//   WHATSAPP_PHONE_NUMBER_ID  "Phone Number ID" do número remetente

const VERSAO_API = "v25.0";

export async function enviarModeloWhatsApp(
  para: string,
  modelo: { nome: string; idioma: string },
  parametros: string[]
): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return { ok: false, erro: "WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID não configuradas" };

  const resposta = await fetch(`https://graph.facebook.com/${VERSAO_API}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: para.replace(/\D/g, ""),
      type: "template",
      template: {
        name: modelo.nome,
        language: { code: modelo.idioma },
        components: [{ type: "body", parameters: parametros.map((text) => ({ type: "text", text })) }],
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    return { ok: false, erro: dados?.error?.message ?? `HTTP ${resposta.status}` };
  }
  return { ok: true, id: dados?.messages?.[0]?.id ?? "" };
}

// WHATSAPP_RELATORIO_DESTINATARIOS = números separados por vírgula, com
// DDI (ex: "5521999990000,5521988880000"). O primeiro é o do Matheus --
// é pra ele que vai o envio de teste da prévia.
export function destinatariosRelatorio(): string[] {
  return (process.env.WHATSAPP_RELATORIO_DESTINATARIOS ?? "")
    .split(",")
    .map((n) => n.replace(/\D/g, ""))
    .filter(Boolean);
}

// Resposta em texto livre -- só vale dentro da janela de 24h aberta quando
// a PESSOA manda mensagem (fora dela a Meta exige modelo aprovado). Usada
// pela IA que responde perguntas (ver app/api/whatsapp/webhook).
export async function enviarTextoWhatsApp(para: string, texto: string): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return { ok: false, erro: "WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID não configuradas" };

  const resposta = await fetch(`https://graph.facebook.com/${VERSAO_API}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: para.replace(/\D/g, ""),
      type: "text",
      // Limite da Meta é 4096 caracteres por mensagem de texto.
      text: { body: texto.slice(0, 4096), preview_url: false },
    }),
    signal: AbortSignal.timeout(15000),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) return { ok: false, erro: dados?.error?.message ?? `HTTP ${resposta.status}` };
  return { ok: true, id: dados?.messages?.[0]?.id ?? "" };
}

// Celular brasileiro pode chegar da Meta SEM o 9 depois do DDD (wa_id de
// contas antigas, ex: 552188887777 em vez de 5521988887777) -- compara
// sempre na forma sem o 9 pra não barrar um sócio autorizado.
function formaCanonica(numero: string): string {
  const n = numero.replace(/\D/g, "");
  return n.length === 13 && n.startsWith("55") && n[4] === "9" ? n.slice(0, 4) + n.slice(5) : n;
}

// Só quem está na lista do relatório (WHATSAPP_RELATORIO_DESTINATARIOS)
// pode perguntar -- os dados são internos da O2.
export function numeroAutorizado(waId: string): boolean {
  const alvo = formaCanonica(waId);
  return destinatariosRelatorio().some((n) => formaCanonica(n) === alvo);
}
