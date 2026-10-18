import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { obterClienteGmail, REMETENTES_EXCLUIDOS } from "@/lib/gestaoEmails/gmail";

// Fonte `email` da Base Única de Imobiliárias: endereços que aparecem no
// e-mail do Matheus (De/Para/Cc — só cabeçalho, nunca o corpo), para
// descobrir e confirmar contatos de cada imobiliária.
//
// Regras combinadas com o Matheus (2026-10-16):
// - no máximo os últimos 30 dias; um dia FECHADO por execução, marcado em
//   `base_unica_emails_dias` para nunca reler;
// - e-mail pessoal (gmail, hotmail…) só entra se já for um endereço
//   conhecido de alguma imobiliária — o resto pode ser locatário, e dado de
//   locatário só existe no cofre `locatarios`.

export const JANELA_DIAS = 30;
const TAMANHO_LOTE = 8;

const PROVEDORES_PESSOAIS = new Set([
  "gmail.com", "hotmail.com", "outlook.com", "live.com", "yahoo.com", "yahoo.com.br", "icloud.com",
  "uol.com.br", "bol.com.br", "terra.com.br", "ig.com.br", "globo.com", "globomail.com", "msn.com", "me.com",
]);
const DOMINIOS_INTERNOS = /(^|\.)(o2seguros\.com\.br|o2grupo\.com\.br)$/;

const EMAIL_RE = /([^<>,"]*?)\s*<?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>?/g;

type Contato = { nome: string | null; qtd: number };

function extrairEnderecos(cabecalho: string): { email: string; nome: string | null }[] {
  const out: { email: string; nome: string | null }[] = [];
  for (const m of cabecalho.matchAll(EMAIL_RE)) {
    const nome = m[1].replace(/^[\s,]+|["\s]+$/g, "").replace(/^"/, "").trim();
    out.push({ email: m[2].toLowerCase(), nome: nome || null });
  }
  return out;
}

function excluido(email: string): boolean {
  const dominio = email.split("@")[1] || "";
  if (DOMINIOS_INTERNOS.test(dominio)) return true;
  return REMETENTES_EXCLUIDOS.some((r) => (r.includes("@") ? email === r : dominio === r || dominio.endsWith("." + r)));
}

// Próximo dia fechado ainda não lido dentro da janela (mais recente primeiro).
export async function proximoDiaPendente(supabase: SupabaseClient, hoje = new Date()): Promise<string | null> {
  const { data } = await supabase.from("base_unica_emails_dias").select("dia");
  const feitos = new Set((data || []).map((d) => d.dia as string));
  for (let i = 1; i <= JANELA_DIAS; i++) {
    const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() - i));
    const dia = d.toISOString().slice(0, 10);
    if (!feitos.has(dia)) return dia;
  }
  return null;
}

async function enderecosConhecidos(supabase: SupabaseClient): Promise<Set<string>> {
  const conhecidos = new Set<string>();
  const { data: imobs } = await supabase.from("imobiliarias").select("email, email_faturas, email_repasses, email_campanhas");
  for (const i of imobs || []) {
    for (const e of [i.email, ...(i.email_faturas || []), ...(i.email_repasses || []), ...(i.email_campanhas || [])]) {
      if (e) conhecidos.add(String(e).trim().toLowerCase());
    }
  }
  for (let ini = 0; ; ini += 1000) {
    const { data } = await supabase.from("imobiliaria_registros_fonte").select("dados")
      .in("fonte", ["bitrix_empresa", "corp_produtor"]).range(ini, ini + 999);
    for (const r of data || []) for (const e of (r.dados as { emails?: string[] })?.emails || []) conhecidos.add(e);
    if (!data || data.length < 1000) break;
  }
  return conhecidos;
}

// Lê um dia inteiro (UTC) e grava/atualiza os registros de fonte `email`.
export async function processarDia(supabase: SupabaseClient, dia: string, prazoMs: number) {
  const inicio = Date.now();
  const api = obterClienteGmail();
  const depois = new Date(`${dia}T00:00:00Z`).getTime() / 1000;
  const query = `after:${depois} before:${depois + 86400} -category:promotions -category:social`;

  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const r = await api.users.messages.list({ userId: "me", q: query, maxResults: 500, pageToken, includeSpamTrash: false });
    ids.push(...(r.data.messages || []).map((m) => m.id!).filter(Boolean));
    pageToken = r.data.nextPageToken || undefined;
  } while (pageToken);

  const contatos = new Map<string, Contato>();
  for (let i = 0; i < ids.length; i += TAMANHO_LOTE) {
    if (Date.now() - inicio > prazoMs) return { dia, concluido: false, mensagens: ids.length, enderecos: 0 };
    const respostas = await Promise.all(ids.slice(i, i + TAMANHO_LOTE).map((id) =>
      api.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["From", "To", "Cc"] })));
    for (const r of respostas) {
      for (const h of r.data.payload?.headers || []) {
        for (const { email, nome } of extrairEnderecos(h.value || "")) {
          if (excluido(email)) continue;
          const c = contatos.get(email) || { nome: null, qtd: 0 };
          c.qtd++;
          if (!c.nome && nome) c.nome = nome;
          contatos.set(email, c);
        }
      }
    }
  }

  const conhecidos = await enderecosConhecidos(supabase);
  const aceitos = [...contatos].filter(([email]) => !PROVEDORES_PESSOAIS.has(email.split("@")[1]) || conhecidos.has(email));

  // Acumula com o que já existe (volume soma, anos/últimos dias atualizam);
  // nunca mexe no vínculo já decidido.
  const chaves = aceitos.map(([e]) => e);
  const existentes = new Map<string, { volume: number; dados: Record<string, unknown>; anos: number[] }>();
  for (let i = 0; i < chaves.length; i += 200) {
    const { data } = await supabase.from("imobiliaria_registros_fonte").select("chave_externa, volume, dados, anos")
      .eq("fonte", "email").in("chave_externa", chaves.slice(i, i + 200));
    for (const r of data || []) existentes.set(r.chave_externa, r);
  }
  const ano = Number(dia.slice(0, 4));
  const agora = new Date().toISOString();
  const linhas = aceitos.map(([email, c]) => {
    const ex = existentes.get(email);
    const dados = (ex?.dados || {}) as { nome_exibido?: string | null; primeiro_dia?: string; ultimo_dia?: string };
    return {
      fonte: "email", chave_externa: email, nome_original: dados.nome_exibido || c.nome || email,
      volume: (ex?.volume || 0) + c.qtd,
      anos: [...new Set([...(ex?.anos || []), ano])].sort(),
      dados: {
        nome_exibido: dados.nome_exibido || c.nome, dominio: email.split("@")[1],
        primeiro_dia: dados.primeiro_dia && dados.primeiro_dia < dia ? dados.primeiro_dia : dia,
        ultimo_dia: dados.ultimo_dia && dados.ultimo_dia > dia ? dados.ultimo_dia : dia,
      },
      lido_em: agora, updated_at: agora,
    };
  });
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await supabase.from("imobiliaria_registros_fonte").upsert(linhas.slice(i, i + 500), { onConflict: "fonte,chave_externa" });
    if (error) throw new Error(`registros email: ${error.message}`);
  }
  await supabase.from("base_unica_emails_dias").upsert({ dia, mensagens: ids.length, enderecos: linhas.length, processado_em: agora });
  return { dia, concluido: true, mensagens: ids.length, enderecos: linhas.length };
}
