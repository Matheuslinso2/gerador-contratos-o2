const MESES_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function nomeMes(competencia: string): string {
  const [, mesTexto] = competencia.split("-");
  return MESES_PT[Number(mesTexto) - 1] ?? competencia;
}

function formatarValor(valor: number | null): string {
  if (valor === null) return "—";
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export type RepasseParaEmail = { arquivo_nome: string; tipo_documento: string | null };

// Assunto e corpo espelham o e-mail que a Nathalie já manda hoje na mão
// (ex: "COMISSÃO CARLA PINNA - O2 SEGUROS - JUNHO") -- mesma identidade
// visual O2 usada em montarEmailFatura, só trocando o conteúdo pro
// contexto de repasse.
export function montarEmailRepasse({
  nomeImobiliaria,
  competencia,
  valorLiquido,
  repasses,
}: {
  nomeImobiliaria: string;
  competencia: string;
  valorLiquido: number | null;
  repasses: RepasseParaEmail[];
}): { assunto: string; html: string } {
  const mes = nomeMes(competencia).toUpperCase();
  const assunto = `COMISSÃO ${nomeImobiliaria} - O2 SEGUROS - ${mes}`;

  const linhasAnexos = repasses
    .map((r) => `<li style="margin-bottom: 4px;">${r.arquivo_nome}${r.tipo_documento ? ` (${r.tipo_documento})` : ""}</li>`)
    .join("");

  const html = `
    <div style="max-width: 560px; margin: 0 auto; font-family: Arial, sans-serif; background: #ffffff;">
      <div style="text-align: center; padding: 32px 24px 20px;">
        <table role="presentation" align="center" style="margin: 0 auto 16px; border-collapse: collapse;">
          <tr>
            <td style="background: #fff1ea; border-radius: 999px; padding: 22px 30px; text-align: center;">
              <img src="cid:o2-logo" alt="O2 Seguros" width="150" style="display: block; margin: 0 auto;" />
            </td>
          </tr>
        </table>
        <span style="display: inline-block; background: #F8540D; color: #ffffff; font-size: 12px; font-weight: 600; padding: 6px 16px; border-radius: 999px;">
          Repasse de comissão
        </span>
        <h1 style="margin: 12px 0 4px; font-size: 19px; font-weight: 600; color: #01192e;">
          ${nomeMes(competencia)} de ${competencia.split("-")[0]}
        </h1>
      </div>
      <div style="padding: 0 24px 28px;">
        <p style="margin: 0 0 4px; font-size: 14px; color: #333; line-height: 1.6;">Olá, boa tarde!</p>
        <p style="margin: 0 0 20px; font-size: 14px; color: #333; line-height: 1.6;">
          O pagamento das comissões referente ao mês de <strong>${mes}</strong> foi realizado. 🎉🙌
        </p>
        <p style="margin: 0 0 20px; font-size: 14px; color: #333; line-height: 1.6;">
          Segue em anexo, o relatório dos seguros e o comprovante de pagamento.
        </p>
        <div style="border: 1px solid #e5e5e5; border-radius: 12px; padding: 16px 20px; margin-bottom: 20px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #01192e;">
            <tr>
              <td style="padding: 4px 0; color: #888;">Competência</td>
              <td style="padding: 4px 0; text-align: right; font-weight: bold;">${nomeMes(competencia)} de ${competencia.split("-")[0]}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #888;">Valor líquido repassado</td>
              <td style="padding: 4px 0; text-align: right; font-weight: bold; color: #F8540D;">${formatarValor(valorLiquido)}</td>
            </tr>
          </table>
        </div>
        <p style="margin: 0 0 6px; font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px;">
          Anexo${repasses.length > 1 ? "s" : ""} (${repasses.length})
        </p>
        <ul style="margin: 0 0 20px; padding-left: 18px; font-size: 13px; color: #333;">
          ${linhasAnexos}
        </ul>
        <p style="margin: 0; font-size: 13px; color: #888; line-height: 1.5;">
          Qualquer dúvida, estou à disposição!!
        </p>
      </div>
      <p style="text-align: center; color: #aaa; font-size: 11px; margin: 0; padding: 16px 24px; border-top: 1px solid #f0f0f0;">
        Enviado automaticamente pelo sistema de repasses da O2 Seguros.
      </p>
    </div>
  `;

  return { assunto, html };
}
