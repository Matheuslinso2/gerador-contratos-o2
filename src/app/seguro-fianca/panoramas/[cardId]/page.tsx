import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconShield } from "@/components/icons";
import { buscarCardPanorama } from "@/lib/bitrix/panoramaFianca";
import type { CabecalhoPanorama, FormaPagamento, LinhaPanorama } from "@/lib/panoramaFiancaConstantes";
import Montador, { type VersaoSalva } from "./Montador";

export const dynamic = "force-dynamic";

export default async function MontarPanoramaPage({ params }: { params: Promise<{ cardId: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const cardId = Number((await params).cardId);
  if (!Number.isInteger(cardId) || cardId <= 0) redirect("/seguro-fianca/panoramas");

  let card;
  let erro: string | null = null;
  try {
    card = await buscarCardPanorama(cardId);
  } catch (e) {
    erro = (e as Error).message;
  }

  const { data: versoesDb } = await supabase
    .from("panoramas_fianca")
    .select("versao, cabecalho, linhas, forma_pagamento, assinatura_status, gerado_por_email, gerado_em")
    .eq("card_id", cardId)
    .order("versao", { ascending: false });

  const versoes: VersaoSalva[] = (versoesDb ?? []).map((v) => ({
    versao: v.versao,
    cabecalho: v.cabecalho as CabecalhoPanorama,
    linhas: v.linhas as LinhaPanorama[],
    formaPagamento: v.forma_pagamento as FormaPagamento,
    assinaturaStatus: v.assinatura_status,
    geradoPor: v.gerado_por_email,
    geradoEm: v.gerado_em,
  }));

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-7xl px-4 py-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PageHeader
            icon={<IconShield />}
            titulo={`Panorama de preços — card ${cardId}`}
            subtitulo={card ? `${card.cabecalho.inquilino} · ${card.cabecalho.imobiliaria || "sem imobiliária"} · ${card.etapa}` : undefined}
          />
          <Link href="/seguro-fianca/panoramas" className="text-sm text-o2-navy underline">
            ← Voltar para a fila
          </Link>
        </div>

        {erro || !card ? (
          <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Não consegui ler o card {cardId} no Bitrix. {erro}
          </p>
        ) : (
          <Montador card={card} versoes={versoes} />
        )}
      </main>
    </>
  );
}
