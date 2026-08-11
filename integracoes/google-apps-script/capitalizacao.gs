const CAPITALIZACAO_FORM_ID = "1aazIlD6x06iPaEzW6MZlwqO3N5aaADyrvZOtQxDb958";

// Colunas da aba "Respostas ao formulário 1". O Google mantém colunas de
// perguntas antigas, mesmo depois que elas são movidas ou removidas do Form.
// Por isso a integração usa o mapa conferido abaixo, e não o texto do título.
const CAPITALIZACAO_COLUNA_POR_ITEM = {
  "1762240566": 3,
  "479542475": 4,
  "1475427667": 5,
  "216274232": 6,
  "223376031": 7,
  "902374147": 8,
  "1038717666": 9,
  "713914101": 10,
  "1032078892": 11,
  "1275123438": 12,
  "176389459": 13,
  "1680330080": 14,
  "92785321": 15,
  "1284516938": 16,
  "1295771338": 17,
  "1059021897": 18,
  "859207030": 19,
  "970527844": 20,
  "941073464": 21,
  "107538752": 22,
  "1037285935": 23,
  "1797521819": 24,
  "2098342311": 25,
  "1108627550": 26,
  "1454235893": 27,
  "1170741619": 28,
  "948185925": 29,
  "1192154658": 30,
  "906171356": 31,
  "1335486668": 32,
  "1892091955": 33,
  "194415499": 34,
  "593914370": 35,
  "769715249": 36,
  "639670991": 37,
  "1527323752": 38,
  "1933515754": 39,
  "40367235": 40,
  "1372581927": 41,
  "198024116": 42,
  "937881142": 43,
  "1182114877": 44,
  "645972109": 45,
  "1187818133": 46,
  "1828669294": 47,
  "616928511": 48,
  "2139650385": 49,
  "1553034136": 50,
  "513208961": 52,
  "948679040": 53,
};

function configurarIntegracaoCapitalizacao() {
  const ui = SpreadsheetApp.getUi();
  const urlPrompt = ui.prompt(
    "Integração O2",
    "Cole a URL da integração fornecida pela O2:",
    ui.ButtonSet.OK_CANCEL
  );
  if (urlPrompt.getSelectedButton() !== ui.Button.OK) return;
  const tokenPrompt = ui.prompt(
    "Integração O2",
    "Cole o token secreto fornecido pela O2:",
    ui.ButtonSet.OK_CANCEL
  );
  if (tokenPrompt.getSelectedButton() !== ui.Button.OK) return;

  PropertiesService.getScriptProperties().setProperties({
    O2_CAPITALIZACAO_URL: urlPrompt.getResponseText().trim(),
    O2_CAPITALIZACAO_TOKEN: tokenPrompt.getResponseText().trim(),
  });

  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "enviarCapitalizacaoParaO2")
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger("enviarCapitalizacaoParaO2")
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onFormSubmit()
    .create();

  ui.alert("Integração configurada com sucesso.");
}

function normalizarRespostaCapitalizacao(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, "America/Sao_Paulo", "yyyy-MM-dd");
  }
  if (Array.isArray(value)) return value.map(normalizarRespostaCapitalizacao);
  return value === null || value === undefined ? "" : String(value).trim();
}

function idRespostaCapitalizacao(values, sheetId) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    [sheetId].concat(values.map(normalizarRespostaCapitalizacao)).join("\u001f"),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/, "");
}

function enviarCapitalizacaoParaO2(event) {
  if (!event || !event.range || !event.values) {
    throw new Error("Evento de envio da planilha ausente.");
  }
  const properties = PropertiesService.getScriptProperties();
  const url = properties.getProperty("O2_CAPITALIZACAO_URL");
  const token = properties.getProperty("O2_CAPITALIZACAO_TOKEN");
  if (!url || !token) {
    throw new Error("Integração não configurada. Execute configurarIntegracaoCapitalizacao.");
  }

  const values = event.values;
  const answers = {};
  Object.keys(CAPITALIZACAO_COLUNA_POR_ITEM).forEach((itemId) => {
    const column = CAPITALIZACAO_COLUNA_POR_ITEM[itemId];
    answers[itemId] = normalizarRespostaCapitalizacao(values[column - 1]);
  });

  // O campo de renda da PJ foi acrescentado ao fim da planilha; há duas
  // colunas históricas com o mesmo título. A vigente será a que vier preenchida.
  answers["1865007298"] = normalizarRespostaCapitalizacao(values[53] || values[54]);

  const timestamp = event.range.getSheet().getRange(event.range.getRow(), 1).getValue();
  const payload = {
    formId: CAPITALIZACAO_FORM_ID,
    responseId: idRespostaCapitalizacao(values, event.range.getSheet().getSheetId()),
    submittedAt: timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString(),
    respondentEmail: normalizarRespostaCapitalizacao(values[1]),
    editResponseUrl: "",
    answers,
  };

  const result = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { "x-o2-integracao-token": token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const status = result.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error("Integração O2 falhou (HTTP " + status + "): " + result.getContentText());
  }
}
