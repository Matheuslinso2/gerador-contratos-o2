import type { SupabaseClient } from "@supabase/supabase-js";
import { previaCriacaoCards, resumoDosCards } from "@/lib/campanhas/cardsBitrix";
import { ConfirmarDisparoButton } from "./ConfirmarDisparoButton";
import { alternarCriarCardsBitrix, criarCardsAgora, ligarCardsExistentes } from "./cardsActions";

type CampanhaCards = {
  id: string;
  nome: string;
  status: string;
  valido_de: string | null;
  valido_ate: string | null;
  imobiliarias_selecionadas: string[] | null;
  criar_cards_bitrix: boolean;
  cards_bitrix_ativado_por: string | null;
};

// Seção "Cards no funil Campanhas (Bitrix)" da tela da campanha (30/10/2026).
// Desligada por padrão. Ligar não cria nada na hora: os cards nascem quando os
// e-mails iniciais saem (ou no botão "Criar agora"). Campanhas que já tinham
// cards só ligam os existentes, sem criar.
export default async function CardsBitrixSecao({ campanha, db }: { campanha: CampanhaCards; db: SupabaseClient }) {
  const ligado = campanha.criar_cards_bitrix;
  const emitida = campanha.status === "enviando" || campanha.status === "concluida";
  const [resumo, previa] = await Promise.all([resumoDosCards(db, campanha.id), ligado ? previaCriacaoCards(db, campanha) : Promise.resolve(null)]);

  return (
    <section id="cards-bitrix" className="space-y-3 rounded-2xl border border-o2-navy/10 bg-quadro p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-o2-navy">Cards no funil Campanhas (Bitrix)</h2>
      <p className="text-xs text-gray-500">
        Cada card é uma imobiliária dentro desta campanha. É nele que a equipe comercial acompanha a meta e as parciais. Nem toda campanha precisa de card.
      </p>

      {resumo.total > 0 && (
        <p className="text-sm text-o2-navy">
          <strong>{resumo.total}</strong> card(s) ligado(s) a esta campanha
          {resumo.vinculados > 0 && <> — {resumo.vinculados} já existiam no Bitrix</>}
          {resumo.criados > 0 && <> — {resumo.criados} criado(s) por aqui</>}.
        </p>
      )}

      <form action={alternarCriarCardsBitrix} className="space-y-2">
        <input type="hidden" name="campanha_id" value={campanha.id} />
        <input type="hidden" name="ligar" value={ligado ? "0" : "1"} />
        <p className="text-sm text-o2-navy">
          Criar um card por imobiliária no funil Campanhas ao enviar os e-mails iniciais:{" "}
          <strong className={ligado ? "text-green-700" : "text-gray-500"}>{ligado ? "LIGADO" : "desligado"}</strong>
          {ligado && campanha.cards_bitrix_ativado_por && <span className="text-xs text-gray-500"> (ligado por {campanha.cards_bitrix_ativado_por})</span>}
        </p>
        <ConfirmarDisparoButton
          mensagemConfirmacao={
            ligado
              ? "Desligar a criação de cards no Bitrix para esta campanha?"
              : "Ligar a criação de cards? Ao enviar os e-mails iniciais, será criado um card por imobiliária no funil Campanhas do Bitrix, com o nome da campanha e o prazo. Imobiliárias que ainda não têm empresa no Bitrix serão cadastradas. Confirma?"
          }
          textoCarregando="Salvando..."
          className="rounded-full border border-o2-navy/30 px-5 py-2 text-sm font-medium text-o2-navy transition hover:bg-white"
        >
          {ligado ? "Desligar" : "Ligar criação de cards"}
        </ConfirmarDisparoButton>
      </form>

      {previa && (
        <div className="rounded-lg border border-o2-navy/10 bg-white p-3 text-sm text-o2-navy">
          <p>
            Participantes: <strong>{previa.participantes}</strong> · já com card: <strong>{previa.jaTemCard}</strong> · cards a criar: <strong>{previa.paraCriar.length}</strong>
          </p>
          {previa.semEmpresaNoBitrix > 0 && (
            <p className="mt-1 text-xs text-gray-600">{previa.semEmpresaNoBitrix} ainda não têm Empresa no Bitrix: o cadastro será criado junto com o card.</p>
          )}
          {previa.semResponsavel > 0 && (
            <p className="mt-1 text-xs text-gray-600">
              {previa.semResponsavel} sem &quot;Responsável O2&quot; definido no quadro de metas: o card ficará com quem criou a campanha.
            </p>
          )}
          {resumo.vinculados > 0 && previa.paraCriar.length > 0 && (
            <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
              Atenção: esta campanha já tinha cards no Bitrix. Antes de criar os {previa.paraCriar.length} que faltam, confira se alguma dessas imobiliárias não tem card ligado a outro cadastro (ex.: nome parecido), para não duplicar.
            </p>
          )}
          {!emitida && <p className="mt-1 text-xs text-gray-500">Os cards são criados quando os e-mails iniciais saírem.</p>}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {ligado && previa && previa.paraCriar.length > 0 && (
          <form action={criarCardsAgora}>
            <input type="hidden" name="campanha_id" value={campanha.id} />
            <ConfirmarDisparoButton
              mensagemConfirmacao={`Criar agora os cards no Bitrix (até 25 por vez)? Faltam ${previa.paraCriar.length}.`}
              textoCarregando="Criando no Bitrix..."
              className="rounded-full bg-o2-coral px-5 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
              Criar agora
            </ConfirmarDisparoButton>
          </form>
        )}
        <form action={ligarCardsExistentes}>
          <input type="hidden" name="campanha_id" value={campanha.id} />
          <ConfirmarDisparoButton
            mensagemConfirmacao="Ligar a esta campanha os cards que já existem no funil Campanhas, pela empresa de cada um? Nada é criado nem alterado no Bitrix."
            textoCarregando="Procurando..."
            className="rounded-full border border-o2-navy/30 px-5 py-2 text-sm font-medium text-o2-navy transition hover:bg-white"
          >
            Ligar cards que já existem
          </ConfirmarDisparoButton>
        </form>
      </div>
    </section>
  );
}
