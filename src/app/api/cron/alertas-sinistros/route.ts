import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { DOMINIO_O2 } from "@/lib/admin";
import { diasEntre, formatarData, hojeSP, somarDias } from "@/lib/sinistros/regras";
import { emailAlertasParaO2, emailAtualizacaoParaImobiliaria, type SinistroEmail } from "@/lib/sinistros/emails";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any -- linhas do Supabase sem tipos gerados */

// Alertas automáticos dos sinistros (reunião da equipe, 21/10/2026), dias úteis às 8h:
//  1. Apólice vencida ou vencendo em até 15 dias, com sinistro em andamento:
//     histórico + agenda do responsável ("verificar renovação") e e-mail para a
//     imobiliária mandar o boleto da renovação (janela de 10 a 15 dias antes).
//     Um alerta por sinistro (sinistros.alerta_renovacao_em).
//  2. Acordo / judicial: 1 dia útil depois do vencimento de cada parcela,
//     lembra de conferir se o locatário pagou (sinistros.acordo_alerta_ultimo).
// Lê só sinistros em andamento (tabela pequena). Protegida por CRON_SECRET.

function proximoDiaUtil(data: string) {
  let d = somarDias(data, 1);
  for (;;) {
    const dia = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dia !== 0 && dia !== 6) return d;
    d = somarDias(d, 1);
  }
}

// Vencimento da parcela no mês de `hoje` (dia da 1ª parcela), dentro do acordo.
function vencimentoDoMes(s: any, hoje: string): string | null {
  const ini = s.acordo_primeira_parcela as string;
  const dia = Number(ini.slice(8, 10));
  const [ano, mes] = [Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7))];
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const venc = `${ano}-${String(mes).padStart(2, "0")}-${String(Math.min(dia, ultimo)).padStart(2, "0")}`;
  if (venc < ini) return null;
  if (s.acordo_ultima_parcela && venc > s.acordo_ultima_parcela) return null;
  return venc;
}

function destinosImobiliaria(s: any) {
  const lista: string[] = [];
  if (s.criado_por_email && !s.criado_por_email.toLowerCase().endsWith(DOMINIO_O2) && s.criado_por_email !== "migracao-corp") lista.push(s.criado_por_email);
  if (s.imobiliarias?.email) lista.push(...String(s.imobiliarias.email).split(","));
  return lista;
}

export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  const supabase = createServiceClient();
  const hoje = hojeSP();
  const itensEquipe: { id: string; codigo: number; texto: string }[] = [];
  let emailsImobiliaria = 0;

  // 1. vencimento da apólice
  const { data: vencendo, error: e1 } = await supabase
    .from("sinistros")
    .select("*, imobiliarias(nome, apelido, email)")
    .not("etapa", "in", "(rascunho,cancelado,encerrado)")
    .is("alerta_renovacao_em", null)
    .not("vigencia_fim", "is", null)
    .lte("vigencia_fim", somarDias(hoje, 15));
  if (e1) return NextResponse.json({ erro: e1.message }, { status: 500 });
  for (const s of (vencendo ?? []) as any[]) {
    const dias = diasEntre(hoje, s.vigencia_fim);
    const texto = dias < 0 ? `apólice vencida em ${formatarData(s.vigencia_fim)} — verificar a renovação` : `apólice vence em ${formatarData(s.vigencia_fim)} (${dias} dia(s)) — verificar a renovação`;
    const atualizar: Record<string, unknown> = { alerta_renovacao_em: hoje };
    if (!s.proxima_acao_em) {
      atualizar.proxima_acao_em = hoje;
      atualizar.proxima_acao_descricao = "Verificar renovação da apólice";
    }
    await supabase.from("sinistros").update(atualizar).eq("id", s.id);
    await supabase.from("sinistro_historico").insert({ sinistro_id: s.id, autor_tipo: "sistema", referente: "interno", visivel_imobiliaria: false, texto: `⚠ Alerta automático: ${texto}.` });
    itensEquipe.push({ id: s.id, codigo: s.codigo, texto });
    if (dias >= 0) {
      const destinos = destinosImobiliaria(s);
      if (destinos.length) {
        await emailAtualizacaoParaImobiliaria(
          s as SinistroEmail,
          destinos,
          "Apólice perto do vencimento",
          `A apólice deste sinistro vence em ${formatarData(s.vigencia_fim)}. Para não perder a cobertura durante o processo, envie o boleto da renovação à O2 nos próximos dias.`
        );
        emailsImobiliaria++;
      }
    }
  }

  // 2. parcelas de acordo
  const { data: acordos, error: e2 } = await supabase
    .from("sinistros")
    .select("id, codigo, proxima_acao_em, acordo_primeira_parcela, acordo_ultima_parcela, acordo_alerta_ultimo")
    .eq("etapa", "acordo_judicial")
    .not("acordo_primeira_parcela", "is", null);
  if (e2) return NextResponse.json({ erro: e2.message }, { status: 500 });
  for (const s of (acordos ?? []) as any[]) {
    const venc = vencimentoDoMes(s, hoje);
    if (!venc || hoje < proximoDiaUtil(venc)) continue;
    if (s.acordo_alerta_ultimo && s.acordo_alerta_ultimo >= venc) continue;
    const mesRef = `${venc.slice(5, 7)}/${venc.slice(0, 4)}`;
    const texto = `parcela do acordo vencida em ${formatarData(venc)} — conferir se o locatário pagou`;
    await supabase
      .from("sinistros")
      .update({ acordo_alerta_ultimo: hoje, proxima_acao_em: hoje, proxima_acao_descricao: `Conferir pagamento da parcela de ${mesRef} do acordo` })
      .eq("id", s.id);
    await supabase.from("sinistro_historico").insert({ sinistro_id: s.id, autor_tipo: "sistema", referente: "interno", visivel_imobiliaria: false, texto: `⚠ Alerta automático: ${texto}.` });
    itensEquipe.push({ id: s.id, codigo: s.codigo, texto });
  }

  await emailAlertasParaO2(itensEquipe);
  return NextResponse.json({ ok: true, hoje, alertas: itensEquipe.length, emails_imobiliaria: emailsImobiliaria });
}
