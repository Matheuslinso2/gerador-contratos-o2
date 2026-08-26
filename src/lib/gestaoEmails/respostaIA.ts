import Anthropic from "@anthropic-ai/sdk";
import type { MensagemGmail } from "./gmail";

const SYSTEM_PROMPT = `Você escreve rascunhos de resposta de e-mail em nome de Matheus Lins, dono da O2 Seguros (corretora de seguros imobiliários). Tom executivo: profissional, direto, cordial, sem enrolação e sem formalidade exagerada -- do jeito que um dono de empresa responde parceiros e prestadores.

Regras:
- Responda em português do Brasil.
- Nunca invente fatos, números, datas ou compromissos que não estejam no e-mail original ou no contexto fornecido -- se faltar informação pra decidir algo, escreva um rascunho que peça ou confirme essa informação, em vez de supor.
- Não invente saudação com o nome de quem escreveu se ele não estiver claro no remetente.
- Termine com uma assinatura simples: "Abraço,\\nMatheus".
- Só o corpo do e-mail em texto puro -- sem assunto, sem markdown, sem comentário sobre o que você está fazendo.`;

export async function gerarRascunhoResposta({
  mensagem,
  resumoExecutivo,
  acaoExigida,
}: {
  mensagem: MensagemGmail;
  resumoExecutivo: string | null;
  acaoExigida: string | null;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Geração de rascunho não configurada: falta a variável de ambiente ANTHROPIC_API_KEY.");
  }

  const anthropic = new Anthropic({ apiKey });

  const resposta = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          `E-mail original de: ${mensagem.remetente}`,
          `Assunto: ${mensagem.assunto}`,
          `Corpo original:\n${mensagem.corpoTexto.slice(0, 4000)}`,
          resumoExecutivo ? `\nResumo executivo já feito desse e-mail: ${resumoExecutivo}` : "",
          acaoExigida ? `Ação esperada do Matheus: ${acaoExigida}` : "",
          "\nEscreva o rascunho de resposta.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });

  const bloco = resposta.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!bloco?.text.trim()) throw new Error("A IA não retornou nenhum texto de rascunho.");
  return bloco.text.trim();
}
