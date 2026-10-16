import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import { IconShield } from "@/components/icons";
import {
  ETAPAS_MONTAR,
  INICIO_FILA_PANORAMA,
  listarCardsFila,
  listarCardsRecusados,
  cardsComRecusaRegistrada,
  temSeguradoraAprovada,
  type CardPanorama,
} from "@/lib/bitrix/panoramaFianca";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Fila do Panorama de Preços (Fase 1 -- 15/10/2026). Abas de envio
// ("Gerados não enviados"/"Enviados") entram na Fase 2.
type Aba = "montar" | "atualizar" | "gerados" | "recusados";
const ABAS: { chave: Aba; rotulo: string }[] = [
  { chave: "montar", rotulo: "A montar" },
  { chave: "atualizar", rotulo: "Atualização disponível" },
  { chave: "gerados", rotulo: "Gerados" },
  // Cards todo recusados ainda sem o e-mail de recusa (16/10/2026).
  { chave: "recusados", rotulo: "Recusados (avisar)" },
];

// Minúsculas e sem acento -- "joão" acha "JOAO" e vice-versa.
function normalizar(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function tempoDesde(iso: string): string {
  const horas = Math.max(0, (Date.now() - new Date(iso).getTime()) / 36e5);
  if (horas < 1) return "menos de 1h";
  if (horas < 48) return `${Math.floor(horas)}h`;
  return `${Math.floor(horas / 24)} dias`;
}

export default async function PanoramasPage({ searchParams }: { searchParams: Promise<{ aba?: string; card?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const { aba: abaParam, card: buscaCard } = await searchParams;
  // Atalho: digitou o nº do card -> vai direto pra montagem (vale pra card
  // fora da fila também, ex: etapa diferente das previstas).
  if (buscaCard && /^\d+$/.test(buscaCard.trim())) redirect(`/seguro-fianca/panoramas/${buscaCard.trim()}`);
  // Texto = busca pelo nome do inquilino (pedido do Matheus 16/10/2026), em
  // todos os cards das etapas do panorama, sem depender de aba/corte de data.
  const busca = normalizar(buscaCard ?? "");
  const aba: Aba = ABAS.some((a) => a.chave === abaParam) ? (abaParam as Aba) : "montar";

  let cards: CardPanorama[] = [];
  let recusados: CardPanorama[] = [];
  let erro: string | null = null;
  try {
    [cards, recusados] = await Promise.all([listarCardsFila(), listarCardsRecusados()]);
  } catch (e) {
    erro = (e as Error).message;
  }

  // Recusa já avisada (e-mail tipo "recusado" enviado pelo panorama) sai da aba.
  const { data: recusasEnviadas } = recusados.length
    ? await supabase
        .from("panoramas_fianca_envios")
        .select("card_id")
        .eq("tipo", "recusado")
        .in("card_id", recusados.map((c) => c.id))
    : { data: [] };
  const recusaAvisada = new Set((recusasEnviadas ?? []).map((r) => r.card_id));
  try {
    for (const id of await cardsComRecusaRegistrada(recusados.map((c) => c.id))) recusaAvisada.add(id);
  } catch (e) {
    console.warn("Não consegui conferir recusas já registradas no Bitrix:", e);
  }

  const { data: versoes } = cards.length
    ? await supabase
        .from("panoramas_fianca")
        .select("card_id, versao, assinatura_status, gerado_em, gerado_por_email")
        .in("card_id", cards.map((c) => c.id))
        .order("versao", { ascending: false })
    : { data: [] };

  const ultimaPorCard = new Map<number, { versao: number; assinatura_status: string; gerado_em: string; gerado_por_email: string }>();
  for (const v of versoes ?? []) if (!ultimaPorCard.has(v.card_id)) ultimaPorCard.set(v.card_id, v);

  const classificados = cards
    .filter(temSeguradoraAprovada)
    .map((c) => {
      const ultima = ultimaPorCard.get(c.id);
      const grupo: Aba | null = ultima
        ? ultima.assinatura_status !== c.assinaturaStatus
          ? "atualizar"
          : "gerados"
        : ETAPAS_MONTAR.includes(c.etapaId) && new Date(c.movidoEm) >= new Date(INICIO_FILA_PANORAMA)
          ? "montar"
          : null;
      return { card: c, ultima, grupo: grupo as Aba | null };
    })
    .filter((x) => x.grupo !== null)
    .concat(
      recusados
        .filter((c) => !recusaAvisada.has(c.id))
        .map((c) => ({ card: c, ultima: undefined, grupo: "recusados" as Aba }))
    );
  const contagem = Object.fromEntries(ABAS.map((a) => [a.chave, classificados.filter((x) => x.grupo === a.chave).length]));
  // Mais antigos primeiro -- quem está esperando há mais tempo é atendido antes.
  const lista = (
    busca
      ? [...cards, ...recusados.filter((r) => !cards.some((c) => c.id === r.id))]
          .filter((c) => normalizar(c.cabecalho.inquilino).includes(busca))
          .map((c) => ({
            card: c,
            ultima: ultimaPorCard.get(c.id),
            grupo: classificados.find((x) => x.card.id === c.id)?.grupo ?? null,
          }))
      : classificados.filter((x) => x.grupo === aba)
  ).sort((a, b) => new Date(a.card.movidoEm).getTime() - new Date(b.card.movidoEm).getTime());

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-7xl px-4 py-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PageHeader
            icon={<IconShield />}
            titulo="Panoramas de preços — Seguro Fiança"
            subtitulo="Cards com pelo menos uma seguradora aprovada ou pré-aprovada. Busque pelo nº do card ou pelo nome do inquilino."
          />
          <form className="flex items-center gap-2" action="/seguro-fianca/panoramas">
            <input
              name="card"
              defaultValue={busca ? buscaCard : ""}
              placeholder="Nº do card ou nome do inquilino"
              className="w-72 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            />
            <button className="rounded-lg bg-o2-navy px-3 py-1.5 text-sm font-semibold text-white">Buscar</button>
          </form>
        </div>

        <nav className="flex gap-2 border-b border-gray-200">
          {ABAS.map((a) => (
            <Link
              key={a.chave}
              href={`/seguro-fianca/panoramas?aba=${a.chave}`}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                aba === a.chave ? "border-o2-coral font-semibold text-o2-navy" : "border-transparent text-gray-500"
              }`}
            >
              {a.rotulo} <span className="ml-1 rounded-full bg-gray-100 px-2 text-xs">{contagem[a.chave]}</span>
            </Link>
          ))}
        </nav>

        {busca && !erro && (
          <p className="text-sm text-gray-600">
            {lista.length} card(s) com &ldquo;{buscaCard}&rdquo; no nome do inquilino.{" "}
            <Link href={`/seguro-fianca/panoramas?aba=${aba}`} className="text-o2-navy underline">
              Limpar busca
            </Link>
          </p>
        )}
        {erro ? (
          <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">Erro ao ler o Bitrix: {erro}</p>
        ) : lista.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">{busca ? "Nenhum inquilino encontrado." : "Nenhum card nesta aba."}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2">Card</th>
                  <th className="px-3 py-2">Inquilino</th>
                  <th className="px-3 py-2">Imobiliária</th>
                  <th className="px-3 py-2">Etapa</th>
                  <th className="px-3 py-2">Cotador</th>
                  <th className="px-3 py-2">Na etapa há</th>
                  <th className="px-3 py-2">Aprovadas</th>
                  <th className="px-3 py-2">Última versão</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {lista.map(({ card, ultima, grupo }) => (
                  <tr key={card.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-mono text-xs">{card.id}</td>
                    <td className="px-3 py-2 font-medium text-o2-navy">{card.cabecalho.inquilino}</td>
                    <td className="px-3 py-2">{card.cabecalho.imobiliaria || "—"}</td>
                    <td className="px-3 py-2">{card.etapa}</td>
                    <td className="px-3 py-2">{card.responsavel || "—"}</td>
                    <td className="px-3 py-2">{tempoDesde(card.movidoEm)}</td>
                    <td className="px-3 py-2">
                      {card.linhas.filter((l) => l.status === "aprovado" || l.status === "pre_aprovado").length}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {ultima ? `v${ultima.versao} · ${new Date(ultima.gerado_em).toLocaleDateString("pt-BR")}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/seguro-fianca/panoramas/${card.id}`}
                        className="rounded-lg bg-o2-coral px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        {grupo === "montar" ? "Montar" : grupo === "atualizar" ? "Atualizar" : grupo === "recusados" ? "Avisar recusa" : "Abrir"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
