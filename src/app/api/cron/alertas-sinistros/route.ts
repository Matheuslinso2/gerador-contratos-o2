import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { DOMINIO_O2 } from "@/lib/admin";
import { DIAS_ALERTA_POS_VENCIMENTO, DIAS_ALERTA_RENOVACAO, alertaRenovacao, formatarData, hojeSP, somarDias, vencimentoAluguelDoMes } from "@/lib/sinistros/regras";
import { emailAlertasParaO2, emailAtualizacaoParaImobiliaria, type SinistroEmail } from "@/lib/sinistros/emails";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* eslint-disable @typescript-eslint/no-explicit-any -- linhas do Supabase sem tipos gerados */

// Alertas automáticos dos sinistros, todo dia às 8h:
//  1. Vigência (especificação da tela de visualização, 22/10/2026): sinistro de
//     imóvel OCUPADO em andamento -> um alerta 20 dias antes do vencimento da
//     apólice (histórico, agenda, e-mail à imobiliária pelo boleto da
//     renovação) e, depois do encerramento da vigência SEM entrega das chaves,
//     um alerta por dia durante 10 dias seguidos -- até a O2 marcar "Setor de
//     renovação foi sinalizado?" na ficha (regra em alertaRenovacao()).
//  2. Acordo / judicial (dias úteis): 1 dia útil depois do vencimento do
//     ALUGUEL, lembra de conferir se o locatário pagou (acordo_alerta_ultimo).
// Lê só sinistros em andamento (tabela pequena). Protegida por CRON_SECRET.

function proximoDiaUtil(data: string) {
  let d = somarDias(data, 1);
  for (;;) {
    const dia = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dia !== 0 && dia !== 6) return d;
    d = somarDias(d, 1);
  }
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

  // 1. vigência da apólice (só ocupados, sem entrega das chaves)
  const { data: vencendo, error: e1 } = await supabase
    .from("sinistros")
    .select("*, imobiliarias(nome, apelido, email)")
    .eq("tipo", "ocupado")
    .is("data_entrega_chaves", null)
    .not("etapa", "in", "(rascunho,cancelado,encerrado)")
    .gte("vigencia_fim", somarDias(hoje, -DIAS_ALERTA_POS_VENCIMENTO))
    .lte("vigencia_fim", somarDias(hoje, DIAS_ALERTA_RENOVACAO));
  if (e1) return NextResponse.json({ erro: e1.message }, { status: 500 });
  for (const s of (vencendo ?? []) as any[]) {
    const alerta = alertaRenovacao(s, hoje);
    if (!alerta) continue;
    const atualizar: Record<string, unknown> = {};
    if (alerta.fase === "vence") {
      // Um alerta por vencimento.
      if (s.alerta_renovacao_em && s.alerta_renovacao_em >= somarDias(s.vigencia_fim, -DIAS_ALERTA_RENOVACAO)) continue;
      atualizar.alerta_renovacao_em = hoje;
    } else {
      // Depois do encerramento: um por dia, 10 dias seguidos.
      if (s.renovacao_alerta_ultimo === hoje) continue;
      atualizar.renovacao_alerta_ultimo = hoje;
    }
    if (!s.proxima_acao_em || s.proxima_acao_em > hoje) {
      atualizar.proxima_acao_em = hoje;
      atualizar.proxima_acao_descricao = "Sinalizar o setor de renovação (vigência da apólice)";
    }
    await supabase.from("sinistros").update(atualizar).eq("id", s.id);
    await supabase.from("sinistro_historico").insert({ sinistro_id: s.id, autor_tipo: "sistema", referente: "interno", visivel_imobiliaria: false, texto: `⚠ Alerta automático: ${alerta.texto}` });
    itensEquipe.push({ id: s.id, codigo: s.codigo, texto: alerta.texto });
    if (alerta.fase === "vence") {
      const destinos = destinosImobiliaria(s);
      if (destinos.length) {
        await emailAtualizacaoParaImobiliaria(
          s as SinistroEmail,
          destinos,
          "Apólice perto do vencimento",
          `A apólice deste sinistro vence em ${formatarData(s.vigencia_fim)} e o imóvel segue ocupado. Para não perder a cobertura durante o processo, envie o boleto da renovação à O2 nos próximos dias.`
        );
        emailsImobiliaria++;
      }
    }
  }

  // 2. parcelas de acordo
  const { data: acordos, error: e2 } = await supabase
    .from("sinistros")
    .select("id, codigo, proxima_acao_em, acordo_primeira_parcela, acordo_ultima_parcela, acordo_vencimento_aluguel, acordo_alerta_ultimo")
    .eq("etapa", "acordo_judicial")
    .or("acordo_vencimento_aluguel.not.is.null,acordo_primeira_parcela.not.is.null");
  if (e2) return NextResponse.json({ erro: e2.message }, { status: 500 });
  const diaSemana = new Date(`${hoje}T12:00:00Z`).getUTCDay();
  const diaUtil = diaSemana !== 0 && diaSemana !== 6;
  for (const s of (diaUtil ? acordos ?? [] : []) as any[]) {
    const venc = vencimentoAluguelDoMes(s, hoje);
    if (!venc || hoje < proximoDiaUtil(venc)) continue;
    if (s.acordo_alerta_ultimo && s.acordo_alerta_ultimo >= venc) continue;
    const mesRef = `${venc.slice(5, 7)}/${venc.slice(0, 4)}`;
    const texto = `aluguel venceu em ${formatarData(venc)} (acordo em andamento) — conferir se o locatário pagou`;
    await supabase
      .from("sinistros")
      .update({ acordo_alerta_ultimo: hoje, proxima_acao_em: hoje, proxima_acao_descricao: `Conferir pagamento do aluguel de ${mesRef} (acordo)` })
      .eq("id", s.id);
    await supabase.from("sinistro_historico").insert({ sinistro_id: s.id, autor_tipo: "sistema", referente: "interno", visivel_imobiliaria: false, texto: `⚠ Alerta automático: ${texto}.` });
    itensEquipe.push({ id: s.id, codigo: s.codigo, texto });
  }

  await emailAlertasParaO2(itensEquipe);
  return NextResponse.json({ ok: true, hoje, alertas: itensEquipe.length, emails_imobiliaria: emailsImobiliaria });
}
