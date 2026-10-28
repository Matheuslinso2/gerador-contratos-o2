import type { SupabaseClient } from "@supabase/supabase-js";

// ERP O2 — cadastro de clientes (Matheus 27/10/2026), como o menu de Clientes do Corp: todo titular, segurado, proprietário,
// inquilino ou garantido, de qualquer produto, precisa existir no cadastro (tabela locatarios, compartilhada com o Workspace de
// contratos) e ficar ligado ao documento; se o CPF/CNPJ não existe, é criado. Regras do cadastro:
//  • sempre CPF ou CNPJ válidos (nunca criado por semelhança de nome);
//  • sempre e-mail OU telefone (cadastro antigo sem contato fica como "incompleto" até ser completado);
//  • cada cliente tem um código único e permanente, CLI-000001 (locatarios.codigo_cliente), para identificar e unificar sem duplicar.

export const digitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

export const codigoCliente = (n: number | null | undefined) => (n ? `CLI-${String(n).padStart(6, "0")}` : "—");

/** Aceita "CLI-000123", "cli 123" ou "123" e devolve o número do código (ou null). */
export function numeroDoCodigo(texto: string): number | null {
  const m = texto.trim().match(/^(?:cli[-\s]?)?0*(\d{1,9})$/i);
  return m ? Number(m[1]) : null;
}

function cpfValido(d: string) {
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (base: string, peso: number) => {
    const soma = [...base].reduce((s, c, i) => s + Number(c) * (peso - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(d.slice(0, 9), 10) === Number(d[9]) && dv(d.slice(0, 10), 11) === Number(d[10]);
}

function cnpjValido(d: string) {
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = [...base].reduce((s, c, i) => s + Number(c) * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(d.slice(0, 12)) === Number(d[12]) && dv(d.slice(0, 13)) === Number(d[13]);
}

/** 'cpf' | 'cnpj' quando o documento é válido (dígitos verificadores), senão null. */
export function tipoDoDocumento(doc: string | null | undefined): "cpf" | "cnpj" | null {
  const d = digitos(doc);
  if (cpfValido(d)) return "cpf";
  if (cnpjValido(d)) return "cnpj";
  return null;
}

export function formatarDocumento(doc: string | null | undefined) {
  const d = digitos(doc);
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  return doc ?? "—";
}

export type DadosCliente = { nome: string; documento: string; email?: string | null; telefone?: string | null };

/** Erros do cadastro novo (regra do Matheus: CPF/CNPJ e e-mail ou telefone, sempre). Lista vazia = ok. */
export function validarCadastro(d: DadosCliente): string[] {
  const erros: string[] = [];
  if (!d.nome.trim() || d.nome.trim().length < 3) erros.push("Informe o nome completo ou a razão social.");
  if (!tipoDoDocumento(d.documento)) erros.push("Informe um CPF ou CNPJ válido.");
  const email = (d.email ?? "").trim();
  const tel = digitos(d.telefone);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  if (!emailOk && tel.length < 10) erros.push("Informe um e-mail válido ou um telefone com DDD.");
  if (email && !emailOk) erros.push("O e-mail informado não parece válido.");
  return erros;
}

/** Cadastro incompleto = sem CPF/CNPJ, ou sem e-mail e sem telefone. */
export const cadastroIncompleto = (c: { cpf: string | null; email: string | null; telefone: string | null }) =>
  !tipoDoDocumento(c.cpf) || (!(c.email ?? "").trim() && !(c.telefone ?? "").trim());

/**
 * Garante que a pessoa existe no cadastro (cria se o CPF/CNPJ for novo) e devolve o id. Só CPF/CNPJ válido; sem documento válido
 * devolve null (a parte fica na lista "cliente a cadastrar"). Nunca sobrescreve um cliente que já existe.
 */
export async function garantirCliente(
  sb: SupabaseClient,
  p: { documento: string | null | undefined; nome: string | null | undefined; email?: string | null; telefone?: string | null; fonte: string }
): Promise<{ id: string; criado: boolean } | null> {
  const tipo = tipoDoDocumento(p.documento);
  const nome = (p.nome ?? "").trim();
  if (!tipo || !nome) return null;
  const cpf = digitos(p.documento);
  const { data: existente } = await sb.from("locatarios").select("id").eq("cpf", cpf).maybeSingle();
  if (existente) return { id: existente.id, criado: false };
  const { data: novo, error } = await sb
    .from("locatarios")
    .insert({ cpf, nome, nome_normalizado: nome.toUpperCase(), tipo_documento: tipo, email: p.email?.trim() || null, telefone: digitos(p.telefone) || null, primeira_fonte: p.fonte })
    .select("id")
    .single();
  if (error) {
    // corrida: outro processo criou o mesmo CPF no meio
    const { data: de_novo } = await sb.from("locatarios").select("id").eq("cpf", cpf).maybeSingle();
    return de_novo ? { id: de_novo.id, criado: false } : null;
  }
  return { id: novo.id, criado: true };
}

export type ClienteLinha = { id: string; codigo_cliente: number; nome: string | null; cpf: string | null; email: string | null; telefone: string | null; primeira_fonte: string | null; created_at: string; cadastro_incompleto: boolean };

const COLUNAS = "id, codigo_cliente, nome, cpf, email, telefone, primeira_fonte, created_at, cadastro_incompleto";

/** Busca por nome, CPF/CNPJ ou código (CLI-000123). Lista limitada; filtro "incompleto" mostra só cadastros a completar. */
export async function buscarClientes(sb: SupabaseClient, f: { q?: string; incompleto?: boolean; limite?: number }) {
  const limite = Math.min(f.limite ?? 50, 500);
  let q = sb.from("locatarios").select(COLUNAS, { count: f.q || f.incompleto ? "exact" : undefined });
  const termo = (f.q ?? "").trim();
  if (termo) {
    const d = digitos(termo);
    const cod = numeroDoCodigo(termo);
    if (/^cli/i.test(termo) && cod) q = q.eq("codigo_cliente", cod);
    else if (d.length === 11 || d.length === 14) q = q.eq("cpf", d);
    else q = q.ilike("nome", `%${termo.replace(/[%_,()]/g, "")}%`); // nome (e não nome_normalizado: ~7,6 mil cadastros antigos não têm o normalizado)
  }
  // incompleto = coluna calculada locatarios.cadastro_incompleto (sem CPF/CNPJ de 11/14 dígitos, ou sem e-mail e sem telefone)
  if (f.incompleto) q = q.eq("cadastro_incompleto", true);
  const { data, count, error } = await q.order("codigo_cliente", { ascending: false }).limit(limite);
  if (error) throw new Error(`locatarios: ${error.message}`);
  return { linhas: (data ?? []) as ClienteLinha[], total: count ?? null };
}
