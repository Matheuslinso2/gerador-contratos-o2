import { NextRequest, NextResponse } from "next/server";
import { montarRelatorioDiario, parametrosModelo, MODELO_WHATSAPP } from "@/lib/relatorioDiario/montar";
import { ehDiaUtil } from "@/lib/relatorioDiario/periodo";
import { enviarModeloWhatsApp, destinatariosRelatorio } from "@/lib/whatsapp";
import { alertarAdmin } from "@/lib/email";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Envia o relatório diário pelo WhatsApp às 8h (seg-sex, ver vercel.json),
// depois que atualizar-paineis já atualizou os retratos de madrugada. Só
// copia o Workspace -- não consulta o Bitrix (ver lib/relatorioDiario).
//
// Protegida por CRON_SECRET — mesmo padrão de congelar-paineis/route.ts.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) {
    return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  // O agendamento já é seg-sex; isso só protege contra disparo manual.
  if (!ehDiaUtil()) return NextResponse.json({ ok: true, pulado: "fim de semana" });

  const destinatarios = destinatariosRelatorio();
  if (destinatarios.length === 0) {
    return NextResponse.json({ ok: false, erro: "WHATSAPP_RELATORIO_DESTINATARIOS vazia" }, { status: 500 });
  }

  const parametros = parametrosModelo(await montarRelatorioDiario());
  const resultados = [];
  for (const numero of destinatarios) {
    const r = await enviarModeloWhatsApp(numero, MODELO_WHATSAPP, parametros);
    resultados.push({ numero: `…${numero.slice(-4)}`, ...r });
  }

  const ok = resultados.every((r) => r.ok);
  if (!ok) {
    await alertarAdmin({
      contexto: "O envio do relatório diário pelo WhatsApp falhou para pelo menos um número.",
      detalhe: JSON.stringify(resultados),
      quem: "Relatório diário (WhatsApp)",
    });
  }
  return NextResponse.json({ ok, resultados }, { status: ok ? 200 : 500 });
}
