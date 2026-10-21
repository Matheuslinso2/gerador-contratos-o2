import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { finalizarImportacao, importarArquivo, sincronizarListas, type TipoArquivo } from "@/lib/corpSharepoint/gravar";
import { lerListas, listarArquivos, sharepointConfigurado } from "@/lib/corpSharepoint/sharepoint";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Corp via SharePoint: lê as extrações do Corp e as listas de regras do site
// "O2 Data Analytics" (mesma fonte do Power BI "PRODUÇÃO CORP") e grava nas
// tabelas corp_*. Só importa arquivo que mudou (md5); depois reaplica a
// deduplicação e atualiza os retratos mensais (mês fechado congela).
// Protegida por CRON_SECRET — mesmo padrão de base-unica-bitrix/route.ts.
const ORDEM: TipoArquivo[] = ["cidades", "clientes", "grade", "sinistros"];

export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return NextResponse.json({ erro: "CRON_SECRET não configurada" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }
  if (!sharepointConfigurado()) {
    return NextResponse.json({ ok: true, pulado: "acesso ao SharePoint ainda não configurado (SHAREPOINT_*)" });
  }

  const sb = createServiceClient();
  const listas = await sincronizarListas(sb, await lerListas());
  const arquivos = (await listarArquivos()).sort((a, b) => ORDEM.indexOf(a.tipo) - ORDEM.indexOf(b.tipo));
  const { data: conhecidos } = await sb.from("corp_sp_arquivos").select("id, sp_etag");
  const etags = new Map((conhecidos ?? []).map((c) => [c.id as string, c.sp_etag as string | null]));
  const resultados = [];
  let ultimoImportado: string | null = null;
  for (const a of arquivos) {
    const id = `${a.tipo}:${a.nome}`;
    if (etags.get(id) === a.etag) {
      resultados.push({ id, nome: a.nome, status: "sem_mudanca" as const });
      continue;
    }
    const r = await importarArquivo(sb, {
      tipo: a.tipo, nome: a.nome, pasta: a.pasta, origem: "sharepoint",
      modificadoEm: a.modificadoEm, etag: a.etag, conteudo: await a.baixar(),
    });
    if (r.status === "importado") ultimoImportado = r.id;
    resultados.push(r);
  }
  // Regra de cadastro pode ter mudado mesmo sem arquivo novo: sempre reaplica.
  const final = await finalizarImportacao(sb, ultimoImportado);
  return NextResponse.json({ ok: true, listas, arquivos: resultados, ...final });
}
