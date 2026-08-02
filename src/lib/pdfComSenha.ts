import { getDocumentProxy, extractText } from "unpdf";

// As faturas de seguradora chegam com o PDF protegido por senha — e a senha
// é sempre o CNPJ (só números) da própria imobiliária. Isso vira, na
// prática, o jeito mais confiável de identificar a imobiliária: em vez de
// tentar casar texto depois de abrir, tenta abrir o arquivo testando o CNPJ
// de cada imobiliária cadastrada como senha. A que abrir é a identificação.
export async function abrirTextoPdfComSenha(
  buffer: Buffer,
  senhasCandidatas: string[]
): Promise<{ texto: string; senhaCorreta: string } | null> {
  const dados = new Uint8Array(buffer);

  // PDF pode não ter senha nenhuma (raro nesse fluxo, mas não custa tentar).
  try {
    const pdf = await getDocumentProxy(dados);
    const { text } = await extractText(pdf, { mergePages: true });
    return { texto: text.trim(), senhaCorreta: "" };
  } catch {
    // segue pra tentativa com senha
  }

  for (const senha of senhasCandidatas) {
    if (!senha) continue;
    try {
      const pdf = await getDocumentProxy(dados, { password: senha });
      const { text } = await extractText(pdf, { mergePages: true });
      return { texto: text.trim(), senhaCorreta: senha };
    } catch {
      continue; // senha errada ou outro erro — tenta a próxima
    }
  }

  return null;
}

// Só os dígitos do CNPJ, mesmo formato usado como senha pelas seguradoras.
export function apenasDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}
