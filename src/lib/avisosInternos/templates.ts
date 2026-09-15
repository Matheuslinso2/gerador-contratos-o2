import { formatarData } from "@/lib/integracoes/emailO2";

// 6 templates pré-prontos pedidos pela Jéssica (reunião de 15/09/2026) --
// cada um só tem uns poucos campos editáveis (nome/data/etc.), o texto em
// volta é fixo. "mensagem" (recado livre opcional) é comum a todos, não
// entra aqui -- ver src/app/campanhas/avisos-internos/novo/page.tsx.
export type CampoTemplateAviso = {
  key: string;
  label: string;
  tipo: "text" | "date";
  obrigatorio: boolean;
  placeholder?: string;
};

export type TemplateAvisoInterno = {
  id: string;
  nome: string;
  descricao: string;
  badge: string;
  campos: CampoTemplateAviso[];
  montarAssunto: (v: Record<string, string>) => string;
  montarTitulo: (v: Record<string, string>) => string;
  introducao: string;
  montarDestaques: (v: Record<string, string>) => { label: string; valor: string }[];
};

export const TEMPLATES_AVISO_INTERNO: TemplateAvisoInterno[] = [
  {
    id: "admissao",
    nome: "Admissão de novo funcionário",
    descricao: "Boas-vindas a quem está entrando no time.",
    badge: "NOVO INTEGRANTE",
    campos: [
      { key: "nome_pessoa", label: "Nome da pessoa", tipo: "text", obrigatorio: true },
      { key: "cargo", label: "Cargo (opcional)", tipo: "text", obrigatorio: false },
      { key: "data_admissao", label: "Data de admissão", tipo: "date", obrigatorio: true },
    ],
    montarAssunto: () => "Novo integrante no time O2",
    montarTitulo: (v) => `Demos as boas-vindas a ${v.nome_pessoa}!`,
    introducao: "A equipe O2 Seguros tem um novo integrante.",
    montarDestaques: (v) => [
      { label: "Nome", valor: v.nome_pessoa },
      { label: "Cargo", valor: v.cargo },
      { label: "Data de admissão", valor: formatarData(v.data_admissao) },
    ],
  },
  {
    id: "desligamento",
    nome: "Desligamento",
    descricao: "Comunicado de saída de um colaborador.",
    badge: "COMUNICADO",
    campos: [
      { key: "nome_pessoa", label: "Nome da pessoa", tipo: "text", obrigatorio: true },
      { key: "data_desligamento", label: "Data de desligamento", tipo: "date", obrigatorio: true },
    ],
    montarAssunto: () => "Comunicado de desligamento",
    montarTitulo: () => "Comunicado interno",
    introducao: "Informamos o desligamento de um colaborador da equipe O2.",
    montarDestaques: (v) => [
      { label: "Nome", valor: v.nome_pessoa },
      { label: "Data de desligamento", valor: formatarData(v.data_desligamento) },
    ],
  },
  {
    id: "efetivacao_estagio",
    nome: "Efetivação de estagiário",
    descricao: "Quando um(a) estagiário(a) é efetivado(a).",
    badge: "EFETIVAÇÃO",
    campos: [
      { key: "nome_pessoa", label: "Nome da pessoa", tipo: "text", obrigatorio: true },
      { key: "cargo", label: "Novo cargo (opcional)", tipo: "text", obrigatorio: false },
      { key: "data_efetivacao", label: "Data de efetivação", tipo: "date", obrigatorio: true },
    ],
    montarAssunto: (v) => `Efetivação de ${v.nome_pessoa}`,
    montarTitulo: (v) => `${v.nome_pessoa} foi efetivado(a)!`,
    introducao: "Mais uma conquista na equipe O2 Seguros.",
    montarDestaques: (v) => [
      { label: "Nome", valor: v.nome_pessoa },
      { label: "Novo cargo", valor: v.cargo },
      { label: "Data de efetivação", valor: formatarData(v.data_efetivacao) },
    ],
  },
  {
    id: "feriado",
    nome: "Aviso de feriado",
    descricao: "Funcionamento da O2 num feriado.",
    badge: "FERIADO",
    campos: [
      { key: "nome_feriado", label: "Nome do feriado", tipo: "text", obrigatorio: true },
      { key: "data", label: "Data", tipo: "date", obrigatorio: true },
      { key: "observacao", label: "Observação (opcional)", tipo: "text", obrigatorio: false, placeholder: "Ex: não haverá expediente" },
    ],
    montarAssunto: (v) => `Aviso de feriado — ${v.nome_feriado}`,
    montarTitulo: (v) => `Feriado: ${v.nome_feriado}`,
    introducao: "Aviso sobre o funcionamento da O2 Seguros nesta data.",
    montarDestaques: (v) => [
      { label: "Data", valor: formatarData(v.data) },
      { label: "Observação", valor: v.observacao },
    ],
  },
  {
    id: "confraternizacao",
    nome: "Confraternização",
    descricao: "Convite pra evento/confraternização da equipe.",
    badge: "CONVITE",
    campos: [
      { key: "titulo_evento", label: "Nome do evento", tipo: "text", obrigatorio: true, placeholder: "Ex: Confraternização de fim de ano" },
      { key: "data", label: "Data", tipo: "date", obrigatorio: true },
      { key: "horario", label: "Horário (opcional)", tipo: "text", obrigatorio: false },
      { key: "local", label: "Local (opcional)", tipo: "text", obrigatorio: false },
    ],
    montarAssunto: (v) => v.titulo_evento,
    montarTitulo: (v) => v.titulo_evento,
    introducao: "Você está convidado(a)!",
    montarDestaques: (v) => [
      { label: "Data", valor: formatarData(v.data) },
      { label: "Horário", valor: v.horario },
      { label: "Local", valor: v.local },
    ],
  },
  {
    id: "reuniao_geral",
    nome: "Reunião geral",
    descricao: "Convocação pra reunião com toda a equipe.",
    badge: "REUNIÃO",
    campos: [
      { key: "titulo", label: "Título da reunião", tipo: "text", obrigatorio: true, placeholder: "Ex: Reunião geral de setembro" },
      { key: "data", label: "Data", tipo: "date", obrigatorio: true },
      { key: "horario", label: "Horário (opcional)", tipo: "text", obrigatorio: false },
      { key: "local", label: "Local/link (opcional)", tipo: "text", obrigatorio: false, placeholder: "Sala, endereço ou link da chamada" },
    ],
    montarAssunto: (v) => v.titulo,
    montarTitulo: (v) => v.titulo,
    introducao: "Convocação para reunião geral da equipe.",
    montarDestaques: (v) => [
      { label: "Data", valor: formatarData(v.data) },
      { label: "Horário", valor: v.horario },
      { label: "Local/link", valor: v.local },
    ],
  },
];

export function buscarTemplateAviso(id: string): TemplateAvisoInterno | undefined {
  return TEMPLATES_AVISO_INTERNO.find((t) => t.id === id);
}
