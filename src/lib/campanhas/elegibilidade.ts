import { separarEmails } from "@/lib/email";

export type ImobiliariaParaCampanha = {
  email: string | null;
  email_faturas: string[] | null;
  email_repasses: string[] | null;
  email_campanhas?: string[] | null;
};

// E-mails "utilizáveis" de uma imobiliária pra campanha: `email_campanhas`
// (contato dedicado a campanhas, cadastrado em VinculosCampanhas) como
// principal -- pedido da reunião de 15/09/2026, porque às vezes a
// imobiliária não quer que quem recebe fatura/repasse também receba
// campanha. Se estiver vazio, cai na mesma cascata de antes: `email`,
// senão `email_faturas`, senão `email_repasses`. Primeira fonte não vazia
// vence, nunca soma (evita duplicar destinatário quando mais de uma está
// preenchida). `cadastro_incompleto` não entra aqui de propósito: esse
// campo mede prontidão pra gerar contrato, não tem relação com poder
// receber e-mail de campanha.
export function emailsElegiveisCampanha(imob: ImobiliariaParaCampanha, descadastrados: Set<string>): string[] {
  const porCampanha = separarEmails(imob.email_campanhas);
  const principais = separarEmails(imob.email);
  const brutos = porCampanha.length
    ? porCampanha
    : principais.length
      ? principais
      : separarEmails(imob.email_faturas).length
        ? separarEmails(imob.email_faturas)
        : separarEmails(imob.email_repasses);
  return brutos.filter((e) => !descadastrados.has(e.trim().toLowerCase()));
}
