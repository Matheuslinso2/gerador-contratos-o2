import "server-only";
import { chamarBitrixComoApp } from "./appAuth";

// Registra no histórico do card (Lead, Deal ou SPA) um e-mail enviado ou
// recebido pelo "E-mail no card" (Fase 1, ver
// C:\Users\O2-Grupo\.claude\plans\frolicking-floating-frog.md).
//
// crm.activity.add aceita OWNER_TYPE_ID = entityTypeId cru (2 pra Deal, 1
// pra Lead, ou o entityTypeId da SPA) -- funciona igual pras 6 entidades,
// não precisa de tratamento especial por tipo.
//
// TYPE_ID=4 (Email) é o padrão de instalação limpa do Bitrix -- nunca
// testado nesse portal antes da Fase 1, confirmar no primeiro envio real
// que a atividade aparece com o ícone/tipo certo no histórico do card.
export async function registrarAtividadeEmail(params: {
  entityTypeId: number;
  itemId: number;
  assunto: string;
  corpo: string;
  direcao: "enviado" | "recebido";
}) {
  const { entityTypeId, itemId, assunto, corpo, direcao } = params;

  await chamarBitrixComoApp("crm.activity.add", {
    fields: {
      OWNER_TYPE_ID: entityTypeId,
      OWNER_ID: itemId,
      TYPE_ID: 4,
      SUBJECT: assunto,
      DESCRIPTION: corpo,
      DESCRIPTION_TYPE: 3, // 3 = HTML
      DIRECTION: direcao === "enviado" ? 2 : 1, // 1 = recebido, 2 = enviado (padrão CRM_ACTIVITY_DIRECTION)
      COMPLETED: "Y",
    },
  });
}
