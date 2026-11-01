import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sincronizarNibo } from "@/lib/erp/nibo";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ERP O2 — espelho do Nibo (só leitura): contas, recebimentos e pagamentos realizados dos últimos 120 dias
// (ou ?desde=AAAA-MM-DD). Serve à conferência "entrou no banco", ao repasse pago e ao DAS pago.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  const desdeParam = request.nextUrl.searchParams.get("desde");
  const desde = desdeParam && /^\d{4}-\d{2}-\d{2}$/.test(desdeParam) ? desdeParam : new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  try {
    const sb = createServiceClient();
    // histórico: ?desde=2021-11-01&pagina=0&paginas=20 lê 20 páginas (10 mil lançamentos) por empresa e rota; repita com pagina=<proxima_pagina> até vir null
    const paginaParam = request.nextUrl.searchParams.get("pagina");
    const paginasParam = request.nextUrl.searchParams.get("paginas");
    const resumo = await sincronizarNibo(sb, { desde, ...(paginaParam !== null && /^d+$/.test(paginaParam) ? { paginaIni: Number(paginaParam), paginas: paginasParam && /^d+$/.test(paginasParam) ? Math.min(Number(paginasParam), 40) : 20 } : {}) });
    console.log("erp-nibo", JSON.stringify(resumo)); // aparece nos logs da Vercel (sem token, só contagens e mensagens de erro)
    // Aproveita a rodada horária para remedir os prazos de pagamento das seguradoras (erp_prazos_comissao; os editados à mão não mudam).
    const { data: prazos, error: erroPrazos } = await sb.rpc("erp_atualizar_prazos_comissao");
    console.log("erp-prazos-comissao", erroPrazos ? `erro: ${erroPrazos.message}` : `${prazos} linha(s) atualizada(s)`);
    const proximas = ("resumo" in resumo && resumo.resumo ? Object.values(resumo.resumo) : []).flatMap((x) => (x.proxima ? [x.proxima.recebimento, x.proxima.pagamento] : [])).filter((v): v is number => v !== null);
    return NextResponse.json({ ...resumo, ...(paginaParam !== null ? { proxima_pagina: proximas.length ? Math.max(...proximas) : null } : {}), prazos_comissao: erroPrazos ? { erro: erroPrazos.message } : { atualizadas: prazos } }, { status: resumo.ok ? 200 : 503 });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: (e as Error).message }, { status: 500 });
  }
}
