// Carga do Corp a partir de arquivos BAIXADOS do SharePoint "O2 Data Analytics"
// (enquanto o acesso automático do Workspace ao SharePoint não está liberado,
// e para a carga inicial). Faz o mesmo que o cron /api/cron/corp-sharepoint.
// uso: npx tsx scripts/corp-sharepoint/carregar-local.ts <pasta> [--forcar]
//   <pasta> com: cidades_padronizadas.xlsx, clientes_com_documentos.xlsx,
//   grade_prods_*.xlsx, sinistros_grade.xlsx e sp_listas.json (listas do SharePoint).
process.loadEnvFile(".env.local");

import fs from "node:fs";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";
import { finalizarImportacao, importarArquivo, sincronizarListas, type ArquivoCorp, type TipoArquivo } from "@/lib/corpSharepoint/gravar";

const PASTAS: Record<TipoArquivo, string> = {
  cidades: "00. BASES AUXILIARES",
  clientes: "CORP_02.05 - Clientes com Documentos",
  grade: "CORP_01.02 - Propostas Grade por Produtor",
  sinistros: "CORP_05.02 - Sinistros Geral Grade",
};

function tipoDoArquivo(nome: string): { tipo: TipoArquivo; nome: string } | null {
  if (/^cidades_padronizadas/i.test(nome)) return { tipo: "cidades", nome: "cidades_padronizadas.xlsx" };
  if (/^clientes/i.test(nome)) return { tipo: "clientes", nome: "Clientes Com Documentos.xlsx" };
  if (/^grade_prods_/i.test(nome)) return { tipo: "grade", nome };
  if (/^sinistros_grade/i.test(nome)) return { tipo: "sinistros", nome: "sinistros_grade.xlsx" };
  return null;
}

const ORDEM: TipoArquivo[] = ["cidades", "clientes", "grade", "sinistros"];

async function main() {
  const pasta = process.argv[2];
  const forcar = process.argv.includes("--forcar");
  if (!pasta) throw new Error("informe a pasta com os arquivos");
  const sb = createServiceClient();

  const listas = path.join(pasta, "sp_listas.json");
  if (fs.existsSync(listas)) {
    const j = JSON.parse(fs.readFileSync(listas, "utf8"));
    const r = await sincronizarListas(sb, {
      produtores: j.d_CadastroProdutor, ramos: j.d_Ramo, seguradoras: j.d_Seguradora,
      metas: j.f_MetasComCorretora, analises: j.f_AnaliseRecusado,
    });
    console.log("listas:", r);
  }

  const arquivos = fs.readdirSync(pasta)
    .map((f) => ({ f, t: tipoDoArquivo(f) }))
    .filter((x): x is { f: string; t: NonNullable<ReturnType<typeof tipoDoArquivo>> } => !!x.t)
    .sort((a, b) => ORDEM.indexOf(a.t.tipo) - ORDEM.indexOf(b.t.tipo) || a.f.localeCompare(b.f));

  for (const { f, t } of arquivos) {
    const t0 = Date.now();
    const a: ArquivoCorp = {
      tipo: t.tipo, nome: t.nome, pasta: PASTAS[t.tipo], origem: "arquivo_local",
      // data do arquivo baixado não é a do SharePoint — fica em branco (o cron grava a verdadeira)
      modificadoEm: null,
      conteudo: new Uint8Array(fs.readFileSync(path.join(pasta, f))),
    };
    const r = await importarArquivo(sb, a, forcar);
    console.log(`${r.status.padEnd(12)} ${t.nome} ${r.linhas ?? ""} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }

  const t0 = Date.now();
  console.log("finalizar:", JSON.stringify(await finalizarImportacao(sb, null)), `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
