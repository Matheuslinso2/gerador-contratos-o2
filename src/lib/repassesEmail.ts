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
// visual O2 usada em montarEmailFatura, com o valor líquido em destaque
// (é o número que mais importa pra quem recebe) e a fonte da marca
// (Poppins, com fallback pra Arial pros clientes que cortam fonte web).
// Layout aprovado com o Matheus em prévia antes de ir pro código
// (https://claude.ai/code/artifact/028b620f-486e-46ec-908d-a39d0c9d0b2d).
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
  const ano = competencia.split("-")[0];
  const assunto = `COMISSÃO ${nomeImobiliaria} - O2 SEGUROS - ${mes}`;

  const linhasAnexos = repasses
    .map((r, i) => {
      const primeiro = i === 0;
      const ultimo = i === repasses.length - 1;
      const raioTopo = primeiro ? "8px 8px" : "0 0";
      const raioBase = ultimo ? "8px 8px" : "0 0";
      return `
              <tr>
                <td style="padding: 9px 12px; border: 1px solid #eee; ${primeiro ? "" : "border-top: none; "}border-radius: ${raioTopo} ${raioBase}; font-size: 13px; color: #333; font-family: 'Poppins', Arial, sans-serif;">
                  📎&nbsp; ${r.arquivo_nome}${r.tipo_documento ? ` <span style="color:#aaa;">(${r.tipo_documento})</span>` : ""}
                </td>
              </tr>`;
    })
    .join("");

  const html = `
    <div style="max-width: 560px; margin: 0 auto; font-family: 'Poppins', Arial, sans-serif; background: #ffffff;">
      <div style="text-align: center; padding: 36px 24px 22px;">
        <table role="presentation" align="center" style="margin: 0 auto 18px; border-collapse: collapse;">
          <tr>
            <td style="background: #fff1ea; border-radius: 999px; padding: 22px 30px; text-align: center;">
              <img src="cid:o2-logo" alt="O2 Seguros" width="150" style="display: block; margin: 0 auto;" />
            </td>
          </tr>
        </table>
        <span style="display: inline-block; background: #F8540D; color: #ffffff; font-size: 11.5px; font-weight: 600; letter-spacing: .03em; padding: 6px 16px; border-radius: 999px; text-transform: uppercase;">
          Repasse de comissão
        </span>
        <h1 style="margin: 14px 0 4px; font-size: 20px; font-weight: 700; color: #01192e; letter-spacing: -.01em;">
          ${nomeMes(competencia)} de ${ano}
        </h1>
      </div>
      <div style="padding: 0 28px 30px;">
        <p style="margin: 0 0 4px; font-size: 14px; color: #333; line-height: 1.6;">Olá, boa tarde!</p>
        <p style="margin: 0 0 20px; font-size: 14px; color: #333; line-height: 1.6;">
          O pagamento das comissões referente ao mês de <strong>${mes}</strong> foi realizado. 🎉🙌
        </p>
        <p style="margin: 0 0 22px; font-size: 14px; color: #333; line-height: 1.6;">
          Segue em anexo, o relatório dos seguros e o comprovante de pagamento.
        </p>

        <table role="presentation" width="100%" style="border-collapse: collapse; background: #fafafa; border: 1px solid #eee; border-radius: 12px; margin-bottom: 22px;">
          <tr>
            <td style="padding: 18px 20px 4px; font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: #999; font-family: 'Poppins', Arial, sans-serif;">
              Valor líquido repassado
            </td>
          </tr>
          <tr>
            <td style="padding: 0 20px 18px; font-size: 30px; font-weight: 700; color: #F8540D; font-family: 'Poppins', Arial, sans-serif; letter-spacing: -.01em;">
              ${formatarValor(valorLiquido)}
            </td>
          </tr>
          <tr><td style="padding: 0 20px;"><div style="border-top: 1px solid #ececec;"></div></td></tr>
          <tr>
            <td style="padding: 14px 20px 18px;">
              <table role="presentation" width="100%" style="border-collapse: collapse; font-size: 13.5px; color: #01192e; font-family: 'Poppins', Arial, sans-serif;">
                <tr>
                  <td style="padding: 3px 0; color: #888;">Competência</td>
                  <td style="padding: 3px 0; text-align: right; font-weight: 600;">${nomeMes(competencia)} de ${ano}</td>
                </tr>
                <tr>
                  <td style="padding: 3px 0; color: #888;">Produtor</td>
                  <td style="padding: 3px 0; text-align: right; font-weight: 600;">${nomeImobiliaria}</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <p style="margin: 0 0 8px; font-size: 11px; color: #999; text-transform: uppercase; letter-spacing: .05em; font-weight: 600; font-family: 'Poppins', Arial, sans-serif;">
          Anexo${repasses.length > 1 ? "s" : ""} (${repasses.length})
        </p>
        <table role="presentation" width="100%" style="border-collapse: collapse; margin-bottom: 22px;">
          ${linhasAnexos}
        </table>

        <p style="margin: 0; font-size: 13px; color: #888; line-height: 1.6;">
          Qualquer dúvida, estou à disposição!!
        </p>
      </div>
      <p style="text-align: center; color: #aaa; font-size: 11px; margin: 0; padding: 18px 24px; border-top: 1px solid #f0f0f0; font-family: 'Poppins', Arial, sans-serif;">
        Enviado automaticamente pelo sistema de repasses da O2 Seguros.
      </p>
    </div>
  `;

  return { assunto, html };
}
