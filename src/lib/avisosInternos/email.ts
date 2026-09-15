import { envolverEmailO2, blocoSecao, linhaCampo, O2_CINZA_ESCURO, FONTE } from "@/lib/integracoes/emailO2";
import { TemplateAvisoInterno } from "./templates";

// Reusa a mesma moldura dos e-mails internos de notificação (envolverEmailO2)
// -- diferente de campanhas comerciais, aviso interno não tem rodapé de
// descadastro (a equipe não "cancela inscrição" de aviso da RH) e usa o
// remetente transacional (avisos@), não o de marketing.
function blocoMensagem(mensagem: string): string {
  if (!mensagem.trim()) return "";
  return `
    <tr>
      <td style="padding:18px 28px 0;">
        <p style="margin:0;font-size:14px;color:${O2_CINZA_ESCURO};font-family:${FONTE};line-height:1.6;white-space:pre-wrap;">${mensagem}</p>
      </td>
    </tr>`;
}

export function montarHtmlAvisoInterno(template: TemplateAvisoInterno, valores: Record<string, string>, mensagem: string): string {
  const linhasDestaques = template
    .montarDestaques(valores)
    .map((d) => linhaCampo(d.label, d.valor))
    .join("");

  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

  return envolverEmailO2({
    badge: template.badge,
    titulo: template.montarTitulo(valores),
    introducao: template.introducao,
    corpoHtml: blocoSecao("Detalhes", linhasDestaques) + blocoMensagem(mensagem),
    protocolo: hoje,
    origem: "Recursos Humanos O2",
  });
}
