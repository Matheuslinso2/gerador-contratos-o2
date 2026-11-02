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
    const resumo = await sincronizarNibo(sb, { desde, ...(paginaParam !== null && /^\d+$/.test(paginaParam) ? { paginaIni: Number(paginaParam), paginas: paginasParam && /^\d+$/.test(paginasParam) ? Math.min(Number(paginasParam), 40) : 20 } : {}) });
    console.log("erp-nibo", JSON.stringify(resumo)); // aparece nos logs da Vercel (sem token, só contagens e mensagens de erro)
    // Histórico (01/11/2026): enquanto a leitura de 2021 em diante não terminou, cada rodada horária lê mais 10 páginas por rota e empresa
    // (10 mil lançamentos) e guarda de onde continuar em erp_nibo_historico_estado; ao terminar, cruza os pagamentos de repasse com os relatórios do Corp.
    let historico: Record<string, unknown> | undefined;
    if (paginaParam === null) {
      const { data: est } = await sb.from("erp_nibo_historico_estado").select("desde, proxima_pagina, concluido, rodadas").eq("id", 1).maybeSingle();
      if (est && !est.concluido) {
        // 03/11/2026: rodadas menores (4 páginas = 2 mil por rota e empresa) e o erro, se houver, fica gravado em erp_nibo_historico_estado.ultimo_erro (a rodada horária anterior não avançava e não deixava rastro)
        const h = await sincronizarNibo(sb, { desde: est.desde as string, paginaIni: est.proxima_pagina as number, paginas: 4 });
        const empresas = "resumo" in h && h.resumo ? Object.values(h.resumo) : [];
        const comErro = !h.ok || empresas.some((x) => x.erros.length > 0);
        if (comErro) {
          const msg = !h.ok && "erro" in h ? String(h.erro) : empresas.flatMap((x) => x.erros).join(" | ");
          await sb.from("erp_nibo_historico_estado").update({ ultimo_erro: msg.slice(0, 900), ultimo_erro_em: new Date().toISOString() }).eq("id", 1);
        }
        const proximas = empresas.flatMap((x) => (x.proxima ? [x.proxima.recebimento, x.proxima.pagamento] : [])).filter((v): v is number => v !== null);
        const concluido = !comErro && proximas.length === 0;
        if (!comErro) {
          await sb.from("erp_nibo_historico_estado").update({ proxima_pagina: concluido ? est.proxima_pagina : Math.max(...proximas), concluido, rodadas: (est.rodadas as number) + 1, atualizado_em: new Date().toISOString(),
            ultimo_resumo: empresas.map((x) => ({ recebimentos: x.recebimentos, pagamentos: x.pagamentos })) }).eq("id", 1);
        }
        historico = { desde: est.desde, pagina: est.proxima_pagina, concluido, ...(comErro ? { erro: "rodada com erro; repete na próxima hora" } : {}) };
        console.log("erp-nibo-historico", JSON.stringify(historico));
      }
      const { data: conf, error: erroConf } = await sb.rpc("erp_nibo_repasse_conferir");
      console.log("erp-nibo-repasse-conferir", erroConf ? `erro: ${erroConf.message}` : JSON.stringify(conf));
    }
    // Aproveita a rodada horária para remedir os prazos de pagamento das seguradoras (erp_prazos_comissao; os editados à mão não mudam).
    const { data: prazos, error: erroPrazos } = await sb.rpc("erp_atualizar_prazos_comissao");
    console.log("erp-prazos-comissao", erroPrazos ? `erro: ${erroPrazos.message}` : `${prazos} linha(s) atualizada(s)`);
    const proximas = ("resumo" in resumo && resumo.resumo ? Object.values(resumo.resumo) : []).flatMap((x) => (x.proxima ? [x.proxima.recebimento, x.proxima.pagamento] : [])).filter((v): v is number => v !== null);
    return NextResponse.json({ ...resumo, ...(historico ? { historico } : {}), ...(paginaParam !== null ? { proxima_pagina: proximas.length ? Math.max(...proximas) : null } : {}), prazos_comissao: erroPrazos ? { erro: erroPrazos.message } : { atualizadas: prazos } }, { status: resumo.ok ? 200 : 503 });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: (e as Error).message }, { status: 500 });
  }
}
