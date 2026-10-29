import { isEquipe, isMatheus } from "@/lib/admin";

// Chat da equipe (Workspace + ERP). Combinado com o Matheus em 29/10/2026: enquanto estiver em teste só ele
// enxerga o balão de chat. Quando ele der o OK, trocar para true e publicar: o balão passa a aparecer para toda a equipe.
export const CHAT_LIBERADO_PARA_EQUIPE = false;

export function chatVisivelPara(email: string | null | undefined) {
  if (!email) return false;
  return isMatheus(email) || (CHAT_LIBERADO_PARA_EQUIPE && isEquipe(email));
}
