import { validarPassePanorama } from "@/lib/bitrix/sessaoPanorama";
import { buscarCardPanorama } from "@/lib/bitrix/panoramaFianca";
import { createServiceClient } from "@/lib/supabase/service";
import type { CabecalhoPanorama, FormaPagamento, LinhaPanorama } from "@/lib/panoramaFiancaConstantes";
import Montador, { type VersaoSalva } from "@/app/seguro-fianca/panoramas/[cardId]/Montador";

export const dynamic = "force-dynamic";

// Aba "Panorama" dentro do card do Seguro Fiança no Bitrix (16/10/2026) --
// a MESMA tela de /seguro-fianca/panoramas/[cardId], só que sem login do
// Workspace: quem chega aqui veio de bitrix-app/card-panorama, que conferiu
// o token do Bitrix e emitiu o passe (?p=) amarrado a este card. /bitrix-app
// é público no proxy, então o passe é a única porta de entrada.

function Aviso({ texto }: { texto: string }) {
  return <p className="m-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">{texto}</p>;
}

export default async function PanoramaNoBitrixPage({
  params,
  searchParams,
}: {
  params: Promise<{ cardId: string }>;
  searchParams: Promise<{ p?: string }>;
}) {
  const cardId = Number((await params).cardId);
  const { p: passe } = await searchParams;

  // Dentro do card não tem sentido rodapé do site nem botão do WhatsApp.
  const esconderExtras = (
    <style>{`body > footer, a[aria-label="Fale com a O2 pelo WhatsApp"] { display: none !important; } body { background: #fff; }`}</style>
  );

  if (!Number.isInteger(cardId) || cardId <= 0 || !validarPassePanorama(passe, cardId)) {
    return (
      <>
        {esconderExtras}
        <Aviso texto="Sessão do Panorama expirada ou inválida. Feche e abra de novo a aba Panorama do card." />
      </>
    );
  }

  let card;
  try {
    card = await buscarCardPanorama(cardId);
  } catch (e) {
    return (
      <>
        {esconderExtras}
        <Aviso texto={`Não consegui ler o card ${cardId} no Bitrix: ${(e as Error).message}`} />
      </>
    );
  }

  const { data: versoesDb } = await createServiceClient()
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
      {esconderExtras}
      <main className="space-y-4 p-4">
        <p className="text-sm text-gray-500">
          Panorama de preços · {card.cabecalho.inquilino} · {card.cabecalho.imobiliaria || "sem imobiliária"} · {card.etapa}
        </p>
        <Montador card={card} versoes={versoes} passeBitrix={passe} />
      </main>
    </>
  );
}
