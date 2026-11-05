import type { SupabaseClient } from "@supabase/supabase-js";
import { dataBr, type DadosPanorama } from "@/lib/campanhas/panoramaCampanha";

// Imagens das parciais para mandar também por WhatsApp da imobiliária (04/11/2026): além do e-mail, a
// equipe baixa o mesmo panorama que foi (ou vai) no e-mail. Mostra a versão mais recente de cada
// participante, enviada ou ainda em prévia. O download é de uso interno e não conta como parcial lida.
type Linha = { participante_id: string; nome: string; versao: number; status: string; token: string; enviado_em: string | null; dados: DadosPanorama };

export default async function ParciaisParaWhatsApp({ campanhaId, db }: { campanhaId: string; db: SupabaseClient }) {
  const { data } = await db
    .from("campanhas_panoramas")
    .select("participante_id, nome, versao, status, token, enviado_em, dados")
    .eq("campanha_id", campanhaId)
    .in("status", ["enviada", "previa"])
    .order("versao", { ascending: false })
    .order("created_at", { ascending: false });
  const maisRecente = new Map<string, Linha>();
  for (const l of (data ?? []) as Linha[]) if (!maisRecente.has(l.participante_id)) maisRecente.set(l.participante_id, l);
  const linhas = [...maisRecente.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  if (!linhas.length) return null;

  return (
    <details className="rounded-xl border border-gray-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-semibold text-o2-navy">
        Imagens das parciais para WhatsApp ({linhas.length})
        <span className="ml-2 text-xs font-normal text-gray-500">baixe o panorama de cada imobiliária para enviar também pelo WhatsApp dela</span>
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b text-gray-500">
              <th className="py-1 pr-3">Imobiliária</th>
              <th className="py-1 pr-3">Parcial</th>
              <th className="py-1 pr-3">Posição em</th>
              <th className="py-1 pr-3">Situação</th>
              <th className="py-1">Imagem</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.participante_id} className="border-b last:border-0">
                <td className="py-1 pr-3 font-medium text-o2-navy">{l.nome}</td>
                <td className="py-1 pr-3">nº {l.versao}</td>
                <td className="py-1 pr-3 whitespace-nowrap">{dataBr(l.dados.posicaoEm)}</td>
                <td className="py-1 pr-3">{l.status === "enviada" ? `Enviada por e-mail${l.enviado_em ? ` em ${dataBr(l.enviado_em.slice(0, 10))}` : ""}` : "Prévia (ainda não enviada)"}</td>
                <td className="py-1 whitespace-nowrap">
                  <a href={`/api/campanhas/panorama/${l.token}?baixar=1`} className="font-medium text-o2-coral hover:underline">
                    Baixar imagem
                  </a>
                  <span className="px-1 text-gray-300">·</span>
                  <a href={`/api/campanhas/panorama/${l.token}?interno=1`} target="_blank" rel="noreferrer" className="text-o2-navy hover:underline">
                    abrir
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
