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
// TYPE_ID=4 (Email) -- confirmado num teste real em 2026-09-10 que precisa
// do campo COMMUNICATIONS (endereço envolvido), senão o Bitrix recusa com
// "The field COMMUNICATIONS is not defined or invalid" -- diferente de
// outros TYPE_ID, que não exigem isso.
export async function registrarAtividadeEmail(params: {
  entityTypeId: number;
  itemId: number;
  assunto: string;
  corpo: string;
  direcao: "enviado" | "recebido";
  enderecoEnvolvido: string;
}) {
  const { entityTypeId, itemId, assunto, corpo, direcao, enderecoEnvolvido } = params;

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
      COMMUNICATIONS: [{ VALUE: enderecoEnvolvido, TYPE: "EMAIL" }],
    },
  });
}
