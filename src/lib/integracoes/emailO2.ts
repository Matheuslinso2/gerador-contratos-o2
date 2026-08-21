// Moldura visual compartilhada pelos e-mails de notificação das landing
// pages (RC Obras, Seguro Auto, e qualquer produto futuro que precise
// avisar um e-mail interno a cada preenchimento) -- cores/tipografia
// exatas do Manual de Marca da O2 (skill o2-marca-visual), não aproximadas.
// Extraído pra cá porque o mesmo cabeçalho/rodapé/seção se repetiria em
// cada arquivo de integração (rcObras.ts, seguroAuto.ts, ...).

const O2_NAVY = "#01192e";
const O2_LARANJA = "#F8540D";
const O2_CINZA_CLARO = "#d9d9d9";
const O2_CINZA_MEDIO = "#8d8683";
const O2_CINZA_ESCURO = "#444440";
const FONTE = "'Poppins', Arial, sans-serif";
const LOGO_URL = "https://gerador-contratos-o2.vercel.app/marca-o2/o2-logo-horizontal.png";

// Uma linha "rótulo: valor" dentro de uma seção. Ignorada se vazia -- assim
// só aparece no e-mail o que a pessoa realmente preencheu.
export function linhaCampo(label: string, valor: string): string {
  if (!valor) return "";
  return `
    <tr>
      <td style="padding:10px 14px;font-size:12px;color:${O2_CINZA_MEDIO};font-family:${FONTE};white-space:nowrap;vertical-align:top;width:40%;border-bottom:1px solid #f2f2f2;">${label}</td>
      <td style="padding:10px 14px;font-size:14px;color:${O2_CINZA_ESCURO};font-family:${FONTE};font-weight:600;border-bottom:1px solid #f2f2f2;">${valor}</td>
    </tr>`;
}

// Um bloco de seção com título laranja em caixa alta + tabela de campos
// dentro de um cartão com borda arredondada.
export function blocoSecao(titulo: string, linhasHtml: string): string {
  if (!linhasHtml.trim()) return "";
  return `
    <tr>
      <td style="padding:22px 28px 0;">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.8px;color:${O2_LARANJA};text-transform:uppercase;font-family:${FONTE};">${titulo}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${O2_CINZA_CLARO};border-radius:10px;overflow:hidden;">
          ${linhasHtml}
        </table>
      </td>
    </tr>`;
}

// Converte "yyyy-mm-dd" (formato de <input type="date"> e de datas ISO já
// normalizadas) pra "dd/mm/yyyy". Qualquer outro formato passa direto, sem
// tentar adivinhar (evita bagunçar texto livre digitado pela pessoa).
export function formatarData(valor: string): string {
  if (!valor) return "";
  const [ano, mes, dia] = valor.split("-");
  if (!ano || !mes || !dia || ano.length !== 4) return valor;
  return `${dia}/${mes}/${ano}`;
}

// Botão pílula (CTA), no estilo dos banners em pílula do manual de marca.
export function botaoPill(href: string, texto: string): string {
  return `
    <tr>
      <td style="padding:22px 28px 4px;" align="center">
        <a href="${href}" style="display:inline-block;background:${O2_LARANJA};color:#ffffff;font-family:${FONTE};font-weight:700;font-size:14px;text-decoration:none;padding:12px 28px;border-radius:999px;">${texto}</a>
      </td>
    </tr>`;
}

export function envolverEmailO2({
  badge,
  titulo,
  introducao,
  corpoHtml,
  protocolo,
  origem,
}: {
  badge: string;
  titulo: string;
  introducao: string;
  corpoHtml: string;
  protocolo: string;
  origem: string;
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
          <td style="padding:16px 28px 0;" align="center">
            <span style="display:inline-block;background:${O2_LARANJA};color:#ffffff;font-family:${FONTE};font-weight:700;font-size:11px;letter-spacing:0.6px;text-transform:uppercase;padding:6px 16px;border-radius:999px;">${badge}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:14px 28px 0;" align="center">
            <p style="margin:0;font-size:21px;font-weight:700;color:${O2_NAVY};font-family:${FONTE};">${titulo}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 0;" align="center">
            <p style="margin:0;font-size:14px;color:${O2_CINZA_MEDIO};font-family:${FONTE};line-height:1.5;">${introducao}</p>
          </td>
        </tr>

        ${corpoHtml}

        <tr>
          <td style="padding:28px 28px 24px;">
            <hr style="border:none;border-top:1px solid ${O2_CINZA_CLARO};margin:0 0 16px;" />
            <p style="margin:0;font-size:11px;color:${O2_CINZA_MEDIO};font-family:${FONTE};text-align:center;">
              Enviado automaticamente pela Plataforma O2 — <span style="color:${O2_LARANJA};font-weight:600;">${origem}</span><br />
              Protocolo ${protocolo} · <span style="color:${O2_LARANJA};">#SomosTodosO2</span>
            </p>
          </td>
        </tr>
      </table>
    </div>`;
}
