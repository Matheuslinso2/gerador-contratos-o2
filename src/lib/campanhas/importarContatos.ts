import * as XLSX from "xlsx";

// Planilha de prospecção (item 8 da reunião de 15/09/2026, refinada pelo
// Matheus em seguida): imobiliárias SEM cadastro no Workspace, então não
// segue o layout fixo de nenhuma exportação de sistema conhecida --
// provavelmente montada à mão pelo comercial. 4 campos: CNPJ/CPF, e-mail,
// nome da imobiliária (a empresa) e nome do responsável (quem de fato
// recebe o e-mail -- pessoa diferente do nome da imobiliária). Cabeçalho
// reconhecido por nome (várias grafias aceitas), não por posição fixa.
export type ContatoImportado = { nomeImobiliaria: string; nomeResponsavel: string | null; email: string; cpfCnpj: string | null };

const CANDIDATOS_NOME_IMOBILIARIA = ["nome", "nome da imobiliaria", "nome da imobiliária", "imobiliaria", "imobiliária", "razao social", "razão social", "empresa"];
const CANDIDATOS_NOME_RESPONSAVEL = ["responsavel", "responsável", "nome do responsavel", "nome do responsável", "contato", "nome do contato"];
const CANDIDATOS_EMAIL = ["email", "e-mail", "e mail"];
const CANDIDATOS_CPF_CNPJ = ["cpf/cnpj", "cpf_cnpj", "cpf", "cnpj", "documento"];

function normalizarCabecalho(v: unknown): string {
  return (v ?? "").toString().trim().toLowerCase();
}

function encontrarIndice(cabecalhos: string[], candidatos: string[]): number {
  return cabecalhos.findIndex((c) => candidatos.includes(c));
}

// Lê a planilha e devolve os contatos válidos (com e-mail), deduplicados
// por e-mail dentro do próprio arquivo -- a deduplicação contra contatos já
// importados antes (upsert por grupo_id+email) fica por conta de quem
// chama, na hora de gravar.
export function importarContatosExcel(buffer: Buffer): ContatoImportado[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const planilha = wb.Sheets[wb.SheetNames[0]];
  const linhas: unknown[][] = XLSX.utils.sheet_to_json(planilha, { header: 1, raw: false, defval: "" });
  if (!linhas.length) return [];

  const cabecalhos = (linhas[0] as unknown[]).map(normalizarCabecalho);
  const idxNomeImobiliaria = encontrarIndice(cabecalhos, CANDIDATOS_NOME_IMOBILIARIA);
  const idxNomeResponsavel = encontrarIndice(cabecalhos, CANDIDATOS_NOME_RESPONSAVEL);
  const idxEmail = encontrarIndice(cabecalhos, CANDIDATOS_EMAIL);
  const idxCpfCnpj = encontrarIndice(cabecalhos, CANDIDATOS_CPF_CNPJ);

  if (idxEmail === -1) throw new Error('Não encontrei uma coluna de e-mail na planilha (esperado "E-mail" ou "Email").');

  const vistos = new Set<string>();
  const contatos: ContatoImportado[] = [];
  for (const linha of linhas.slice(1)) {
    const email = (linha[idxEmail] ?? "").toString().trim().toLowerCase();
    if (!email || !email.includes("@") || vistos.has(email)) continue;
    vistos.add(email);
    const nomeImobiliaria = idxNomeImobiliaria >= 0 ? (linha[idxNomeImobiliaria] ?? "").toString().trim() : "";
    const nomeResponsavel = idxNomeResponsavel >= 0 ? (linha[idxNomeResponsavel] ?? "").toString().trim() : "";
    const cpfCnpj = idxCpfCnpj >= 0 ? (linha[idxCpfCnpj] ?? "").toString().trim() : "";
    contatos.push({
      nomeImobiliaria: nomeImobiliaria || email,
      nomeResponsavel: nomeResponsavel || null,
      email,
      cpfCnpj: cpfCnpj || null,
    });
  }
  return contatos;
}
