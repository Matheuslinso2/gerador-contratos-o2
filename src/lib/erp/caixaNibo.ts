// ERP O2 — conferência de caixa dentro da tela de baixa (28/10/2026).
// O banco (Nibo, categoria "1.1 - RECEITA DE SEGUROS") é o fiel da balança: cada lançamento do Nibo é a soma dos extratos
// pagos naquele dia por seguradora e empresa (fim de semana cai no dia útil seguinte). O Nibo registra o líquido ANTES do
// desconto da seguradora (ex.: empréstimo Porto entra como receita e como pagamento de empréstimo), por isso a comparação
// usa liquido_sem_desconto do extrato. Só leitura: nada é gravado no Nibo nem no banco.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const TOLERANCIA_CAIXA = 6; // R$ por parcela (regra do Matheus, 28/10); no total do mês só serve de limite do "bate"

export type EntradaNibo = { corretora: string; seg: string; dia: string; valor: number };
export type ExtratoDia = { seg: string; corretora: string | null; dia: string; liquido: number; bruto: number; linhas: number };
export type DiaCaixa = { dia: string; banco: number; extrato: number; dif: number };

const EMPRESA: Record<string, string> = { corretora: "O2 Corretora", capitalizacao: "O2 Capitalização" };

// nome do fornecedor no Nibo → abreviação em erp_seguradoras (Liberty virou Yelum; no Nibo ainda aparece como Liberty)
const FORNECEDOR: [RegExp, string][] = [
  [/toki/i, "TOKI"], [/porto/i, "PORT"], [/pottencial/i, "POTT"], [/allianz/i, "ALLI"], [/brasil ?cap/i, "BRAS"], [/^too\b/i, "TOO"],
  [/liberty|yelum/i, "YELU"], [/icatu/i, "ICAT"], [/alfa/i, "ALFA"], [/azul/i, "AZUL"], [/bradesco/i, "BRAD"], [/mapfre/i, "MAPF"],
  [/hdi/i, "HDI"], [/suhai/i, "SUHA"], [/sul ?am[eé]rica/i, "SULA"], [/zurich/i, "ZURI"],
];
export function segDoFornecedor(nome: string | null): string {
  for (const [re, abrev] of FORNECEDOR) if (nome && re.test(nome)) return abrev;
  return "OUTRAS";
}

// Feriados nacionais: fixos (mm-dd) e os móveis de 2026 (Carnaval, Sexta-feira Santa, Corpus Christi). Ajustar a lista a cada ano.
const FERIADOS_FIXOS = new Set(["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"]);
const FERIADOS_MOVEIS = new Set(["2026-02-16", "2026-02-17", "2026-04-03", "2026-06-04"]);
const ehFeriado = (iso: string) => FERIADOS_FIXOS.has(iso.slice(5, 10)) || FERIADOS_MOVEIS.has(iso.slice(0, 10));

// sábado, domingo e feriado nacional caem no próximo dia útil (o pagamento só entra no banco nesse dia)
export function diaDeCredito(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || ehFeriado(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function entradasNibo(sb: SupabaseClient, desde: string, ate: string): Promise<EntradaNibo[]> {
  const saida: EntradaNibo[] = [];
  for (let de = 0; ; de += 1000) {
    const { data } = await sb
      .from("erp_nibo_lancamentos")
      .select("empresa, data, valor, stakeholder_nome")
      .eq("tipo", "recebimento")
      .eq("categoria", "1.1 - RECEITA DE SEGUROS")
      .gte("data", desde)
      .lte("data", ate)
      .order("data")
      .range(de, de + 999);
    const lote = (data ?? []) as { empresa: string; data: string; valor: number | string; stakeholder_nome: string | null }[];
    for (const l of lote) {
      const corretora = EMPRESA[l.empresa];
      if (!corretora) continue;
      saida.push({ corretora, seg: segDoFornecedor(l.stakeholder_nome), dia: l.data.slice(0, 10), valor: Number(l.valor) });
    }
    if (lote.length < 1000) break;
  }
  return saida;
}

// A Tokio (e outras) aparecem duas vezes: o extrato por apólice e o mesmo total vindo só como total. Conta uma vez:
// mesma seguradora × empresa × dia × total, fica o que tem mais linhas.
export function semDuplicados(extratos: ExtratoDia[]): ExtratoDia[] {
  const m = new Map<string, ExtratoDia>();
  for (const e of extratos) {
    const k = `${e.seg}|${e.corretora}|${e.dia}|${Math.round(e.bruto * 100)}`;
    const atual = m.get(k);
    if (!atual || e.linhas > atual.linhas) m.set(k, e);
  }
  return [...m.values()];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

// chave: corretora|seg|AAAA-MM do dia de crédito
// Um extrato datado de um dia pode entrar no banco um ou dois dias depois (ou junto com o do dia seguinte): quando um dia só tem
// extrato e um dia próximo (até 3 dias depois) tem no banco exatamente essa sobra, os dois são juntados no dia do banco.
export function compararDias(extratos: ExtratoDia[], entradas: EntradaNibo[]): Map<string, DiaCaixa[]> {
  const porSeg = new Map<string, Map<string, { banco: number; extrato: number }>>();
  const pega = (corretora: string, seg: string, dia: string) => {
    const k = `${corretora}|${seg}`;
    if (!porSeg.has(k)) porSeg.set(k, new Map());
    const dias = porSeg.get(k)!;
    if (!dias.has(dia)) dias.set(dia, { banco: 0, extrato: 0 });
    return dias.get(dia)!;
  };
  for (const e of semDuplicados(extratos)) {
    if (!e.corretora) continue;
    pega(e.corretora, e.seg, diaDeCredito(e.dia)).extrato += e.liquido;
  }
  for (const n of entradas) pega(n.corretora, n.seg, n.dia).banco += n.valor;

  const saida = new Map<string, DiaCaixa[]>();
  for (const [kSeg, dias] of porSeg) {
    const ordem = [...dias.keys()].sort();
    for (const dE of ordem) {
      const e = dias.get(dE)!;
      if (e.banco > TOLERANCIA_CAIXA || e.extrato <= TOLERANCIA_CAIXA) continue; // só dias com extrato e nada no banco
      const alvo = ordem.find((dB) => {
        if (dB <= dE) return false;
        const gap = (new Date(dB).getTime() - new Date(dE).getTime()) / 86400000;
        const b = dias.get(dB)!;
        return gap <= 3 && Math.abs(b.banco - b.extrato - e.extrato) <= TOLERANCIA_CAIXA;
      });
      if (alvo) { dias.get(alvo)!.extrato += e.extrato; dias.delete(dE); }
    }
    const [corretora, seg] = kSeg.split('|');
    for (const [dia, v] of dias) {
      const chave = `${corretora}|${seg}|${dia.slice(0, 7)}`;
      if (!saida.has(chave)) saida.set(chave, []);
      saida.get(chave)!.push({ dia, banco: r2(v.banco), extrato: r2(v.extrato), dif: r2(v.banco - v.extrato) });
    }
  }
  for (const lista of saida.values()) lista.sort((a, b) => a.dia.localeCompare(b.dia));
  return saida;
}

export type SituacaoCaixa = { codigo: "bate" | "banco_acima" | "extrato_acima" | "sem_banco" | "sem_extrato" | "aguardando"; texto: string; cor: string };
const SIT: Record<SituacaoCaixa["codigo"], SituacaoCaixa> = {
  aguardando: { codigo: "aguardando", texto: "Esperado, ainda não pagou", cor: "bg-gray-100 text-gray-700" },
  bate: { codigo: "bate", texto: "Bate com o banco", cor: "bg-green-100 text-green-800" },
  banco_acima: { codigo: "banco_acima", texto: "Banco acima do extrato", cor: "bg-orange-100 text-orange-800" },
  extrato_acima: { codigo: "extrato_acima", texto: "Extrato acima do banco", cor: "bg-red-100 text-red-700" },
  sem_banco: { codigo: "sem_banco", texto: "Sem entrada no banco", cor: "bg-red-100 text-red-700" },
  sem_extrato: { codigo: "sem_extrato", texto: "Sem extrato no ERP", cor: "bg-yellow-100 text-yellow-800" },
};

// esperado = líquido do extrato antes do desconto da seguradora (é assim que o Nibo registra)
export function situacaoCaixa(esperado: number | null, banco: number | null, previsto: number | null = null): SituacaoCaixa {
  if (esperado == null || esperado === 0) {
    if (banco && banco > 0) return SIT.sem_extrato;
    return previsto && previsto > TOLERANCIA_CAIXA ? SIT.aguardando : SIT.bate;
  }
  if (banco == null || banco === 0) return SIT.sem_banco;
  const dif = banco - esperado;
  if (Math.abs(dif) <= TOLERANCIA_CAIXA) return SIT.bate;
  return dif > 0 ? SIT.banco_acima : SIT.extrato_acima;
}

// ---------- motivo provável da diferença (fase 2, 28/10) ----------
// Regras do manual de baixa e do Matheus: Pottencial só paga ~48h úteis depois da nota fiscal (NF até o dia 25) e o valor do banco
// é o demonstrativo unificado do mês; Too e saúde só depois da NF e do dinheiro na conta; fim de semana e feriado → próximo dia útil;
// estorno reduz o bruto; pró-labore pago direto à imobiliária não passa pela conta; desconto da seguradora (empréstimo Porto) o Nibo
// lança como receita. São HIPÓTESES para a equipe investigar, nunca classificação automática.
export type ContextoMotivo = {
  seg: string;
  mesAtual: boolean; // o mês ainda está aberto
  esperado: number | null; // pagou (extrato)
  banco: number | null;
  previsto: number | null;
  desconto: number;
  proLabore: number;
  nEstorno: number;
  dias: DiaCaixa[];
  ultimoExtrato: string | null; // data do extrato mais recente que o ERP leu desta seguradora
  nfRegistrada: boolean | null; // só Pottencial e Too; null = não se aplica
};

const brlCurto = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// Nestas seguradoras o previsto pela experiência costuma ficar bem acima do caixa (pró-labore direto ainda não descontado): não comparar.
const SEGS_PREVISTO_INFLADO = new Set(["TOKI", "YELU"]);

export function motivosProvaveis(c: ContextoMotivo): string[] {
  const m: string[] = [];
  const banco = c.banco ?? 0, esperado = c.esperado ?? 0;
  const dif = banco - esperado;
  const semExtrato = c.dias.filter((d) => d.extrato === 0 && d.banco > TOLERANCIA_CAIXA);
  const semBanco = c.dias.filter((d) => d.banco === 0 && d.extrato > TOLERANCIA_CAIXA);
  const outros = c.dias.filter((d) => d.banco > 0 && d.extrato > 0 && Math.abs(d.dif) > TOLERANCIA_CAIXA);
  const lista = (ds: DiaCaixa[], campo: "banco" | "extrato") => ds.slice(0, 3).map((d) => `${dm(d.dia)} (${brlCurto(d[campo])})`).join(", ") + (ds.length > 3 ? ` e mais ${ds.length - 3}` : "");

  if (c.desconto > 0) m.push(`Inclui o desconto da seguradora de ${brlCurto(c.desconto)} (ex.: empréstimo da Porto): o Nibo lança como receita e o ERP já considera.`);
  if (c.proLabore > 0) m.push(`Inclui ${brlCurto(c.proLabore)} de pró-labore pago direto à imobiliária (não passa pela conta).`);
  if (c.nEstorno > 0) m.push(`${c.nEstorno} estorno(s) no extrato reduzem o bruto.`);

  if (c.seg === "POTT" && banco > 0 && banco > esperado * 3) {
    m.push("Pottencial: o banco recebe o demonstrativo unificado do mês (uma nota fiscal só, pedida perto do dia 20); o ERP leu só o demonstrativo automático. Falta o unificado.");
  } else if (semExtrato.length) {
    const apos = c.ultimoExtrato && semExtrato.every((d) => d.dia > c.ultimoExtrato!);
    m.push(
      `Entrou no banco sem extrato: ${lista(semExtrato, "banco")}. ` +
        (apos ? `O extrato mais recente que o ERP leu é de ${dm(c.ultimoExtrato!)}: provável extrato ainda não carregado.` : "Verifique se o extrato foi salvo no Drive ou se é premiação/ajuste."),
    );
  }

  if (semBanco.length) {
    let dica = "o pagamento pode ter caído em outra data ou ainda não ter sido feito";
    if (c.seg === "TOO") dica = c.nfRegistrada ? "Too paga depois da nota fiscal e do dinheiro na conta" : "Too só paga depois da nota fiscal, e nenhuma está registrada no ERP";
    if (c.seg === "POTT") dica = c.nfRegistrada ? "Pottencial paga ~48 horas úteis depois da nota fiscal" : "Pottencial só paga ~48 horas úteis depois da nota fiscal (NF até o dia 25), e nenhuma está registrada no ERP";
    m.push(`Extrato sem entrada no banco: ${lista(semBanco, "extrato")}. ${dica[0].toUpperCase()}${dica.slice(1)}.`);
  }
  if (outros.length) m.push(`Valores diferentes entre banco e extrato em ${lista(outros, "banco")}: confira estorno, imposto retido diferente do cadastro ou extrato parcial.`);

  if (c.previsto != null && c.previsto > TOLERANCIA_CAIXA && !SEGS_PREVISTO_INFLADO.has(c.seg)) {
    const falta = c.previsto - Math.max(banco, esperado);
    if (falta > Math.max(TOLERANCIA_CAIXA, c.previsto * 0.15)) {
      m.push(
        c.mesAtual
          ? `Faltam ${brlCurto(falta)} do que deveria cair no mês pela experiência: ainda dentro do mês.`
          : `Mês encerrado e ${brlCurto(falta)} do previsto pela experiência não caíram: pode ser comissão não recebida ou inadimplência (diagnóstico na próxima fase).`,
      );
    }
  }
  if (!m.length && Math.abs(dif) <= TOLERANCIA_CAIXA && esperado > 0) m.push("Banco e extrato batem.");
  return m;
}
