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
// TYPE_ID=4 (Email) -- dois achados reais em testes de envio de verdade
// (2026-09-10):
// 1) Precisa do campo COMMUNICATIONS (endereço envolvido), senão o Bitrix
//    recusa com "The field COMMUNICATIONS is not defined or invalid".
// 2) COMPLETED="Y" faz o Bitrix tentar DE VERDADE despachar o e-mail pelo
//    conector nativo de e-mail do CRM (falha com `Email send error. "From"
//    is not found` porque não existe caixa conectada nesse portal) -- isso
//    é exatamente o mecanismo que este projeto existe pra evitar (ver
//    contexto do plano). Usar COMPLETED="N": cria só o registro histórico
//    no card, sem acionar nenhum envio real do lado do Bitrix -- o envio
//    de verdade já aconteceu via Resend antes desta chamada.
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
      COMPLETED: "N",
      COMMUNICATIONS: [{ VALUE: enderecoEnvolvido, TYPE: "EMAIL" }],
    },
  });
}
