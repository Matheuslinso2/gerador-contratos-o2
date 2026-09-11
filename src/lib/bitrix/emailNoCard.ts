import "server-only";
import { buscarItem, buscarEmpresas, buscarUsuarios } from "./client";
import { nomeProdutoPorEntidade, gerarLinkCard } from "./entidadesCard";

// Compartilhado entre enviar-email/route.ts (monta o e-mail de verdade) e
// info-card/route.ts (prévia na tela de composição, pedida pelo Matheus
// depois de ver a Fase 3 sem preview -- "onde inclui os dados do card?").
// Extraído pra cá em vez de duplicado nos dois: mesma lógica, dois
// consumidores.

const DOMINIO_PORTAL = "o2seguros.bitrix24.com.br";

// Valida que quem chamou realmente tem uma sessão válida do Bitrix pra esse
// portal -- ambas as rotas rodam sem cookie de sessão da Plataforma O2
// (dentro do iframe do placement), então sem isso qualquer um poderia ler
// dados de card ou mandar e-mail em nome da O2.
export async function tokenBitrixValido(authId: string): Promise<boolean> {
  try {
    const resp = await fetch(`https://${DOMINIO_PORTAL}/rest/profile.json`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auth: authId }),
      signal: AbortSignal.timeout(10_000),
    });
    const dados = await resp.json();
    return resp.ok && !dados.error && Boolean(dados.result);
  } catch {
    return false;
  }
}

export type InfoCardEmail = {
  badge: string;
  tituloCard: string;
  empresa?: string;
  responsavel?: string;
  link: string;
};

// Best-effort: qualquer falha (permissão, campo ausente, timeout) devolve
// null em vez de propagar erro -- quem chama decide o que fazer (enviar
// sem o bloco, ou esconder a prévia), nunca travar por causa disso.
export async function buscarInfoCardParaEmail(entityTypeId: number, itemId: number): Promise<InfoCardEmail | null> {
  try {
    const item = await buscarItem(entityTypeId, itemId);
    const [empresas, responsaveis] = await Promise.all([
      item.companyId ? buscarEmpresas([item.companyId]) : Promise.resolve({} as Record<number, string>),
      item.assignedById ? buscarUsuarios([item.assignedById]) : Promise.resolve({} as Record<number, string>),
    ]);
    return {
      badge: nomeProdutoPorEntidade(entityTypeId),
      tituloCard: item.title,
      empresa: item.companyId ? empresas[item.companyId] : undefined,
      responsavel: item.assignedById ? responsaveis[item.assignedById] : undefined,
      link: gerarLinkCard(entityTypeId, itemId),
    };
  } catch (erro) {
    console.warn("Falha ao buscar dados do card pro e-mail:", erro);
    return null;
  }
}
