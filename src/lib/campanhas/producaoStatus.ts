// Pedido do Matheus, 07/10/2026: no quadro "Produção gerada" de cada campanha,
// uma coluna dizendo, por imobiliária, se o e-mail foi enviado/aberto/clicado
// -- pra saber quais abriram e quais não. Uma imobiliária pode ter mais de um
// e-mail (uma linha de campanhas_envios por e-mail), então o status é o
// resumo de todos eles.

export type ChaveStatusEnvio = "aguardando" | "na_fila" | "abriu" | "nao_abriu" | "falhou" | "descadastrado";

export type EnvioParaStatus = {
  imobiliaria_id: string | null;
  status: string;
  aberto_em: string | null;
  clicado_em: string | null;
};

export type ResumoStatusEnvio = {
  chave: ChaveStatusEnvio;
  totalEmails: number;
  emailsAbertos: number;
  clicou: boolean;
};

export const ROTULO_STATUS_ENVIO: Record<ChaveStatusEnvio, string> = {
  aguardando: "Aguardando envio",
  na_fila: "Na fila",
  abriu: "Abriu",
  nao_abriu: "Não abriu",
  falhou: "Falhou",
  descadastrado: "Descadastrada",
};

export const COR_STATUS_ENVIO: Record<ChaveStatusEnvio, string> = {
  aguardando: "bg-gray-100 text-gray-600",
  na_fila: "bg-yellow-100 text-yellow-800",
  abriu: "bg-green-100 text-green-700",
  nao_abriu: "bg-orange-100 text-orange-700",
  falhou: "bg-red-100 text-red-600",
  descadastrado: "bg-gray-200 text-gray-600",
};

// Prioridade: abriu > enviado e não abriu > ainda na fila > falhou >
// descadastrada. Uma imobiliária com 3 e-mails em que 1 abriu conta como
// "Abriu" (o detalhe 1 de 3 aparece ao lado).
export function resumirStatusPorImobiliaria(envios: EnvioParaStatus[]): Map<string, ResumoStatusEnvio> {
  const acumulado = new Map<
    string,
    { total: number; enviados: number; abertos: number; pendentes: number; falhas: number; clicou: boolean }
  >();

  for (const e of envios) {
    if (!e.imobiliaria_id) continue;
    const a = acumulado.get(e.imobiliaria_id) ?? { total: 0, enviados: 0, abertos: 0, pendentes: 0, falhas: 0, clicou: false };
    a.total++;
    if (e.status === "enviado") a.enviados++;
    else if (e.status === "pendente" || e.status === "processando") a.pendentes++;
    else if (e.status === "falhou") a.falhas++;
    if (e.aberto_em) a.abertos++;
    if (e.clicado_em) a.clicou = true;
    acumulado.set(e.imobiliaria_id, a);
  }

  const resultado = new Map<string, ResumoStatusEnvio>();
  for (const [id, a] of acumulado) {
    const chave: ChaveStatusEnvio =
      a.abertos > 0 ? "abriu" : a.enviados > 0 ? "nao_abriu" : a.pendentes > 0 ? "na_fila" : a.falhas > 0 ? "falhou" : "descadastrado";
    resultado.set(id, { chave, totalEmails: a.total, emailsAbertos: a.abertos, clicou: a.clicou });
  }
  return resultado;
}

// Minúsculas e sem acento, igual dos dois lados (servidor grava no
// data-atributo, componente do filtro compara) -- "Imobiliária" acha
// "imobiliaria".
export function normalizarBusca(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}
