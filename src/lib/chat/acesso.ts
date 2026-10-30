import { isEquipe, isMatheus } from "@/lib/admin";

// Chat da equipe (Workspace + ERP). Liberado para toda a equipe em 30/10/2026 (ordem do Matheus). Para esconder de novo, voltar para false.
export const CHAT_LIBERADO_PARA_EQUIPE = true;

export function chatVisivelPara(email: string | null | undefined) {
  if (!email) return false;
  return isMatheus(email) || (CHAT_LIBERADO_PARA_EQUIPE && isEquipe(email));
}
