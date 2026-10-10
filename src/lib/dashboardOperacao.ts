import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { buscarVisitasPorDia } from "@/lib/cloudflareAnalytics";
import { competenciasAtualEAnterior } from "@/lib/dashboardProducao";

// KPIs de operação e marketing da aba "Painel de KPIs" (pedido do Matheus,
// 09/10/2026): contratos auditados, campanhas/e-mails, uso da calculadora de
// multa rescisória, visitas e leads do site. Cada número vem direto da
// tabela que a tela correspondente já usa (nada estimado). Mês atual (em
// andamento) x mês anterior (fechado), fuso de Brasília.

export type ParMeses = { atual: number; anterior: number };

export type DashboardOperacao = {
  competenciaAtual: string;
  competenciaAnterior: string;
  diaAtual: number;
  diasMesAtual: number;
  diasMesAnterior: number;
  auditados: ParMeses | null;
  campanhas: ParMeses | null;
  enviados: ParMeses | null;
  abertos: ParMeses | null;
  // Estes dois só existem a partir de uma data (a captura/registro começou
  // depois do mês anterior): "desde" avisa quando o mês anterior é incompleto.
  calculadora: (ParMeses & { desde: string | null }) | null;
  leads: (ParMeses & { desde: string | null }) | null;
  visitas: ParMeses | null;
};

function limitesDoMes(competencia: string): { ini: string; fim: string } {
  const [ano, mes] = competencia.split("-").map(Number);
  const proximo = mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, "0")}`;
  return { ini: `${competencia}-01T00:00:00-03:00`, fim: `${proximo}-01T00:00:00-03:00` };
}

async function tentar<T>(rotulo: string, f: () => Promise<T>): Promise<T | null> {
  try {
    return await f();
  } catch (erro) {
    console.error(`Dashboard operação: falha em ${rotulo}:`, erro);
    return null;
  }
}

type OpcoesContagem = { statusIgual?: string; colunaNaoNula?: string };

async function contar(tabela: string, coluna: string, ini: string, fim: string, opcoes: OpcoesContagem = {}): Promise<number> {
  let consulta = createServiceClient().from(tabela).select("id", { count: "exact", head: true }).gte(coluna, ini).lt(coluna, fim);
  if (opcoes.statusIgual) consulta = consulta.eq("status", opcoes.statusIgual);
  if (opcoes.colunaNaoNula) consulta = consulta.not(opcoes.colunaNaoNula, "is", null);
  const { count, error } = await consulta;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function dataDoPrimeiroRegistro(tabela: string, coluna: string): Promise<string | null> {
  const { data, error } = await createServiceClient().from(tabela).select(coluna).order(coluna, { ascending: true }).limit(1);
  if (error) throw new Error(error.message);
  const valor = (data?.[0] as unknown as Record<string, string> | undefined)?.[coluna];
  return valor ?? null;
}

async function porMes(f: (ini: string, fim: string) => Promise<number>, atual: string, anterior: string): Promise<ParMeses> {
  const a = limitesDoMes(atual);
  const b = limitesDoMes(anterior);
  const [valorAtual, valorAnterior] = await Promise.all([f(a.ini, a.fim), f(b.ini, b.fim)]);
  return { atual: valorAtual, anterior: valorAnterior };
}

export async function montarDashboardOperacao(agora = new Date()): Promise<DashboardOperacao> {
  const { atual, anterior } = competenciasAtualEAnterior(agora);
  const dia = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", day: "2-digit" }).format(agora)
  );
  const diasNoMes = (c: string) => new Date(Date.UTC(Number(c.slice(0, 4)), Number(c.slice(5)), 0)).getUTCDate();

  const [auditados, campanhas, enviados, abertos, calculadora, leads, visitas] = await Promise.all([
    tentar("auditados", async () => {
      const [contratos, publico] = await Promise.all([
        porMes((i, f) => contar("auditorias_contrato", "created_at", i, f), atual, anterior),
        porMes((i, f) => contar("auditor_publico_uso", "criado_em", i, f), atual, anterior),
      ]);
      return { atual: contratos.atual + publico.atual, anterior: contratos.anterior + publico.anterior };
    }),
    tentar("campanhas", () => porMes((i, f) => contar("campanhas", "disparada_em", i, f), atual, anterior)),
    tentar("enviados", () => porMes((i, f) => contar("campanhas_envios", "enviado_em", i, f, { statusIgual: "enviado" }), atual, anterior)),
    tentar("abertos", () =>
      porMes((i, f) => contar("campanhas_envios", "enviado_em", i, f, { statusIgual: "enviado", colunaNaoNula: "aberto_em" }), atual, anterior)
    ),
    tentar("calculadora", async () => ({
      ...(await porMes((i, f) => contar("multa_rescisoria_usos", "criado_em", i, f), atual, anterior)),
      desde: await dataDoPrimeiroRegistro("multa_rescisoria_usos", "criado_em"),
    })),
    tentar("leads", async () => ({
      ...(await porMes((i, f) => contar("leads_site_o2seguros", "criado_em", i, f), atual, anterior)),
      // A captura de leads do site entrou no ar em 02/10/2026 (o 1º lead real veio depois).
      desde: "2026-10-02T00:00:00-03:00",
    })),
    tentar("visitas", async () => {
      // Do 1º dia do mês anterior até hoje (máx. ~62 dias).
      const inicio = new Date(`${anterior}-01T12:00:00Z`);
      const dias = Math.ceil((agora.getTime() - inicio.getTime()) / 86_400_000) + 1;
      const diario = await buscarVisitasPorDia(dias);
      if (!diario) return null;
      const soma = (c: string) => diario.filter((d) => d.data.startsWith(c)).reduce((s, d) => s + d.visitas, 0);
      return { atual: soma(atual), anterior: soma(anterior) };
    }),
  ]);

  return {
    competenciaAtual: atual,
    competenciaAnterior: anterior,
    diaAtual: dia,
    diasMesAtual: diasNoMes(atual),
    diasMesAnterior: diasNoMes(anterior),
    auditados,
    campanhas,
    enviados,
    abertos,
    calculadora,
    leads,
    visitas,
  };
}
