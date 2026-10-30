import { FONTE, O2_CINZA_ESCURO, O2_CINZA_MEDIO } from "@/lib/integracoes/emailO2";
import { dataBr, resumoEmTexto, type DadosPanorama } from "./panoramaCampanha";

// E-mail de PARCIAL de uma campanha com metas (30/10/2026): um texto da equipe
// + a imagem do PANORAMA da imobiliária (versão gravada em campanhas_panoramas)
// + os mesmos números em texto, para quem bloqueia imagens. Cada imobiliária
// recebe só os PRÓPRIOS números. Substitui o bloco HTML da parcial anterior.

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const TEXTO_PADRAO_PARCIAL = "Olá, parceiro O2!\n\nSegue o acompanhamento da {nome} na campanha {campanha}, com os números até {data}.\n\nNossa equipe está à disposição para ajudar a chegar lá. Envie suas cotações!";

/** Troca {nome}, {campanha} e {data} pelos dados da imobiliária e escapa o HTML. */
export function aplicarTexto(texto: string, d: DadosPanorama): string {
  return texto
    .replace(/\{nome\}/gi, d.participante)
    .replace(/\{campanha\}/gi, d.campanha)
    .replace(/\{data\}/gi, dataBr(d.posicaoEm));
}

function paragrafos(texto: string): string {
  return texto
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) => `
    <tr>
      <td style="padding:16px 28px 0;" align="left">
        <p style="margin:0;font-size:14px;line-height:1.6;color:${O2_CINZA_ESCURO};font-family:${FONTE};">${escapar(p).replace(/\n/g, "<br>")}</p>
      </td>
    </tr>`
    )
    .join("");
}

export function montarEmailParcial(d: DadosPanorama, texto: string, imagemUrl: string) {
  const textoFinal = aplicarTexto(texto, d);
  const alt = `Panorama da ${d.participante} na campanha ${d.campanha}: ${resumoEmTexto(d)}`;
  const imagem = `
    <tr>
      <td style="padding:20px 28px 0;" align="center">
        <img src="${imagemUrl}" width="544" alt="${escapar(alt)}" style="display:block;width:100%;max-width:544px;height:auto;border:0;border-radius:12px;" />
        <p style="margin:8px 0 0;font-size:12px;line-height:1.5;color:${O2_CINZA_MEDIO};font-family:${FONTE};">${escapar(resumoEmTexto(d))}</p>
      </td>
    </tr>`;
  return {
    nome: `Parcial ${d.versao} — ${d.campanha} — ${d.participante} (${dataBr(d.posicaoEm).slice(0, 5)})`,
    assunto: `Parcial da campanha ${d.campanha} — ${d.participante}`,
    titulo: d.campanha,
    introducao: `Acompanhamento parcial até ${dataBr(d.posicaoEm)}`,
    corpoHtml: paragrafos(textoFinal) + imagem + `<tr><td style="padding:12px 0 0;"></td></tr>`,
  };
}
