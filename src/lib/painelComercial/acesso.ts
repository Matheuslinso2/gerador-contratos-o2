import { isMatheus } from "@/lib/admin";
import type { Datasets, Linha } from "./construir";

// Perfis do Painel Comercial v5 (item 4 do prompt). A comissão individual é
// remuneração (entra na folha): o controle é feito AQUI, no servidor, pelo
// e-mail da conta logada. Nada de nome, correspondência parcial ou escolha
// feita no navegador. Quem não está na lista só vê os dados sem remuneração.

export type Perfil =
  | { tipo: "diretoria" }
  | { tipo: "supervisao" }
  | { tipo: "vendedora"; vendedora: "Dayane" | "Livia" }
  | { tipo: "equipe" }; // conta @o2seguros sem papel definido no painel: sem comissão individual

// Contas conferidas no cadastro do Workspace em 28/10/2026 (auth.users).
const CONTAS: Record<string, Perfil> = {
  "vanessa@o2seguros.com.br": { tipo: "diretoria" },
  "fabricio@o2seguros.com.br": { tipo: "diretoria" },
  "henrique@o2seguros.com.br": { tipo: "supervisao" },
  "dayane@o2seguros.com.br": { tipo: "vendedora", vendedora: "Dayane" },
  "livia@o2seguros.com.br": { tipo: "vendedora", vendedora: "Livia" },
};

export function perfilDoEmail(email: string | null | undefined): Perfil | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  if (CONTAS[e]) return CONTAS[e];
  if (isMatheus(e)) return { tipo: "diretoria" }; // dono da O2
  return e.endsWith("@o2seguros.com.br") ? { tipo: "equipe" } : null;
}

const CHAVES_COMISSAO_KPI = new Set(["comissao_vend", "calls_pendentes"]);

const veTudo = (p: Perfil) => p.tipo === "diretoria" || p.tipo === "supervisao";
/** Vendedora que o perfil pode ver na remuneração: "*" = todas, null = nenhuma. */
function alvoComissao(p: Perfil): string | "*" | null {
  if (veTudo(p)) return "*";
  if (p.tipo === "vendedora") return p.vendedora;
  return null;
}

/**
 * Devolve os datasets com a comissão individual filtrada pelo perfil.
 * Não altera o original (o retrato compartilhado fica intacto).
 */
export function filtrarPorPerfil(dados: Datasets, perfil: Perfil): Datasets {
  const alvo = alvoComissao(perfil);
  const pode = (vendedora: unknown) => alvo === "*" || (alvo !== null && String(vendedora) === alvo);
  const saida: Datasets = { ...dados };

  saida.comissao = (dados.comissao ?? []).filter((r) => pode(r.vendedora));
  // "Total" revela a remuneração das outras: só entra para quem vê tudo.
  saida.comissao_resumo = (dados.comissao_resumo ?? []).filter((r) => (r.vendedora === "Total" ? alvo === "*" : pode(r.vendedora)));
  saida.kpi = (dados.kpi ?? []).map((r) => (CHAVES_COMISSAO_KPI.has(String(r.chave)) && !pode(r.vendedora) ? { ...r, valor: null } : r));
  saida.equipe = (dados.equipe ?? []).map((r) => (pode(r.vendedora) ? r : { ...r, comissao_vend: null }));
  saida.ativ_vendedoras = (dados.ativ_vendedoras ?? []).map((r) => (pode(r.vendedora) ? r : { ...r, valor_05: null, comissao_o2_convertida: null }));
  // Financeiro das campanhas (comissão, repasse, custo e resultado): só diretoria e supervisão.
  if (!veTudo(perfil)) {
    saida.camp_def = (dados.camp_def ?? []).map((r) => ({ ...r, comissao: null, repasse: null, custo_premiacao: null, resultado: null, corp_premio: null, corp_documentos: null }));
  }
  return saida;
}

/** Rótulo da visão para o painel (substitui o seletor de simulação). */
export function visaoDoPerfil(p: Perfil): "dir" | "sup" | "equipe" | "Dayane" | "Livia" {
  if (p.tipo === "vendedora") return p.vendedora;
  if (p.tipo === "equipe") return "equipe";
  return p.tipo === "supervisao" ? "sup" : "dir";
}

export type { Linha };
