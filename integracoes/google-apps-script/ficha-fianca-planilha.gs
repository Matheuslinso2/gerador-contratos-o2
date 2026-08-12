// Recebe, via Web App (doPost), os dados de cada envio da landing page
// /ficha-fianca e grava uma linha na aba "Respostas" desta planilha —
// mesmo espírito de "uma linha por envio" que o Google Forms já faz na
// planilha do formulário original (Ficha Fiança 5G), só que numa planilha
// própria e separada, controlada só por este script (não corre risco de
// coluna se deslocar se alguém editar o Forms no futuro).
//
// Direção OPOSTA ao capitalizacao.gs: aqui é a Plataforma O2 que EMPURRA
// dados pra dentro da planilha, não a planilha que envia pra fora.
//
// Configuração (uma vez só):
// 1. Nesta planilha: Extensões > Apps Script, cole este arquivo inteiro.
// 2. Troque o valor de TOKEN_ESPERADO abaixo por um texto secreto (qualquer
//    string longa e aleatória) — o mesmo texto vai pra variável de ambiente
//    GOOGLE_SHEETS_FICHA_FIANCA_SECRET na Vercel.
// 3. Implantar > Nova implantação > tipo "App da Web". Executar como "Eu",
//    Quem pode acessar "Qualquer pessoa". Autorize quando pedir (primeira
//    vez sempre pede permissão — precisa ser feito no seu navegador real,
//    não funciona em navegador automatizado).
// 4. Copie a URL do App da Web gerada — ela vai pra variável de ambiente
//    GOOGLE_SHEETS_FICHA_FIANCA_URL na Vercel.
// 5. Se editar o código depois, "Nova implantação" de novo gera uma URL
//    NOVA — prefira "Gerenciar implantações > Editar > nova versão" pra
//    manter a mesma URL.

const TOKEN_ESPERADO = "COLE_AQUI_UM_TOKEN_SECRETO_LONGO";

const CABECALHO = [
  "Data/Hora",
  "Protocolo",
  "Status",
  "Card ID",
  "Link do Card",
  "Avisos de mapeamento",

  "Você é",
  "Imóvel será administrado?",
  "Nome administradora/corretor",
  "E-mail administradora/corretor",
  "Telefone administradora/corretor",
  "Nome proprietário",
  "E-mail proprietário",
  "Telefone proprietário",

  "Finalidade do imóvel",
  "CEP",
  "Logradouro",
  "Número",
  "Complemento",
  "Bairro",
  "Cidade",
  "UF",
  "Aluguel",
  "Condomínio",
  "IPTU",
  "Água",
  "Luz",
  "Gás",
  "Pacote Locação (Total)",
  "Prazo de vigência (texto)",

  "Tipo de pessoa do locatário",
  "PJ - Razão social",
  "PJ - CNPJ",
  "PJ - E-mail",
  "PJ - Telefone",
  "PJ - Comentários",

  "Locatário 1 - Nome",
  "Locatário 1 - CPF",
  "Locatário 1 - E-mail",
  "Locatário 1 - Telefone",
  "Locatário 1 - Profissão",
  "Locatário 1 - Renda mensal",
  "Locatário 1 - Empresa (nome)",
  "Locatário 1 - Empresa (salário bruto)",
  "Locatário 1 - Empresa (telefone)",

  "Locatário 2 - Nome",
  "Locatário 2 - CPF",
  "Locatário 2 - E-mail",
  "Locatário 2 - Telefone",
  "Locatário 2 - Profissão",
  "Locatário 2 - Renda mensal",
  "Locatário 2 - Empresa (nome)",
  "Locatário 2 - Empresa (salário bruto)",
  "Locatário 2 - Empresa (telefone)",

  "Locatário 3 - Nome",
  "Locatário 3 - CPF",
  "Locatário 3 - E-mail",
  "Locatário 3 - Telefone",
  "Locatário 3 - Profissão",
  "Locatário 3 - Renda mensal",
  "Locatário 3 - Empresa (nome)",
  "Locatário 3 - Empresa (salário bruto)",
  "Locatário 3 - Empresa (telefone)",

  "Seguro Incêndio",
];

function respostaJson(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}

function abaRespostas() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  const aba = planilha.getSheetByName("Respostas") || planilha.getSheets()[0];
  if (aba.getLastRow() === 0) aba.appendRow(CABECALHO);
  return aba;
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return respostaJson({ ok: false, erro: "Corpo da requisição ausente." });
    }
    const corpo = JSON.parse(e.postData.contents);
    if (corpo.token !== TOKEN_ESPERADO) {
      return respostaJson({ ok: false, erro: "Token inválido." });
    }
    const linha = CABECALHO.map((_, indice) => corpo.linha[indice] !== undefined ? corpo.linha[indice] : "");
    abaRespostas().appendRow(linha);
    return respostaJson({ ok: true });
  } catch (erro) {
    return respostaJson({ ok: false, erro: String(erro) });
  }
}
