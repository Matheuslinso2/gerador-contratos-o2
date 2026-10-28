import { createServiceClient } from "@/lib/supabase/service";
import { validarPasseCard } from "@/lib/bitrix/sessaoPanorama";
import { buscarApolicesMae, chavePasseApoliceMae, funilDaEntidade, lerCardEndosso } from "@/lib/bitrix/apoliceMae";
import EscolherApolice from "./EscolherApolice";

export const dynamic = "force-dynamic";

// Aba "Apólice-mãe" dentro dos cards de endosso do Bitrix (28/10/2026). Quem
// chega aqui veio de bitrix-app/card-apolice-mae, que conferiu o token do
// Bitrix e emitiu o passe (?p=) amarrado a esta entidade + card.

function Aviso({ texto }: { texto: string }) {
  return <p className="m-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">{texto}</p>;
}

const esconderExtras = (
  <style>{`body > footer, a[aria-label="Fale com a O2 pelo WhatsApp"] { display: none !important; } body { background: #fff; }`}</style>
);

export default async function ApoliceMaePage({
  params,
  searchParams,
}: {
  params: Promise<{ entidade: string; cardId: string }>;
  searchParams: Promise<{ p?: string; q?: string; imovel?: string; todas?: string }>;
}) {
  const { entidade: ent, cardId: id } = await params;
  const entidade = Number(ent);
  const cardId = Number(id);
  const { p: passe, q = "", imovel = "", todas } = await searchParams;
  const funil = funilDaEntidade(entidade);

  if (!funil || !Number.isInteger(cardId) || cardId <= 0 || !passe || !validarPasseCard(passe, chavePasseApoliceMae(entidade, cardId))) {
    return (
      <>
        {esconderExtras}
        <Aviso texto="Sessão expirada ou inválida. Feche e abra de novo a aba Apólice-mãe do card." />
      </>
    );
  }

  const sb = createServiceClient();
  let card;
  try {
    card = await lerCardEndosso(sb, funil, cardId);
  } catch (e) {
    return (
      <>
        {esconderExtras}
        <Aviso texto={`Não consegui ler o card ${cardId} no Bitrix: ${(e as Error).message}`} />
      </>
    );
  }
  if (!card.ehEndosso) {
    return (
      <>
        {esconderExtras}
        <Aviso texto="Esta aba serve para os cards dos funis de endosso. Este card está em outro funil." />
      </>
    );
  }

  const soDaImobiliaria = todas !== "1" && !!card.imobiliariaNome;
  // Primeira abertura sem busca: usa o nº que já está no card, se houver.
  const busca = q || (!imovel && card.numeroAtual ? card.numeroAtual : "");
  let resultados: Awaited<ReturnType<typeof buscarApolicesMae>> = [];
  let erro: string | null = null;
  try {
    resultados = await buscarApolicesMae(sb, funil, card, { busca, imovel, soDaImobiliaria });
  } catch (e) {
    erro = e instanceof Error ? e.message : "Falha na busca.";
  }

  return (
    <>
      {esconderExtras}
      <main className="space-y-3 p-4 text-o2-navy">
        <div>
          <h1 className="text-base font-semibold">Apólice-mãe do endosso · {funil.produto}</h1>
          <p className="text-xs text-gray-500">
            {card.titulo} · {card.imobiliariaNome ?? "sem imobiliária ligada"} · {funil.rotuloCampo} no card:{" "}
            <b>{card.numeroAtual || "em branco"}</b>
          </p>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2 rounded-xl border border-o2-navy/10 bg-quadro p-3">
          <input type="hidden" name="p" value={passe} />
          <label className="min-w-[220px] flex-1 text-xs text-gray-600">
            Nº da apólice, nome do segurado/locatário ou CPF/CNPJ
            <input name="q" defaultValue={busca} className="mt-0.5 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
          </label>
          <label className="min-w-[180px] flex-1 text-xs text-gray-600">
            Endereço ou CEP do imóvel
            <input name="imovel" defaultValue={imovel} className="mt-0.5 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
          </label>
          {card.imobiliariaNome && (
            <label className="flex items-center gap-1.5 pb-1.5 text-xs text-gray-600">
              <input type="checkbox" name="todas" value="1" defaultChecked={!soDaImobiliaria} />
              Buscar em todas as imobiliárias
            </label>
          )}
          <button className="rounded-full bg-o2-coral px-4 py-1.5 text-sm font-medium text-white">Buscar</button>
        </form>
        <p className="text-[11px] text-gray-500">
          Mostra apólices {funil.entityTypeId === 1048 ? "(títulos) " : ""}vigentes e as vencidas nos últimos 12 meses, da base do ERP (espelho do Corp)
          {soDaImobiliaria ? `, só da imobiliária ${card.imobiliariaNome}` : ""}.
        </p>
        {erro && <Aviso texto={erro} />}
        <EscolherApolice entidade={entidade} cardId={cardId} passe={passe} resultados={resultados} numeroAtual={card.numeroAtual} buscou={!!(busca || imovel || soDaImobiliaria)} />
      </main>
    </>
  );
}
