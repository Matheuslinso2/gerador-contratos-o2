import "server-only";

import { randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { PAINEIS_ROBO } from "./paineis";

// Protocolo do relatório do Robô O2 (pedido do Matheus, 04/11/2026): cada lista de cards ou PDF gerado pelo campo do
// painel ganha um código (RO2-AAAAMMDD-XXXXXX) e o "caminho do relatório" fica guardado como um prompt exato: painel,
// mês, pergunta, filtro aplicado, consultas e cards escolhidos. Serve para rastrear como o relatório foi produzido e
// para refazer a mesma pesquisa depois (outra imobiliária, outra época, conferência). Leitura só do Matheus por enquanto.

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem O/0/I/1

function novoCodigo(): string {
  const bytes = randomBytes(6);
  const sufixo = Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join("");
  const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).replace(/-/g, "");
  return `RO2-${dia}-${sufixo}`;
}

// Chat geral (sem painel): documentos, e-mails e telefones digitados na pergunta ficam mascarados no histórico guardado (06/11/2026).
export function mascararPessoal(t: string): string {
  return t
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "***.***.***-**")
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, "**.***.***/****-**")
    .replace(/(?<![\d.,])\d{11}(?![\d.,])/g, "***********")
    .replace(/(?<![\d.,])\d{14}(?![\d.,])/g, "**************")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "***@***");
}

export const REGEX_PROTOCOLO = /^RO2-\d{8}-[A-Z2-9]{6}$/;

export type DadosProtocolo = {
  email: string;
  tipo: "resposta" | "lista" | "pdf";
  painelId: string | null;
  competencia: string | null;
  pergunta: string;
  conversa: { role: "user" | "assistant"; content: string }[];
  logica: string | null;
  fontes: string[];
  /** Cards escolhidos no menu (nº do card). "todos" = a pessoa marcou "Todos os cards". */
  cardsSelecionados: { id: number; produto: string }[];
  todosOsCards: boolean;
  totalCardsDaResposta: number;
};

export function montarCaminho(codigo: string, d: DadosProtocolo): string {
  const painel = d.painelId ? PAINEIS_ROBO[d.painelId] : null;
  const linhas = [
    `PROTOCOLO ${codigo}`,
    `SOLICITANTE: ${d.email}`,
    `GERADO EM: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (${d.tipo === "pdf" ? "relatório em PDF" : d.tipo === "resposta" ? "resposta do robô na tela" : "lista de cards na tela"})`,
    `PAINEL: ${painel ? `${painel.nome} (${d.painelId})` : "chat geral"} | COMPETÊNCIA: ${d.competencia ?? "—"}`,
    `PERGUNTA (exata): ${d.pergunta}`,
  ];
  const anteriores = d.conversa.slice(0, -1);
  if (anteriores.length) linhas.push(`CONVERSA ANTERIOR USADA COMO CONTEXTO: ${anteriores.map((t) => `${t.role === "user" ? "P" : "R"}: ${t.content.replace(/\s+/g, " ").slice(0, 300)}`).join(" || ")}`);
  if (d.logica) linhas.push(`FILTRO APLICADO: ${d.logica}`);
  if (d.fontes.length) linhas.push(`CONSULTAS FEITAS: ${d.fontes.join(" | ")}`);
  if (d.totalCardsDaResposta > 0) {
    linhas.push(
      d.todosOsCards
        ? `CARDS: todos os ${d.totalCardsDaResposta} citados na resposta`
        : `CARDS: ${d.cardsSelecionados.length} de ${d.totalCardsDaResposta} citados na resposta, escolhidos pela pessoa: ${d.cardsSelecionados.map((c) => `${c.produto}#${c.id}`).join(", ")}`
    );
    linhas.push("LISTA GERADA: produto, nome do segurado, etapa atual do card (lida na hora), seguradora, imobiliária, endereço, prêmio, comissão da corretora e repasse");
  }
  linhas.push(`PARA REPRODUZIR: refaça a pergunta acima no painel ${painel?.nome ?? "indicado"}, competência ${d.competencia ?? "indicada"}, com o mesmo filtro e as mesmas fontes${d.totalCardsDaResposta > 0 ? ", e liste os mesmos campos dos cards" : ""}. Para outra imobiliária ou época, troque só esse dado.`);
  return linhas.join("\n");
}

export async function registrarProtocolo(dados: DadosProtocolo): Promise<string> {
  const d: DadosProtocolo = dados.painelId ? dados : { ...dados, pergunta: mascararPessoal(dados.pergunta), conversa: dados.conversa.map((t) => ({ ...t, content: mascararPessoal(t.content) })) };
  const sb = createServiceClient();
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const codigo = novoCodigo();
    const { error } = await sb.from("robo_protocolos").insert({
      protocolo: codigo,
      email: d.email.toLowerCase(),
      painel_id: d.painelId,
      competencia: d.competencia,
      tipo: d.tipo,
      pergunta: d.pergunta.slice(0, 2000),
      caminho: montarCaminho(codigo, d),
      conversa: d.conversa.map((t) => ({ role: t.role, content: t.content.slice(0, 4000) })),
      logica: d.logica?.slice(0, 700) ?? null,
      fontes: d.fontes.slice(0, 12),
      cards_selecionados: d.cardsSelecionados,
    });
    if (!error) return codigo;
    if (!/duplicate|unique/i.test(error.message)) throw new Error(`protocolo: ${error.message}`);
  }
  throw new Error("protocolo: não consegui gerar um código único");
}
