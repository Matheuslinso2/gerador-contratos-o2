import "server-only";

import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { enviarEmail } from "@/lib/email";

// Login verificado de imobiliária (04/11/2026) -- ver supabase/schema_convites_imobiliaria.sql.
// Convite da O2 (link, 7 dias) + código de 6 números no mesmo e-mail (15 min, 5 tentativas) + senha nova.
// Só o hash do token e do código fica no banco.

export const DIAS_VALIDADE_CONVITE = 7;
const MINUTOS_VALIDADE_CODIGO = 15;
const MAX_TENTATIVAS_CODIGO = 5;

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const hashCodigo = (tokenHash: string, codigo: string) => sha(`${tokenHash}:${codigo}`);
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Resultado = { ok: true } | { ok: false; erro: string };

function emailConvite(titulo: string, corpo: string) {
  return `<div style="max-width:560px;margin:0 auto;font-family:Arial,sans-serif;">
    <div style="background:#01192e;padding:16px 20px;border-radius:10px 10px 0 0;"><span style="color:#fff;font-size:18px;font-weight:bold;">O2 Seguros</span></div>
    <div style="border:1px solid #d9d9d9;border-top:none;padding:20px;border-radius:0 0 10px 10px;color:#01192e;font-size:14px;line-height:1.5;">
      <h2 style="margin:0 0 12px;font-size:18px;">${titulo}</h2>${corpo}
    </div></div>`;
}

// Convite da equipe O2 (primeiro acesso da imobiliária) ou do usuário MASTER da imobiliária (o titular da ficha convida os colaboradores
// dele: mesmo processo -- link, código no e-mail e senha --, e o convidado fica vinculado à ficha e a todas as fichas do master).
export async function criarEEnviarConvite(opts: {
  imobiliariaId: string;
  email: string;
  enviadoPor: string;
  origem: string;
  fichasExtras?: string[];
  convidante?: { userId: string; email: string };
}): Promise<Resultado> {
  const email = opts.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, erro: "E-mail inválido." };
  const sb = createServiceClient();
  const { data: imob } = await sb.from("imobiliarias").select("id, nome").eq("id", opts.imobiliariaId).maybeSingle();
  if (!imob) return { ok: false, erro: "Imobiliária não encontrada." };

  // Reenvio invalida o convite anterior ainda não usado para o mesmo e-mail.
  await sb.from("imobiliaria_convites").delete().eq("imobiliaria_id", imob.id).eq("email", email).is("usado_em", null);

  const token = crypto.randomBytes(32).toString("base64url");
  const expira = new Date(Date.now() + DIAS_VALIDADE_CONVITE * 24 * 3600 * 1000);
  const { data: linha, error } = await sb
    .from("imobiliaria_convites")
    .insert({
      imobiliaria_id: imob.id,
      imobiliaria_ids: [...new Set([imob.id, ...(opts.fichasExtras ?? [])])],
      convidado_por_user: opts.convidante?.userId ?? null,
      email,
      token_hash: sha(token),
      expira_em: expira.toISOString(),
      enviado_por: opts.enviadoPor.toLowerCase(),
    })
    .select("id")
    .single();
  if (error || !linha) return { ok: false, erro: error?.message ?? "Não foi possível criar o convite." };

  const link = `${opts.origem}/convite/${token}`;
  try {
    await enviarEmail({
      para: email,
      assunto: `Convite para o Workspace O2 — ${imob.nome}`,
      throwSeFalhar: true,
      html: emailConvite(
        "Você foi convidado para o Workspace O2",
        `${
          opts.convidante
            ? `<p><strong>${esc(opts.convidante.email)}</strong> convidou você para acessar o Workspace O2 da <strong>${esc(imob.nome)}</strong>.</p>`
            : `<p>A O2 Seguros liberou o acesso da <strong>${esc(imob.nome)}</strong> ao Workspace O2.</p>`
        }
         <p>Para criar sua senha e fazer o primeiro acesso, clique no botão abaixo. Por segurança, você vai receber um código de 6 números neste mesmo e-mail para confirmar.</p>
         <p style="margin:20px 0;"><a href="${link}" style="background:#F8540D;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold;">Criar minha senha</a></p>
         <p style="font-size:12px;color:#8d8683;">O convite vale por ${DIAS_VALIDADE_CONVITE} dias. Se você não esperava este e-mail, pode ignorá-lo.</p>`
      ),
    });
  } catch (e) {
    await sb.from("imobiliaria_convites").delete().eq("id", linha.id);
    return { ok: false, erro: `Não consegui enviar o e-mail: ${(e as Error).message}` };
  }
  return { ok: true };
}

export type ConviteValido = {
  id: string;
  email: string;
  imobiliariaId: string;
  imobiliariaNome: string;
  tokenHash: string;
  codigoEnviado: boolean;
  fichas: string[];
  porMaster: boolean;
};

export async function lerConvite(token: string): Promise<{ convite: ConviteValido } | { erro: string }> {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return { erro: "Convite inválido." };
  const sb = createServiceClient();
  const { data: c } = await sb.from("imobiliaria_convites").select("*").eq("token_hash", sha(token)).maybeSingle();
  if (!c) return { erro: "Convite inválido ou já substituído por um mais novo." };
  if (c.usado_em) return { erro: "Este convite já foi usado. Entre com seu e-mail e senha." };
  if (new Date(c.expira_em).getTime() < Date.now()) return { erro: "Este convite venceu. Peça à O2 um novo convite." };
  const { data: imob } = await sb.from("imobiliarias").select("nome").eq("id", c.imobiliaria_id).maybeSingle();
  return {
    convite: {
      id: c.id,
      email: c.email,
      imobiliariaId: c.imobiliaria_id,
      imobiliariaNome: imob?.nome ?? "sua imobiliária",
      tokenHash: c.token_hash,
      codigoEnviado: !!c.codigo_hash && !!c.codigo_expira_em && new Date(c.codigo_expira_em).getTime() > Date.now(),
      fichas: (c.imobiliaria_ids as string[] | null)?.length ? (c.imobiliaria_ids as string[]) : [c.imobiliaria_id],
      porMaster: !!c.convidado_por_user,
    },
  };
}

export async function enviarCodigoDoConvite(token: string): Promise<Resultado> {
  const r = await lerConvite(token);
  if ("erro" in r) return { ok: false, erro: r.erro };
  const sb = createServiceClient();
  const { data: c } = await sb.from("imobiliaria_convites").select("codigo_expira_em").eq("id", r.convite.id).single();
  // Espera 60 s entre envios (evita disparar e-mail em sequência).
  if (c?.codigo_expira_em && new Date(c.codigo_expira_em).getTime() - (MINUTOS_VALIDADE_CODIGO - 1) * 60000 > Date.now()) {
    return { ok: false, erro: "Aguarde um minuto para pedir outro código." };
  }
  const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await sb
    .from("imobiliaria_convites")
    .update({ codigo_hash: hashCodigo(r.convite.tokenHash, codigo), codigo_expira_em: new Date(Date.now() + MINUTOS_VALIDADE_CODIGO * 60000).toISOString(), tentativas_codigo: 0 })
    .eq("id", r.convite.id);
  try {
    await enviarEmail({
      para: r.convite.email,
      assunto: `Seu código de verificação: ${codigo}`,
      throwSeFalhar: true,
      html: emailConvite(
        "Código de verificação",
        `<p>Digite este código na tela de criação de senha:</p>
         <p style="font-size:30px;letter-spacing:8px;font-weight:bold;margin:16px 0;">${codigo}</p>
         <p style="font-size:12px;color:#8d8683;">O código vale por ${MINUTOS_VALIDADE_CODIGO} minutos. Nunca o informe a ninguém — a O2 não pede esse código por telefone ou WhatsApp.</p>`
      ),
    });
  } catch (e) {
    return { ok: false, erro: `Não consegui enviar o código: ${(e as Error).message}` };
  }
  return { ok: true };
}

export async function concluirConvite(opts: { token: string; codigo: string; senha: string }): Promise<{ ok: true; email: string; contaExistente: boolean } | { ok: false; erro: string }> {
  const r = await lerConvite(opts.token);
  if ("erro" in r) return { ok: false, erro: r.erro };
  const { convite } = r;
  if (opts.senha.length < 8) return { ok: false, erro: "A senha precisa ter pelo menos 8 caracteres." };

  const sb = createServiceClient();
  const { data: c } = await sb.from("imobiliaria_convites").select("codigo_hash, codigo_expira_em, tentativas_codigo").eq("id", convite.id).single();
  if (!c?.codigo_hash || !c.codigo_expira_em || new Date(c.codigo_expira_em).getTime() < Date.now()) {
    return { ok: false, erro: "O código venceu ou ainda não foi enviado. Peça um novo código." };
  }
  if (c.tentativas_codigo >= MAX_TENTATIVAS_CODIGO) return { ok: false, erro: "Muitas tentativas erradas. Peça um novo código." };
  await sb.from("imobiliaria_convites").update({ tentativas_codigo: c.tentativas_codigo + 1 }).eq("id", convite.id);
  const informado = Buffer.from(hashCodigo(convite.tokenHash, opts.codigo.replace(/\D/g, "")));
  const esperado = Buffer.from(c.codigo_hash);
  if (informado.length !== esperado.length || !crypto.timingSafeEqual(informado, esperado)) {
    return { ok: false, erro: "Código incorreto. Confira o e-mail e tente de novo." };
  }

  // A pessoa provou ser dona do e-mail (código). Se já tem conta no Workspace, só ganha o acesso à ficha; senão a conta nasce agora.
  let contaExistente = false;
  let userId: string | null = null;
  const { data: criado, error } = await sb.auth.admin.createUser({ email: convite.email, password: opts.senha, email_confirm: true });
  if (criado?.user) userId = criado.user.id;
  else if (/already|registered|exists/i.test(error?.message ?? "")) contaExistente = true;
  else if (/weak|known to be/i.test(error?.message ?? "")) return { ok: false, erro: "Essa senha já apareceu em vazamentos na internet. Escolha outra." };
  else return { ok: false, erro: "Não foi possível criar sua conta agora. Tente novamente em instantes." };

  // Vínculo com a(s) ficha(s): titular (master) só no convite da O2 e em ficha ainda sem login; nos demais casos entra como colaborador (membro).
  for (const [indice, fichaId] of convite.fichas.entries()) {
    const { data: ficha } = await sb.from("imobiliarias").select("id, user_id").eq("id", fichaId).maybeSingle();
    if (!ficha) continue;
    if (!convite.porMaster && userId && !ficha.user_id && indice === 0) {
      await sb.from("imobiliarias").update({ user_id: userId, email: convite.email, autorizado: true, autorizado_em: new Date().toISOString() }).eq("id", ficha.id);
    } else {
      const { data: ja } = await sb.from("imobiliaria_membros").select("id").eq("imobiliaria_id", fichaId).eq("email", convite.email).maybeSingle();
      if (!ja) await sb.from("imobiliaria_membros").insert({ imobiliaria_id: fichaId, email: convite.email });
    }
  }
  await sb.from("imobiliaria_convites").update({ usado_em: new Date().toISOString(), codigo_hash: null }).eq("id", convite.id);
  return { ok: true, email: convite.email, contaExistente };
}
