import { envolverEmailO2, blocoSecao, linhaCampo } from "@/lib/integracoes/emailO2";
import { TemplateAvisoInterno } from "./templates";

// Reusa a mesma moldura dos e-mails internos de notificação (envolverEmailO2)
// -- diferente de campanhas comerciais, aviso interno não tem rodapé de
// descadastro (a equipe não "cancela inscrição" de aviso da RH) e usa o
// remetente transacional (avisos@), não o de marketing.
//
// mensagemHtml já vem pronto em blocos <tr><td>...</td></tr> -- é a mesma
// saída do EditorCorpo de Campanhas (reaproveitado aqui, pedido do
// Matheus, 01/10/2026: recado de aviso interno ganhou suporte a imagem/
// negrito/cor, antes só tinha textarea puro). Por isso entra direto no
// corpoHtml, sem reembrulhar em <p> como a versão anterior fazia com
// texto puro.
export function montarHtmlAvisoInterno(template: TemplateAvisoInterno, valores: Record<string, string>, mensagemHtml: string): string {
  const linhasDestaques = template
    .montarDestaques(valores)
    .map((d) => linhaCampo(d.label, d.valor))
    .join("");

  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

  return envolverEmailO2({
    badge: template.badge,
    titulo: template.montarTitulo(valores),
    introducao: template.introducao,
    corpoHtml: blocoSecao("Detalhes", linhasDestaques) + mensagemHtml,
    protocolo: hoje,
    origem: "Recursos Humanos O2",
  });
}
