// Tipos e rótulos do "Último contato" da campanha, sem dependência de
// servidor (usados também pelos componentes de tela). Ver contatosBitrix.ts.

export const DIAS_SEM_CONTATO_ALERTA = 7;

export type CanalContato = "ligacao" | "whatsapp" | "email" | "reuniao" | "visita" | "outro";

export const ROTULO_CANAL: Record<CanalContato, string> = {
  ligacao: "Ligação",
  whatsapp: "WhatsApp",
  email: "E-mail",
  reuniao: "Reunião",
  visita: "Visita",
  outro: "Outro",
};

export const ICONE_CANAL: Record<CanalContato, string> = {
  ligacao: "☎",
  whatsapp: "💬",
  email: "✉",
  reuniao: "🤝",
  visita: "📍",
  outro: "•",
};

export type EventoContato = {
  id: string | null; // id do registro feito por fora (para poder apagar)
  data: string; // ISO
  canal: CanalContato;
  quem: string | null; // e-mail de quem fez
  origem: "bitrix" | "manual" | "campanha";
  observacao: string | null; // nos e-mails da campanha: qual e-mail foi (parcial, reenvio...)
};

// Tudo que se sabe de uma imobiliária (sem olhar quem é o responsável).
export type ContatosImobiliaria = {
  eventos: EventoContato[]; // mais recentes primeiro
  emailCampanha: string | null;
  // Histórico dos e-mails da campanha (disparo, parciais, reenvios), um item por mensagem enviada, mais recentes
  // primeiro. Fica à parte de `eventos`: é e-mail automático, não contato de alguém, e não zera o contador de dias.
  historicoCampanha: EventoContato[];
  semEmpresaNoBitrix: boolean;
};

// O que vai para a linha do quadro (já com a regra do responsável).
export type UltimosContatos = {
  responsavelEmail: string | null;
  doResponsavel: EventoContato | null;
  eventos: EventoContato[];
  emailCampanha: string | null;
  historicoCampanha: EventoContato[];
  ultimo: string | null; // base do contador de dias
  diasSemContato: number | null; // null = nenhum contato na janela
  semEmpresaNoBitrix: boolean;
};
