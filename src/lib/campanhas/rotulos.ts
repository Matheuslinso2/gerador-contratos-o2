// Rótulos/cores de status compartilhados entre a listagem e a tela de
// progresso de uma campanha -- evita duplicar o mapa em 2 arquivos.
export const ROTULO_STATUS_CAMPANHA: Record<string, string> = {
  rascunho: "Rascunho",
  agendada: "Agendada",
  enviando: "Enviando",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

export const COR_STATUS_CAMPANHA: Record<string, string> = {
  rascunho: "bg-gray-100 text-gray-600",
  agendada: "bg-blue-100 text-blue-700",
  enviando: "bg-yellow-100 text-yellow-800",
  concluida: "bg-green-100 text-green-700",
  cancelada: "bg-red-100 text-red-600",
};
