import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { chamarBitrix } from "./client";
import { DOMINIO_O2 } from "@/lib/admin";

// Aba "Panorama" dentro do card do Seguro Fiança no Bitrix (16/10/2026).
// Dentro do iframe do Bitrix ninguém está logado no Workspace -- então a
// abertura da aba (bitrix-app/card-panorama) confere o token do Bitrix,
// descobre quem é o usuário e emite este passe curto (HMAC), amarrado ao
// card e ao e-mail da pessoa. Gerar versão, buscar contatos e enviar
// e-mail aceitam o passe no lugar da sessão do Workspace.

const DOMINIO_PORTAL = "o2seguros.bitrix24.com.br";
const VALIDADE_MS = 12 * 60 * 60 * 1000; // um expediente

type Passe = { cardId: number; email: string; exp: number };

function segredo(): string {
  // Reaproveita um segredo de servidor que já existe (nunca vai pro
  // navegador) com um prefixo próprio, pra não precisar de env nova.
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada");
  return `panorama-bitrix:${base}`;
}

const assinar = (dados: string) => createHmac("sha256", segredo()).update(dados).digest("base64url");

export function emitirPassePanorama(cardId: number, email: string): string {
  const dados = Buffer.from(JSON.stringify({ cardId, email, exp: Date.now() + VALIDADE_MS } satisfies Passe)).toString(
    "base64url"
  );
  return `${dados}.${assinar(dados)}`;
}

// Devolve o e-mail de quem abriu a aba, se o passe for válido pra esse card.
export function validarPassePanorama(passe: string | null | undefined, cardId: number): string | null {
  if (!passe) return null;
  const [dados, assinatura] = passe.split(".");
  if (!dados || !assinatura) return null;
  const esperada = Buffer.from(assinar(dados));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;
  try {
    const p = JSON.parse(Buffer.from(dados, "base64url").toString()) as Passe;
    if (p.cardId !== cardId || p.exp < Date.now() || !p.email.endsWith(DOMINIO_O2)) return null;
    return p.email;
  } catch {
    return null;
  }
}

// Confere o AUTH_ID que o Bitrix manda ao abrir a aba e devolve o e-mail do
// usuário (só equipe @o2seguros). null = token inválido ou usuário de fora.
export async function emailDoUsuarioBitrix(authId: string): Promise<string | null> {
  try {
    const resp = await fetch(`https://${DOMINIO_PORTAL}/rest/profile.json`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auth: authId }),
      signal: AbortSignal.timeout(10_000),
    });
    const dados = await resp.json();
    const id = Number(dados?.result?.ID);
    if (!resp.ok || dados.error || !id) return null;
    // profile não traz e-mail -- busca pelo webhook de usuários.
    const usuarios = await chamarBitrix<{ result: { EMAIL?: string }[] }>(
      "user.get",
      { "FILTER[ID]": [id] },
      "BITRIX_WEBHOOK_URL_USUARIOS"
    );
    const email = usuarios.result[0]?.EMAIL?.trim().toLowerCase();
    return email && email.endsWith(DOMINIO_O2) ? email : null;
  } catch {
    return null;
  }
}

// Passe genérico para outras abas do card (ex.: "Apólice-mãe", 28/10/2026):
// amarrado a uma chave (aba + entidade + card) em vez de só ao id do card,
// porque o mesmo id existe em paralelo em cada SPA.
export function emitirPasseCard(chave: string, email: string): string {
  const dados = Buffer.from(JSON.stringify({ chave, email, exp: Date.now() + VALIDADE_MS })).toString("base64url");
  return `${dados}.${assinar(dados)}`;
}

export function validarPasseCard(passe: string | null | undefined, chave: string): string | null {
  if (!passe) return null;
  const [dados, assinatura] = passe.split(".");
  if (!dados || !assinatura) return null;
  const esperada = Buffer.from(assinar(dados));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;
  try {
    const p = JSON.parse(Buffer.from(dados, "base64url").toString()) as { chave: string; email: string; exp: number };
    if (p.chave !== chave || p.exp < Date.now() || !p.email.endsWith(DOMINIO_O2)) return null;
    return p.email;
  } catch {
    return null;
  }
}
