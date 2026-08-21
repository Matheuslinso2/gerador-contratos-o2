// Recebe, via Web App (doPost), os dados de cada envio das landing pages
// da Plataforma O2 (Ficha Fiança e Capitalização) e grava uma linha na
// aba certa desta planilha — mesmo espírito de "uma linha por envio" que
// o Google Forms já faz, só que numa planilha própria e separada.
//
// Atende os dois formulários porque cada envio diz de qual formulário é
// (campo "formulario" no corpo), e cada um tem sua própria aba e
// cabeçalho, criados automaticamente na primeira vez que algo chega —
// ver CONFIG abaixo. Pra atender um formulário novo no futuro, só
// adicionar uma entrada nova em CONFIG, sem mexer no resto.
//
// Direção OPOSTA ao capitalizacao.gs (nesta mesma pasta): aqui é a
// Plataforma O2 que EMPURRA dados pra dentro da planilha, não a planilha
// que envia pra fora.
//
// Configuração (uma vez só):
// 1. Nesta planilha: Extensões > Apps Script, cole este arquivo inteiro.
// 2. Troque o valor de TOKEN_ESPERADO abaixo por um texto secreto (qualquer
//    string longa e aleatória) — o mesmo texto vai pra variável de ambiente
//    de cada formulário na Vercel (pode ser o mesmo texto pros dois).
// 3. Implantar > Nova implantação > tipo "App da Web". Executar como "Eu",
//    Quem pode acessar "Qualquer pessoa". Autorize quando pedir (primeira
//    vez sempre pede permissão — precisa ser feito no seu navegador real,
//    não funciona em navegador automatizado).
// 4. Copie a URL do App da Web gerada — é a MESMA URL usada pelos dois
//    formulários (só o conteúdo enviado no corpo muda).
// 5. Se editar o código depois, "Nova implantação" de novo gera uma URL
//    NOVA — prefira "Gerenciar implantações > Editar > nova versão" pra
//    manter a mesma URL.

const TOKEN_ESPERADO = "ficha-fiança-landingpage-2026x12x08";

const CONFIG = {
  ficha_fianca: {
    aba: "Respostas",
    cabecalho: [
      "Data/Hora",
      "Protocolo",
      "Status",
      "Card ID",
      "Link do Card",
      "Avisos de mapeamento",

      "E-mail de contato (quem preencheu)",
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
    ],
  },

  capitalizacao: {
    aba: "Capitalização",
    cabecalho: [
      "Data/Hora",
      "Protocolo",
      "Status",
      "Card ID",
      "Link do Card",

      "E-mail de contato",
      "Quem administra",
      "Nome da imobiliária",
      "E-mail da imobiliária",
      "Nome do corretor",
      "E-mail do corretor",

      "Valor do título",
      "Encargos considerados",
      "Prazo",
      "Forma de pagamento",
      "Titular do cartão",
      "CPF do titular do cartão",

      "Tipo de pessoa do locatário",
      "E-mail do locatário",
      "Telefone do locatário",
      "Locatário PF - Nome",
      "Locatário PF - CPF",
      "Locatário PF - Nascimento",
      "Locatário PF - RG",
      "Locatário PF - Órgão expedidor",
      "Locatário PF - UF do RG",
      "Locatário PF - Data de emissão",
      "Locatário PF - Estado civil",
      "Locatário PF - Profissão",
      "Locatário PF - Renda mensal",
      "Locatário PJ - Razão social",
      "Locatário PJ - CNPJ",
      "Locatário PJ - Fundação",
      "Locatário PJ - Inscrição estadual",
      "Locatário PJ - Sócio responsável",
      "Locatário PJ - CPF do sócio",
      "Locatário PJ - Faturamento mensal",

      "CEP do imóvel",
      "Logradouro do imóvel",
      "Número",
      "Complemento",
      "Bairro",
      "Cidade",
      "UF",

      "Tipo de pessoa do locador",
      "Locador PF - Nome",
      "Locador PF - CPF",
      "Locador PF - Nascimento",
      "Locador PF - RG",
      "Locador PF - Órgão expedidor",
      "Locador PF - UF do RG",
      "Locador PJ - Razão social",
      "Locador PJ - CNPJ",
      "Locador PJ - Fundação",
      "Locador PJ - Inscrição estadual",
      "Locador PJ - Sócio responsável",
      "Locador PJ - CPF do sócio",
      "Locador PJ - Telefone",
    ],
  },

  rc_obras: {
    aba: "RC Obras",
    cabecalho: [
      "Data/Hora",
      "Protocolo",
      "Status",

      "E-mail de contato",
      "Telefone de contato",
      "Nome completo",
      "CPF/CNPJ",

      "CEP da obra",
      "Logradouro",
      "Número",
      "Complemento",
      "Bairro",
      "Cidade",
      "UF",

      "Reforma ou construção do zero",
      "Reforço estrutural",
      "Data de início da obra",
      "Data de fim da obra",
      "% de evolução da obra",

      "Cobertura Básica - Obras Civis em Construção",
      "Despesas de Desentulho",
      "Danos em Consequência de Erro de Projeto/Risco do Fabricante",
      "Equipamentos Móveis e Estacionários",
      "Equipamentos de Pequeno e Médio Porte",
      "Responsabilidade Civil Geral e Cruzada Riscos de Engenharia",
      "Responsabilidade Civil Geral Por Danos Morais Riscos de Engenharia",
      "Responsabilidade Civil por Danos Morais Empregador",
      "Responsabilidade Civil Do Empregador",
    ],
  },
};

function respostaJson(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}

// Cria a aba automaticamente (com o cabeçalho certo) na primeira vez que
// um envio daquele formulário chega — não precisa criar a aba na mão.
function abaComCabecalho(nomeAba, cabecalho) {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  const aba = planilha.getSheetByName(nomeAba) || planilha.insertSheet(nomeAba);
  if (aba.getLastRow() === 0) aba.appendRow(cabecalho);
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
    const config = CONFIG[corpo.formulario];
    if (!config) {
      return respostaJson({ ok: false, erro: "Formulário desconhecido: " + corpo.formulario });
    }
    const linha = config.cabecalho.map((_, indice) => (corpo.linha[indice] !== undefined ? corpo.linha[indice] : ""));
    abaComCabecalho(config.aba, config.cabecalho).appendRow(linha);
    return respostaJson({ ok: true });
  } catch (erro) {
    return respostaJson({ ok: false, erro: String(erro) });
  }
}
