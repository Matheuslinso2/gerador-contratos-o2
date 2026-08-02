import { getDocumentProxy, extractText } from "unpdf";

export type CandidatoSenha = { chave: string; senha: string };

// As faturas de seguradora chegam com o PDF protegido por senha derivada do
// CNPJ da imobiliária — mas o formato exato varia por seguradora (Porto usa
// só os 5 primeiros dígitos; outras podem usar o CNPJ completo). Em vez de
// tentar casar texto depois de abrir, tenta abrir o arquivo testando os
// candidatos de senha de cada imobiliária cadastrada — a "chave" de quem
// abriu é a própria identificação, sem precisar comparar texto depois.
export async function abrirTextoPdfComSenha(
  buffer: Buffer,
  candidatos: CandidatoSenha[]
): Promise<{ texto: string; chaveCorreta: string | null } | null> {
  const dados = new Uint8Array(buffer);

  // PDF pode não ter senha nenhuma (raro nesse fluxo, mas não custa tentar).
  try {
    const pdf = await getDocumentProxy(dados);
    const { text } = await extractText(pdf, { mergePages: true });
    return { texto: text.trim(), chaveCorreta: null };
  } catch {
    // segue pra tentativa com senha
  }

  for (const candidato of candidatos) {
    if (!candidato.senha) continue;
    try {
      const pdf = await getDocumentProxy(dados, { password: candidato.senha });
      const { text } = await extractText(pdf, { mergePages: true });
      return { texto: text.trim(), chaveCorreta: candidato.chave };
    } catch {
      continue; // senha errada ou outro erro — tenta a próxima
    }
  }

  return null;
}

// Só os dígitos do CNPJ, mesmo formato usado como base da senha.
export function apenasDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

// Gera as variantes de senha conhecidas a partir de um CNPJ: completo e os
// 5 primeiros dígitos (padrão identificado nas faturas da Porto Seguro).
// Se outra seguradora usar um formato diferente, ajusta aqui.
export function variantesSenhaDeCnpj(cnpj: string): string[] {
  const digitos = apenasDigitos(cnpj);
  if (!digitos) return [];
  const variantes = new Set([digitos]);
  if (digitos.length > 5) variantes.add(digitos.slice(0, 5));
  return Array.from(variantes);
}
