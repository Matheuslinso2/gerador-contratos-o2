// Último passo do robô do Corp (robo-corp.cmd): confere se algum documento
// do Corp ficou FORA da conta do Power BI (ou contado em dobro) e, se ficou,
// avisa o Matheus por e-mail. A causa real achada em out/2026 foi o nome do
// produtor no Corp diferente do Cadastro de Produtores do SharePoint (espaço
// no fim, nome incompleto) — o Power BI descarta a produção sem avisar.
// Só lê o banco (função corp_conferir_documentos_fora); nunca mexe no
// SharePoint nem no cadastro.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/conferir-cadastro.ts
//        [--desde 2024-01-01] [--simular "NOME DO PRODUTOR"] [--enviar]
// Com --simular, finge que o cadastro tem esse produtor com espaço no fim
// (o caso real de out/2026) e só grava a prévia do e-mail em scripts/robo-corp/saida/alerta-cadastro.html
// (envia de verdade apenas se vier também --enviar).
process.loadEnvFile(".env.local");
import { mkdirSync, writeFileSync } from "node:fs";
import { createServiceClient } from "@/lib/supabase/service";
import { enviarEmail } from "@/lib/email";
import { blocoSecao, envolverEmailO2, formatarData, linhaCampo } from "@/lib/integracoes/emailO2";

const DESTINO = "matheus@o2seguros.com.br";

type DocumentoFora = {
  nosso_numero: number;
  tipo: string;
  numero_endosso: string | null;
  ini_vig: string;
  seg: string | null;
  ramo: string | null;
  numero_apolice: string | null;
  comissao: number | string | null;
  motivo: string;
  produtores: string | null;
  parecidos: string | null;
};

function argumento(nome: string): string | null {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function escapar(t: string) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Explica, em uma frase, por que o nome não casou com o parecido do cadastro.
function diagnostico(produtor: string, parecido: string): string {
  if (parecido === produtor) return "o nome está igual no cadastro (cadastro do Workspace pode estar desatualizado)";
  if (parecido.trim().toUpperCase() === produtor.trim().toUpperCase()) {
    return parecido !== parecido.trim() ? "no cadastro tem espaço no início/fim do nome" : "diferença de maiúsculas/minúsculas";
  }
  return parecido.length < produtor.length ? "no cadastro o nome está incompleto" : "no cadastro o nome está mais longo";
}

function montarHtml(docs: DocumentoFora[], cadastroCopiadoEm: string | null, simulado: string | null) {
  const total = docs.reduce((s, d) => s + Number(d.comissao ?? 0), 0);
  const blocos = docs
    .map((d) => {
      const produtores = d.produtores ?? "";
      const parecidos = [...(d.parecidos ?? "").matchAll(/"([^"]*)"/g)].map((m) => m[1]);
      const nomeCorp = produtores.split("; ")[0] ?? "";
      const dica = parecidos.length
        ? parecidos.map((p) => `"${escapar(p)}" — ${diagnostico(nomeCorp, p)}`).join("<br />")
        : "nenhum nome parecido no cadastro";
      const linhas =
        linhaCampo("Motivo", escapar(d.motivo)) +
        linhaCampo("Produtor no Corp", escapar(produtores)) +
        (d.motivo === "produtor sem cadastro" ? linhaCampo("No Cadastro de Produtores", dica) : "") +
        linhaCampo("Documento", `${escapar(d.seg ?? "")} ${escapar(d.ramo ?? "")} · apólice ${escapar(d.numero_apolice ?? "-")} · ${escapar(d.tipo)}${d.numero_endosso && d.numero_endosso !== "0" ? ` · endosso ${escapar(d.numero_endosso)}` : ""}`) +
        linhaCampo("Início de vigência", formatarData(d.ini_vig)) +
        linhaCampo("Comissão", reais(Number(d.comissao ?? 0)));
      return blocoSecao(`Nosso Nº ${d.nosso_numero}`, linhas);
    })
    .join("");
  const copia = cadastroCopiadoEm
    ? ` O cadastro usado aqui foi copiado do SharePoint em ${new Date(cadastroCopiadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} — se a equipe já corrigiu lá depois disso, o Workspace ainda não viu.`
    : "";
  return envolverEmailO2({
    badge: simulado ? "Simulação — robô do Corp" : "Robô do Corp",
    titulo: `${docs.length} documento(s) do Corp fora da conta do Power BI`,
    introducao:
      `Comissão que deixa de aparecer: ${reais(total)}. O Power BI só conta o documento quando o nome do produtor está escrito exatamente igual no Cadastro de Produtores do SharePoint. Corrigir o nome lá resolve.` +
      copia,
    corpoHtml: blocos,
    protocolo: new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    origem: "Robô do Corp",
  });
}

async function main() {
  const desde = argumento("--desde") ?? "2024-01-01";
  const simular = argumento("--simular");
  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc("corp_conferir_documentos_fora", {
    p_desde: desde,
    p_simular_sem_cadastro: simular,
  });
  if (error) throw error;
  const docs = (data ?? []) as DocumentoFora[];

  const { data: ultima } = await supabase
    .from("corp_regra_produtor")
    .select("sincronizado_em")
    .order("sincronizado_em", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  console.log(`conferência do cadastro (desde ${desde}${simular ? `, simulando "${simular}" sem cadastro` : ""}): ${docs.length} documento(s) fora da conta`);
  for (const d of docs) {
    console.log(`  ${d.ini_vig} Nº ${d.nosso_numero} ${d.seg} ${d.ramo} ${d.tipo} com ${d.comissao} — ${d.motivo}: ${d.produtores}${d.parecidos ? ` | parecido: ${d.parecidos}` : ""}`);
  }
  if (!docs.length) return;

  const html = montarHtml(docs, ultima?.sincronizado_em ?? null, simular);
  const assunto = `${simular ? "[SIMULAÇÃO] " : ""}Robô do Corp — ${docs.length} documento(s) fora do Power BI`;
  if (simular && !process.argv.includes("--enviar")) {
    mkdirSync("scripts/robo-corp/saida", { recursive: true });
    writeFileSync("scripts/robo-corp/saida/alerta-cadastro.html", html);
    console.log(`prévia (não enviada): scripts/robo-corp/saida/alerta-cadastro.html — assunto: ${assunto}`);
    return;
  }
  const r = await enviarEmail({ para: DESTINO, assunto, html, remetente: "Workspace O2 — Robô do Corp" });
  console.log(r.id ? `alerta enviado para ${DESTINO} (${r.id})` : "alerta NÃO enviado (ver erro acima)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
