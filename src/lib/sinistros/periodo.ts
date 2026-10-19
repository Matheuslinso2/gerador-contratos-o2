// Período e filtros do dashboard de Sinistros (planejamento v2, seções 3–4).
// Tudo em MESES: início e fim são o 1º dia do mês ("AAAA-MM-01"); o mês
// corrente conta até hoje. Os filtros moram na URL (link compartilhável):
//   ?periodo=12m | 3m | 6m | mes | mes_anterior | ano | ano_anterior | s1-2026 | s2-2025 | t3-2026 | ano-2024
//   ?de=2026-01&ate=2026-06           (personalizado; vence o "periodo")
//   ?seg=PORTO SEGURO&seg=POTTENCIAL  (seguradoras)
//   ?imob=<chave>                     (imobiliária/grupo — recorta tudo)
//   ?tipo=ocupado&tipo=chaves · ?sit=em_aberto|indenizado|sem_indenizacao

import { hojeSP } from "./regras";

export type Periodo = { inicio: string; fim: string; rotulo: string; chave: string };

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function mes(ano: number, m: number) {
  // m pode sair de 1..12 (normaliza).
  const d = new Date(Date.UTC(ano, m - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
export function rotuloMes(iso: string) {
  const [a, m] = iso.split("-");
  return `${MESES_CURTOS[Number(m) - 1]}/${a.slice(2)}`;
}
function rotuloIntervalo(inicio: string, fim: string) {
  return inicio === fim ? rotuloMes(inicio) : `${rotuloMes(inicio)} a ${rotuloMes(fim)}`;
}

export function atalhosPeriodo(hoje = hojeSP()) {
  const ano = Number(hoje.slice(0, 4));
  const m = Number(hoje.slice(5, 7));
  const atual = mes(ano, m);
  const lista: Periodo[] = [
    { chave: "12m", rotulo: "Últimos 12 meses", inicio: mes(ano, m - 11), fim: atual },
    { chave: "6m", rotulo: "Últimos 6 meses", inicio: mes(ano, m - 5), fim: atual },
    { chave: "3m", rotulo: "Últimos 3 meses", inicio: mes(ano, m - 2), fim: atual },
    { chave: "mes", rotulo: "Mês atual", inicio: atual, fim: atual },
    { chave: "mes_anterior", rotulo: "Mês anterior", inicio: mes(ano, m - 1), fim: mes(ano, m - 1) },
    { chave: "ano", rotulo: `Ano atual (${ano})`, inicio: mes(ano, 1), fim: atual },
    { chave: "ano_anterior", rotulo: `Ano anterior (${ano - 1})`, inicio: mes(ano - 1, 1), fim: mes(ano - 1, 12) },
  ];
  // Semestres e trimestres do ano atual e dos dois anteriores (só os já começados).
  for (const a of [ano, ano - 1, ano - 2]) {
    for (const s of [1, 2]) {
      const ini = mes(a, s === 1 ? 1 : 7);
      if (ini > atual) continue;
      lista.push({ chave: `s${s}-${a}`, rotulo: `${s}º semestre ${a}`, inicio: ini, fim: mes(a, s === 1 ? 6 : 12) < atual ? mes(a, s === 1 ? 6 : 12) : atual });
    }
    for (const t of [1, 2, 3, 4]) {
      const ini = mes(a, (t - 1) * 3 + 1);
      if (ini > atual) continue;
      const fim = mes(a, t * 3);
      lista.push({ chave: `t${t}-${a}`, rotulo: `${t}º trimestre ${a}`, inicio: ini, fim: fim < atual ? fim : atual });
    }
    if (a < ano) lista.push({ chave: `ano-${a}`, rotulo: `Ano ${a}`, inicio: mes(a, 1), fim: mes(a, 12) });
  }
  return lista;
}

export const PERIODO_PADRAO = "12m";

export function resolverPeriodo(params: { periodo?: string; de?: string; ate?: string }, hoje = hojeSP()): Periodo {
  const valido = (v?: string) => !!v && /^\d{4}-\d{2}$/.test(v);
  if (valido(params.de) && valido(params.ate)) {
    let inicio = `${params.de}-01`;
    let fim = `${params.ate}-01`;
    if (inicio > fim) [inicio, fim] = [fim, inicio];
    const atual = `${hoje.slice(0, 7)}-01`;
    if (fim > atual) fim = atual;
    if (inicio < "2019-01-01") inicio = "2019-01-01";
    return { chave: "personalizado", rotulo: rotuloIntervalo(inicio, fim), inicio, fim };
  }
  const atalhos = atalhosPeriodo(hoje);
  return atalhos.find((a) => a.chave === params.periodo) ?? atalhos[0];
}

export function mesesNoPeriodo(p: Periodo) {
  const [a1, m1] = p.inicio.split("-").map(Number);
  const [a2, m2] = p.fim.split("-").map(Number);
  return (a2 - a1) * 12 + (m2 - m1) + 1;
}

const CHAVES_DASHBOARD = ["periodo", "de", "ate", "seg", "imob", "tipo", "sit"];

// Query string só com os filtros do dashboard (para levar à Gestão e voltar).
export function filtrosDashboard(params: Record<string, string | string[] | undefined>) {
  const q = new URLSearchParams();
  for (const k of CHAVES_DASHBOARD) {
    const v = params[k];
    for (const item of Array.isArray(v) ? v : v ? [v] : []) q.append(k, item);
  }
  return q.toString();
}

export function lista(v: string | string[] | undefined): string[] {
  return Array.isArray(v) ? v.filter(Boolean) : v ? [v] : [];
}
