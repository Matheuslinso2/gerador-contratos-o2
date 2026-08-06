const MESES_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function formatarCompetencia(competencia: string): string {
  const [ano, mes] = competencia.split("-");
  const nomeMes = MESES_PT[Number(mes) - 1];
  return nomeMes ? `${nomeMes} de ${ano}` : competencia;
}

function formatarData(data: string | null): string {
  if (!data) return "—";
  const [ano, mes, dia] = data.split("-");
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : data;
}

function formatarValor(valor: number | null): string {
  if (valor === null) return "—";
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export type FaturaParaEmail = {
  arquivo_nome: string;
  tipo_documento: string | null;
  vencimento: string | null;
  valor: number | null;
  numero_documento: string | null;
  senha_pdf: string | null;
};

// E-mail de envio de fatura pra imobiliária -- identidade visual O2
// Seguros (mesmo padrão navy/coral usado nos alertas internos), com os
// dados essenciais (vencimento, valor, seguradora, produto) destacados no
// corpo, já que o anexo sozinho nem sempre é aberto na hora.
export function montarEmailFatura({
  nomeImobiliaria,
  seguradora,
  competencia,
  faturas,
}: {
  nomeImobiliaria: string;
  seguradora: string;
  competencia: string;
  faturas: FaturaParaEmail[];
}): { assunto: string; html: string } {
  const competenciaTexto = formatarCompetencia(competencia);
  const assunto = `Fatura ${seguradora} — ${competenciaTexto} — ${nomeImobiliaria}`;

  // Vencimento/valor de referência: prioriza o boleto (é o documento
  // pagável); se não tiver nenhum marcado como boleto, usa o primeiro que
  // tiver um valor preenchido.
  const referencia =
    faturas.find((f) => f.tipo_documento === "boleto" && f.valor !== null) ??
    faturas.find((f) => f.valor !== null) ??
    faturas[0];

  const linhasAnexos = faturas
    .map((f) => `<li style="margin-bottom: 4px;">${f.arquivo_nome}${f.tipo_documento ? ` (${f.tipo_documento})` : ""}</li>`)
    .join("");

  // Nem toda seguradora protege o PDF com senha (hoje só a Porto) -- só
  // mostra esse aviso quando pelo menos um dos anexos realmente precisou
  // de senha pra abrir.
  const senha = faturas.map((f) => f.senha_pdf).find((s): s is string => !!s) ?? null;
  const blocoSenha = senha
    ? `
        <div style="background: #fff3f0; border: 1px solid #ff5a3b; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px;">Senha para abrir o PDF</p>
          <p style="margin: 4px 0 0; font-size: 18px; font-weight: bold; color: #ff5a3b; letter-spacing: 1px;">${senha}</p>
        </div>`
    : "";

  const html = `
    <div style="max-width: 560px; margin: 0 auto; font-family: Arial, sans-serif;">
      <div style="background: #00213a; padding: 20px 24px; border-radius: 10px 10px 0 0;">
        <img src="cid:o2-logo" alt="O2 Seguros" height="28" style="display: block;" />
      </div>
      <div style="border: 1px solid #eee; border-top: none; border-radius: 0 0 10px 10px; padding: 24px;">
        <p style="margin: 0 0 16px; font-size: 15px; color: #00213a;">Olá, ${nomeImobiliaria}!</p>
        <p style="margin: 0 0 20px; font-size: 14px; color: #333; line-height: 1.5;">
          Segue em anexo a fatura da <strong>${seguradora}</strong> referente a <strong>${competenciaTexto}</strong>.
        </p>
        <div style="background: #f7f9fb; border: 1px solid #e5e9ee; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #00213a;">
            <tr>
              <td style="padding: 4px 0; color: #888;">Seguradora</td>
              <td style="padding: 4px 0; text-align: right; font-weight: bold;">${seguradora}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #888;">Competência</td>
              <td style="padding: 4px 0; text-align: right; font-weight: bold;">${competenciaTexto}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #888;">Vencimento</td>
              <td style="padding: 4px 0; text-align: right; font-weight: bold;">${formatarData(referencia?.vencimento ?? null)}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #888;">Valor</td>
              <td style="padding: 4px 0; text-align: right; font-weight: bold; color: #ff5a3b;">${formatarValor(referencia?.valor ?? null)}</td>
            </tr>
          </table>
        </div>
        ${blocoSenha}
        <p style="margin: 0 0 6px; font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px;">
          Anexo${faturas.length > 1 ? "s" : ""} (${faturas.length})
        </p>
        <ul style="margin: 0 0 20px; padding-left: 18px; font-size: 13px; color: #333;">
          ${linhasAnexos}
        </ul>
        <p style="margin: 0; font-size: 13px; color: #888; line-height: 1.5;">
          Qualquer dúvida, fale com a sua corretora O2 Seguros.
        </p>
      </div>
      <p style="text-align: center; color: #aaa; font-size: 11px; margin-top: 12px;">
        Enviado automaticamente pelo sistema de faturas da O2 Seguros.
      </p>
    </div>
  `;

  return { assunto, html };
}
