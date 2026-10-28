import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";

// Lista pronta para o financeiro lançar a baixa no Corp (até a baixa automática existir).
// Só linhas de extratos com baixa APROVADA, na ordem Seguradora → Nosso Nº → Parcela. Vai tudo o que o InCorp do Corp
// aceita (apólices e endossos/estornos, inclusive divergentes — a baixa no Corp é pelo bruto e tem de bater com o extrato);
// ficam de fora só as "não encontradas" (= linhas amarelas do InCorp: pendência de cadastro/emissão).
// Tokio/Porto/Pottencial/Too: lançar pelo InCorp com o arquivo original; as demais à mão (Consulta de Documentos).
// CSV com ";" e vírgula decimal (abre direto no Excel em português). ?mes=AAAA-MM  ?pendentes_corp=1

type Linha = {
  corretora: string | null; seguradora: string | null; mes: string; nosso_numero_corp: number | null; codigo_o2: number | null;
  apolice: string | null; parcela: number | null; cliente: string | null; premio: number | null; pct_doc: number | null; pct_recebido: number | null;
  valor_baixar: number | null; data_recebimento: string | null; previsao_repasse: string | null; conferencia: string; motivo_auto: string | null; como_lancar: string;
  ja_baixada_corp: boolean; baixa_aprovada_em: string | null; baixa_aprovada_por_email: string | null; arquivo_path: string | null;
};

const ROTULO: Record<string, string> = { cheia: "cheia", pro_labore_direto: "pró-labore conferido", estorno: "estorno/endosso", divergente: "divergente (conferir)" };
const num = (v: number | null) => (v == null ? "" : Number(v).toFixed(2).replace(".", ","));
const data = (v: string | null) => (v ? v.slice(0, 10).split("-").reverse().join("/") : "");
const cel = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const url = new URL(request.url);
  const mes = url.searchParams.get("mes");
  const soPendentesCorp = url.searchParams.get("pendentes_corp") === "1";

  const linhas: Linha[] = [];
  for (let de = 0; ; de += 1000) {
    let q = supabase
      .from("erp_baixa_assistida_lista_corp")
      .select("*")
      .order("seguradora")
      .order("nosso_numero_corp", { nullsFirst: false })
      .order("parcela")
      .range(de, de + 999);
    if (mes && /^\d{4}-\d{2}$/.test(mes)) q = q.eq("mes", `${mes}-01`);
    if (soPendentesCorp) q = q.eq("ja_baixada_corp", false);
    const { data: pagina, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    linhas.push(...((pagina ?? []) as Linha[]));
    if (!pagina || pagina.length < 1000) break;
  }

  const cabecalho = [
    "Seguradora", "Nosso nº do Corp", "Parcela", "Nº da apólice", "Cliente", "Prêmio (base)", "% comissão documento", "% pago",
    "Valor a baixar (bruto)", "Data de recebimento", "Previsão de repasse", "Classificação", "Observação", "Já baixada no Corp?", "Como lançar",
    "Corretora", "Competência", "Código O2 do documento", "Aprovado por", "Aprovado em", "Arquivo do extrato",
  ];
  const corpo = linhas.map((l) =>
    [
      l.seguradora, l.nosso_numero_corp, l.parcela, l.apolice, l.cliente, num(l.premio), num(l.pct_doc), num(l.pct_recebido),
      num(l.valor_baixar), data(l.data_recebimento), data(l.previsao_repasse),
      ROTULO[l.conferencia] ?? l.conferencia, l.motivo_auto, l.ja_baixada_corp ? "sim" : "não", l.como_lancar,
      l.corretora, l.mes?.slice(0, 7), l.codigo_o2, l.baixa_aprovada_por_email,
      l.baixa_aprovada_em ? new Date(l.baixa_aprovada_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "", l.arquivo_path,
    ].map(cel).join(";"),
  );
  const total = linhas.reduce((s, l) => s + Number(l.valor_baixar ?? 0), 0);
  corpo.push(["TOTAL", "", "", "", `${linhas.length} linha(s)`, "", "", "", num(total)].map(cel).join(";"));

  const csv = "﻿" + [cabecalho.map(cel).join(";"), ...corpo].join("\r\n");
  const nome = `baixa-comissao-para-corp${mes ? `-${mes}` : ""}${soPendentesCorp ? "-pendentes" : ""}.csv`;
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nome}"`, "Cache-Control": "no-store" },
  });
}
