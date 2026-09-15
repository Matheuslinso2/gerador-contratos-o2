import { separarEmails } from "@/lib/email";

export type ImobiliariaParaCampanha = {
  email: string | null;
  email_faturas: string[] | null;
  email_repasses: string[] | null;
};

// E-mails "utilizáveis" de uma imobiliária pra campanha: `email` (contato
// geral) como principal, senão `email_faturas`, senão `email_repasses` --
// primeira fonte não vazia vence, nunca soma as três (evita duplicar
// destinatário quando mais de uma está preenchida). `cadastro_incompleto`
// não entra aqui de propósito: esse campo mede prontidão pra gerar
// contrato, não tem relação com poder receber e-mail de campanha (achado
// real 2026-09-15 -- 497 de 500 imobiliárias estavam marcadas incompletas e
// ficavam escondidas por padrão na tela de destinatários).
export function emailsElegiveisCampanha(imob: ImobiliariaParaCampanha, descadastrados: Set<string>): string[] {
  const principais = separarEmails(imob.email);
  const brutos = principais.length
    ? principais
    : separarEmails(imob.email_faturas).length
      ? separarEmails(imob.email_faturas)
      : separarEmails(imob.email_repasses);
  return brutos.filter((e) => !descadastrados.has(e.trim().toLowerCase()));
}
