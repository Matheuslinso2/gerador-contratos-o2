// Utilitários compartilhados pelos scripts de carga da Base Única de
// Imobiliárias (Fase 1). Rodam localmente com as credenciais do .env.local
// e gravam com service_role — por isso ficam fora do app.
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
dotenv.config({ path: path.join(RAIZ, ".env.local") });

export const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export const somenteDigitos = (v) => String(v ?? "").replace(/\D/g, "");

// Mesma ideia de src/lib/rankingImobiliarias.ts: tira acento, caixa,
// pontuação, o que está entre parênteses (ex.: "RAMIRO SÁ (848)") e as
// palavras que só dizem o tipo da empresa.
const GENERICAS = new Set(["LTDA", "ME", "EPP", "EIRELI", "SA", "S", "A", "DE", "DA", "DO", "DOS", "DAS", "E", "EM",
  "IMOVEIS", "IMOVEL", "IMOBILIARIA", "IMOB", "ADMINISTRACAO", "ADMINISTRADORA", "ADM", "CONSULTORIA", "SERVICOS",
  "CORRETORA", "CORRETOR", "GESTAO", "NEGOCIOS", "PARTICIPACOES", "CONDOMINIOS", "PJ", "PF", "BAS", "BASE", "SUPERLOGICA",
  "ANTIGO", "ANTIGA", "INATIVO", "INATIVA"]);
export const textoBase = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
  .replace(/\(.*?\)/g, " ").replace(/[^A-Z0-9&]+/g, " ").trim();
export const tokens = (v) => textoBase(v).split(" ").filter((t) => t && !GENERICAS.has(t));
export const chaveNome = (v) => tokens(v).join(" ");

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
export const extrairEmails = (v) => [...new Set((String(v ?? "").match(EMAIL_RE) || []).map((e) => e.toLowerCase()))]
  .filter((e) => !/^teste@|@teste\./.test(e));

// Busca todas as linhas de uma tabela (o Supabase devolve 1000 por vez).
export async function buscarTudo(tabela, colunas, filtro = (q) => q) {
  const out = [];
  for (let ini = 0; ; ini += 1000) {
    const { data, error } = await filtro(supabase.from(tabela).select(colunas)).range(ini, ini + 999);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

// Grava registros de fonte sem nunca desfazer decisão já tomada: se o
// registro já existe e está confirmado/rejeitado/ignorado, só atualiza os
// dados brutos (nome, dados, volume, anos), não o vínculo.
export async function gravarRegistros(registros) {
  const fontes = [...new Set(registros.map((r) => r.fonte))];
  const existentes = new Map();
  for (const fonte of fontes) {
    for (const r of await buscarTudo("imobiliaria_registros_fonte", "id, fonte, chave_externa, situacao", (q) => q.eq("fonte", fonte))) {
      existentes.set(`${r.fonte}|${r.chave_externa}`, r);
    }
  }
  const agora = new Date().toISOString();
  const linhas = registros.map((r) => {
    const ex = existentes.get(`${r.fonte}|${r.chave_externa}`);
    const travado = ex && ["confirmado", "rejeitado", "ignorar"].includes(ex.situacao);
    const base = { fonte: r.fonte, chave_externa: r.chave_externa, nome_original: r.nome_original ?? null,
      dados: r.dados ?? {}, volume: r.volume ?? 0, anos: r.anos ?? [], lido_em: agora, updated_at: agora };
    return travado ? base : { ...base, imobiliaria_id: null, situacao: "a_identificar", metodo_vinculo: null, sugestoes: [] };
  });
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await supabase.from("imobiliaria_registros_fonte").upsert(linhas.slice(i, i + 500), { onConflict: "fonte,chave_externa" });
    if (error) throw new Error("gravarRegistros: " + error.message);
  }
  return linhas.length;
}

// Bitrix (só leitura)
const BITRIX = (process.env.BITRIX_WEBHOOK_URL || "").replace(/\/?$/, "/");
export async function bitrix(metodo, params) {
  for (let tentativa = 0; ; tentativa++) {
    const r = await fetch(BITRIX + metodo + ".json", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) });
    const j = await r.json();
    if (j.error === "QUERY_LIMIT_EXCEEDED" && tentativa < 5) { await new Promise((s) => setTimeout(s, 1500)); continue; }
    if (j.error) throw new Error(`${metodo}: ${j.error_description || j.error}`);
    return j;
  }
}
export async function bitrixTodos(metodo, params, chaveLista) {
  const out = [];
  for (let start = 0; ; ) {
    const j = await bitrix(metodo, { ...params, start });
    out.push(...(chaveLista ? j.result[chaveLista] : j.result));
    if (j.next === undefined) return out;
    start = j.next;
  }
}
