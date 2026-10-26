import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { lerFiltros, limitesMes } from "@/lib/erp/filtros";

export const dynamic = "force-dynamic";

// Lista das parcelas com vencimento divergente para a equipe corrigir no Corp (CSV com ; e vírgula decimal, abre no Excel).
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) return new Response("não autorizado", { status: 401 });
  const f = lerFiltros(Object.fromEntries(request.nextUrl.searchParams.entries()));
  let q = supabase.from("erp_vencimentos_pronto").select("nosso_numero, nosso_numero_corp, seguradora, apolice, imobiliaria, parcela_n, parcelas_total, venc_corp, venc_seguradora, dif_meses, comissao_prevista");
  if (f.seguradora) q = q.eq("seguradora", f.seguradora);
  if (f.imobiliaria) q = q.ilike("imobiliaria", `%${f.imobiliaria.replace(/[%_,()]/g, "")}%`);
  if (f.mes) {
    const m = limitesMes(f.mes);
    q = q.gte("venc_seguradora", m.de).lte("venc_seguradora", m.ate);
  }
  const { data } = await q.order("nosso_numero_corp").order("parcela_n").limit(20000);
  const br = (d: string | null) => (d ? d.split("-").reverse().join("/") : "");
  const linhas = [
    "Código O2;Nosso Nº Corp;Seguradora;Apólice;Imobiliária;Parcela;Vencimento no Corp;Vencimento correto (seguradora);Diferença (meses);Comissão prevista",
    ...(data ?? []).map((l) =>
      [l.nosso_numero, l.nosso_numero_corp ?? "", l.seguradora, l.apolice, `"${(l.imobiliaria ?? "").replace(/"/g, "'")}"`, `${l.parcela_n}${l.parcelas_total ? `/${l.parcelas_total}` : ""}`, br(l.venc_corp), br(l.venc_seguradora), l.dif_meses, String(l.comissao_prevista ?? "").replace(".", ",")].join(";")
    ),
  ];
  return new Response("﻿" + linhas.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="vencimentos-divergentes${f.mes ? "-" + f.mes : ""}.csv"` },
  });
}
