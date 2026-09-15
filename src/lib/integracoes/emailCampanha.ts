// Moldura visual dos e-mails de Campanhas Comerciais -- mesma identidade
// (logo, cores, tipografia) de emailO2.ts, mas para marketing externo às
// imobiliárias, não notificação interna: sem os campos de auditoria
// (badge/protocolo/origem) e com rodapé de descadastro obrigatório (nunca
// opcional -- toda campanha passa por aqui).

import { O2_NAVY, O2_LARANJA, O2_CINZA_CLARO, O2_CINZA_MEDIO, FONTE, LOGO_URL, botaoPill, blocoSecao } from "./emailO2";

export type TemplateCampanha = "comunicado" | "promocao" | "newsletter";

// campanhas.template decide só variações de bloco dentro do MESMO layout
// (ex: "promocao" ganha uma caixa de destaque), não 3 designs diferentes --
// é isso que o pedido do usuário de reusar a identidade já estabelecida
// pede (não inventar conceito visual novo).
function blocoDestaquePromocao(texto: string): string {
  return blocoSecao("Oferta", `<tr><td style="padding:12px 14px;font-size:14px;color:${O2_CINZA_MEDIO};font-family:${FONTE};">${texto}</td></tr>`);
}

// Campo próprio (não embutido no texto do corpo), independente do template
// -- validade pode importar num comunicado ou newsletter, não só promoção.
function blocoValidoAte(dataBr: string): string {
  return `<tr>
    <td style="padding:4px 28px 0;" align="center">
      <p style="margin:0;font-size:12px;font-weight:600;color:${O2_LARANJA};font-family:${FONTE};">Válido até ${dataBr}</p>
    </td>
  </tr>`;
}

export function envolverEmailCampanha({
  template = "comunicado",
  titulo,
  introducao,
  corpoHtml,
  ctaTexto,
  ctaHref,
  destaquePromocao,
  validoAte,
  unsubscribeHref,
}: {
  template?: TemplateCampanha;
  titulo: string;
  introducao?: string;
  corpoHtml: string;
  ctaTexto?: string;
  ctaHref?: string;
  /** Só usado quando template === "promocao". */
  destaquePromocao?: string;
  /** Data já formatada (dd/mm/aaaa) -- vale pra qualquer template. */
  validoAte?: string;
  /** Link já com token válido -- ver src/lib/campanhas/unsubscribeToken.ts. */
  unsubscribeHref: string;
}): string {
  return `
    <style>@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap');</style>
    <div style="background:#f4f4f4;padding:28px 12px;font-family:${FONTE};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${O2_CINZA_CLARO};">
        <tr>
          <td style="padding:28px 28px 4px;" align="center">
            <img src="${LOGO_URL}" alt="O2 Seguros" width="150" style="display:block;" />
          </td>
        </tr>
        <tr>
          <td style="padding:14px 28px 0;" align="center">
            <p style="margin:0;font-size:21px;font-weight:700;color:${O2_NAVY};font-family:${FONTE};">${titulo}</p>
          </td>
        </tr>
        ${validoAte ? blocoValidoAte(validoAte) : ""}
        ${
          introducao
            ? `<tr>
          <td style="padding:8px 32px 0;" align="center">
            <p style="margin:0;font-size:14px;color:${O2_CINZA_MEDIO};font-family:${FONTE};line-height:1.5;">${introducao}</p>
          </td>
        </tr>`
            : ""
        }

        ${corpoHtml}

        ${template === "promocao" && destaquePromocao ? blocoDestaquePromocao(destaquePromocao) : ""}

        ${ctaTexto && ctaHref ? botaoPill(ctaHref, ctaTexto) : ""}

        <tr>
          <td style="padding:28px 28px 24px;">
            <hr style="border:none;border-top:1px solid ${O2_CINZA_CLARO};margin:0 0 16px;" />
            <p style="margin:0 0 8px;font-size:11px;color:${O2_CINZA_MEDIO};font-family:${FONTE};text-align:center;">
              Enviado pela O2 Seguros — <span style="color:${O2_LARANJA};">#SomosTodosO2</span>
            </p>
            <p style="margin:0;font-size:11px;color:${O2_CINZA_MEDIO};font-family:${FONTE};text-align:center;">
              Não quer mais receber esses e-mails? <a href="${unsubscribeHref}" style="color:${O2_NAVY};">Descadastre-se aqui</a>.
            </p>
          </td>
        </tr>
      </table>
    </div>`;
}
