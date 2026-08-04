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
  // Uma cópia nova do buffer a cada tentativa — reaproveitar a mesma
  // Uint8Array entre chamadas ao getDocumentProxy pode deixá-la inutilizável
  // depois da primeira tentativa (a lib parece "consumir"/transferir os
  // dados internamente), fazendo tentativas seguintes falharem mesmo com a
  // senha certa.
  const novaCopia = () => new Uint8Array(buffer);

  // PDF pode não ter senha nenhuma (raro nesse fluxo, mas não custa tentar).
  try {
    const pdf = await getDocumentProxy(novaCopia());
    const { text } = await extractText(pdf, { mergePages: true });
    return { texto: text.trim(), chaveCorreta: null };
  } catch {
    // segue pra tentativa com senha
  }

  for (const candidato of candidatos) {
    if (!candidato.senha) continue;
    try {
      const pdf = await getDocumentProxy(novaCopia(), { password: candidato.senha });
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

// CNPJs da própria O2 Seguros — a senha do PDF (quando existe, ex: faturas
// da Porto) é derivada de um desses, não do CNPJ da imobiliária. Abrir o
// arquivo não identifica quem é a imobiliária (a senha é sempre a mesma
// pra todo mundo) — a identificação continua vindo do conteúdo do
// documento depois de aberto.
const CNPJS_O2 = ["20001784000180", "54493758000138"];

export function candidatosSenhaO2(): CandidatoSenha[] {
  return CNPJS_O2.flatMap((cnpj) => variantesSenhaDeCnpj(cnpj).map((senha) => ({ chave: "o2", senha })));
}
