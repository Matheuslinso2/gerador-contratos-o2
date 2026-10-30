import { createServiceClient } from "@/lib/supabase/service";
import { validarPasseCard } from "@/lib/bitrix/sessaoPanorama";
import { buscarDesempenhoDoCard } from "@/lib/bitrix/desempenhoNoCard";
import { ENTITY_TYPE_ID_DEAL } from "@/lib/bitrix/entidadesCard";
import { chavePasseCampanha, lerPanoramaDoCard } from "@/lib/campanhas/panoramaDoCard";
import { dataBr, formatarValor } from "@/lib/campanhas/panoramaCampanha";
import Acompanhamento from "./Acompanhamento";

export const dynamic = "force-dynamic";

// Aba "Panorama da campanha" dentro do card do funil Campanhas no Bitrix
// (30/10/2026): posição de hoje, parciais já enviadas (cada uma é a imagem que a
// imobiliária recebeu) e as anotações da equipe. Quem chega aqui veio de
// bitrix-app/card-campanha, que conferiu o token do Bitrix e emitiu o passe (?p=).

const esconderExtras = (
  <style>{`body > footer, a[aria-label="Fale com a O2 pelo WhatsApp"] { display: none !important; } body { background: #fff; }`}</style>
);

function Aviso({ texto }: { texto: string }) {
  return (
    <>
      {esconderExtras}
      <p className="m-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">{texto}</p>
    </>
  );
}

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—");

function Numero({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 px-3 py-2">
      <p className="text-xs text-gray-500">{rotulo}</p>
      <p className={`text-lg font-bold ${destaque ? "text-o2-coral" : "text-o2-navy"}`}>{valor}</p>
    </div>
  );
}

export default async function PanoramaCampanhaCard({ params, searchParams }: { params: Promise<{ cardId: string }>; searchParams: Promise<{ p?: string }> }) {
  const { cardId: id } = await params;
  const cardId = Number(id);
  const { p: passe } = await searchParams;
  if (!Number.isInteger(cardId) || cardId <= 0 || !passe || !validarPasseCard(passe, chavePasseCampanha(cardId))) {
    return <Aviso texto="Sessão expirada ou inválida. Feche e abra de novo a aba Panorama da campanha do card." />;
  }

  const db = createServiceClient();
  const [panorama, hoje] = await Promise.all([lerPanoramaDoCard(db, cardId), buscarDesempenhoDoCard(ENTITY_TYPE_ID_DEAL, cardId)]);
  if (!panorama) {
    return <Aviso texto="Este card não está ligado a nenhuma campanha do Workspace. O panorama aparece nos cards criados ou ligados pela área Campanhas." />;
  }

  const ultima = panorama.versoes[panorama.versoes.length - 1] ?? null;
  const pct = hoje?.percentual ? Math.max(0, Math.min(100, parseInt(hoje.percentual, 10) || 0)) : null;
  const teto = Math.max(1, ...panorama.versoes.map((v) => Math.max(v.dados.realizado, v.dados.meta ?? 0)));

  return (
    <>
      {esconderExtras}
      <main className="space-y-5 p-4 text-o2-navy">
        <div>
          <h1 className="text-base font-semibold">Panorama da campanha · {panorama.campanhaNome}</h1>
          <p className="text-xs text-gray-500">
            {panorama.imobiliariaNome}
            {panorama.inicio && panorama.fim ? ` · campanha de ${dataBr(panorama.inicio)} a ${dataBr(panorama.fim)}` : ""} ·{" "}
            <a href={`/campanhas/${panorama.campanhaId}`} target="_blank" rel="noreferrer" className="text-o2-coral hover:underline">
              abrir a campanha no Workspace
            </a>
          </p>
        </div>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Posição de hoje</h2>
          {hoje ? (
            <>
              {pct !== null && (
                <div>
                  <div className="h-3 w-full rounded-full bg-gray-200">
                    <div className="h-3 rounded-full bg-o2-coral" style={{ width: `${Math.max(pct, 2)}%` }} />
                  </div>
                  <p className="mt-1 text-xs font-semibold">{pct}% da meta</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Numero rotulo="Meta" valor={hoje.meta ?? "ainda não definida"} />
                <Numero rotulo="Realizado" valor={hoje.realizado ?? "—"} destaque />
                <Numero rotulo="Faltam" valor={hoje.faltam ?? "—"} />
                <Numero rotulo="Dias até o fim" valor={hoje.diasRestantes ?? "—"} />
              </div>
              <p className="text-xs text-gray-500">
                {Number(hoje.cotacoesAbertas) > 0 ? `${hoje.cotacoesAbertas} cotação(ões) em andamento · ` : ""}Posição em {hoje.posicaoEm} (o painel atualiza a cada 10 minutos).
              </p>
            </>
          ) : (
            <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
              A posição de hoje ainda não está disponível para este card (o painel leva até 10 minutos para incluir cards novos).
              {ultima ? ` Última parcial enviada: ${formatarValor(ultima.dados.realizado, ultima.dados.moeda)} de ${ultima.dados.meta ? formatarValor(ultima.dados.meta, ultima.dados.moeda) : "meta não definida"}.` : ""}
            </p>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Parciais enviadas à imobiliária</h2>
          {panorama.versoes.length === 0 ? (
            <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
              Nenhuma parcial foi enviada ainda. Use &quot;Enviar parciais&quot; na campanha, no Workspace: cada envio aparece aqui com a imagem que a imobiliária recebeu.
            </p>
          ) : (
            <>
              <div className="flex items-end gap-3 overflow-x-auto pb-1">
                {panorama.versoes.map((v) => (
                  <div key={v.id} className="flex flex-col items-center">
                    <span className="text-xs font-semibold">{formatarValor(v.dados.realizado, v.dados.moeda)}</span>
                    <div className="mt-1 w-12 rounded-md bg-o2-coral" style={{ height: `${Math.max(6, Math.round((v.dados.realizado / teto) * 80))}px` }} />
                    <span className="mt-1 text-[11px] text-gray-500">{dataBr(v.dados.posicaoEm).slice(0, 5)}</span>
                  </div>
                ))}
              </div>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b text-gray-500">
                    <th className="py-1 pr-3">Parcial</th>
                    <th className="py-1 pr-3">Posição em</th>
                    <th className="py-1 pr-3 text-right">Realizado</th>
                    <th className="py-1 pr-3 text-right">% da meta</th>
                    <th className="py-1 pr-3 text-right">Faltavam</th>
                    <th className="py-1 pr-3">Enviada em</th>
                    <th className="py-1 text-right">Imagem</th>
                  </tr>
                </thead>
                <tbody>
                  {[...panorama.versoes].reverse().map((v) => (
                    <tr key={v.id} className="border-b last:border-0">
                      <td className="py-1 pr-3 font-semibold">nº {v.versao}</td>
                      <td className="py-1 pr-3">{dataBr(v.dados.posicaoEm)}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{formatarValor(v.dados.realizado, v.dados.moeda)}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{v.dados.percentual === null ? "—" : `${Math.round(v.dados.percentual)}%`}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{v.dados.faltam === null ? "—" : formatarValor(v.dados.faltam, v.dados.moeda)}</td>
                      <td className="py-1 pr-3">{quando(v.enviadoEm)}</td>
                      <td className="py-1 text-right">
                        <a href={`/api/campanhas/panorama/${v.token}`} target="_blank" rel="noreferrer" className="text-o2-coral hover:underline">
                          ver
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ultima && (
                <details>
                  <summary className="cursor-pointer text-xs font-medium text-o2-navy">Ver o panorama enviado por último (parcial nº {ultima.versao})</summary>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/campanhas/panorama/${ultima.token}`} alt={`Panorama enviado, parcial ${ultima.versao}`} className="mt-2 w-full max-w-xl rounded-lg border border-gray-200" loading="lazy" />
                </details>
              )}
            </>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Acompanhamento da equipe</h2>
          <Acompanhamento
            cardId={cardId}
            passe={passe}
            proximaAcaoInicial={panorama.proximaAcao ?? ""}
            observacaoInicial={panorama.observacao ?? ""}
            ultimaEdicao={panorama.atualizadoPor ? `${panorama.atualizadoPor} em ${quando(panorama.atualizadoEm)}` : null}
          />
        </section>
      </main>
    </>
  );
}
