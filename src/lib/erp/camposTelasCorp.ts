// Campos das telas do Corp lidos UM A UM por recorte justo (OCR local do Windows, várias resoluções/tratamentos, votação). Coordenadas = tela original 1366x768 (a janela do documento
// fica sempre no mesmo lugar). tipo diz como interpretar: data, dinheiro, pct, int, digitos (CPF/CEP/nº), texto, codigo (nº curto). Nível 8 (Corp = comparação).
export type Tipo = "data" | "dinheiro" | "pct" | "int" | "digitos" | "texto" | "codigo";
export type Campo = { tela: string; campo: string; rect: [number, number, number, number]; tipo: Tipo };

const c = (tela: string, campo: string, rect: [number, number, number, number], tipo: Tipo): Campo => ({ tela, campo, rect, tipo });

export const CAMPOS: Campo[] = [
  // ---- documento ----
  c("documento", "dt_emissao", [366, 238, 470, 256], "data"),
  c("documento", "numero_apolice", [486, 238, 615, 256], "digitos"),
  c("documento", "numero_endosso", [627, 238, 735, 256], "digitos"),
  c("documento", "dt_proposta", [362, 286, 450, 302], "data"),
  c("documento", "tipo_documento", [488, 286, 760, 302], "texto"),
  c("documento", "motivo_endosso", [362, 326, 758, 342], "texto"),
  c("documento", "apolice_endossada", [363, 378, 490, 394], "digitos"),
  c("documento", "seguradora_codigo", [366, 426, 400, 438], "codigo"),
  c("documento", "seguradora_nome", [421, 424, 760, 440], "texto"),
  c("documento", "ramo_codigo", [366, 472, 400, 484], "codigo"),
  c("documento", "ramo_nome", [421, 470, 760, 486], "texto"),
  c("documento", "cliente_codigo", [366, 518, 400, 530], "codigo"),
  c("documento", "cliente_nome", [421, 516, 745, 532], "texto"),
  c("documento", "numero_proposta", [363, 579, 489, 594], "digitos"),
  c("documento", "vigencia_inicio", [528, 579, 610, 594], "data"),
  c("documento", "vigencia_fim", [664, 579, 746, 594], "data"),
  c("documento", "forma_pagamento", [799, 231, 950, 245], "texto"),
  c("documento", "qtde_parcelas", [914, 257, 958, 269], "int"),
  c("documento", "prazo_1a_parcela", [1081, 229, 1122, 241], "int"),
  c("documento", "dia_fixo", [1081, 263, 1122, 275], "int"),
  c("documento", "valor_1a_parcela", [997, 333, 1087, 348], "dinheiro"),
  c("documento", "premio_liquido", [862, 313, 947, 328], "dinheiro"),
  c("documento", "premio_adicional", [862, 345, 947, 360], "dinheiro"),
  c("documento", "desconto", [862, 377, 947, 392], "dinheiro"),
  c("documento", "custo", [862, 409, 947, 424], "dinheiro"),
  c("documento", "iof", [862, 441, 947, 456], "dinheiro"),
  c("documento", "iof_aliquota", [803, 447, 852, 461], "pct"),
  c("documento", "premio_total", [862, 475, 947, 490], "dinheiro"),
  c("documento", "comissao_base_tipo", [993, 383, 1130, 398], "texto"),
  c("documento", "comissao_base", [1030, 406, 1114, 421], "dinheiro"),
  c("documento", "comissao_pct", [1030, 438, 1114, 453], "pct"),
  c("documento", "comissao_valor", [1030, 471, 1114, 486], "dinheiro"),
  c("documento", "digitacao_inicial", [906, 515, 1062, 530], "texto"),
  c("documento", "ultima_alteracao", [906, 537, 1062, 552], "texto"),
  // ---- acompanhamento ----
  c("acompanhamento", "dt_emissao", [264, 252, 350, 268], "data"),
  c("acompanhamento", "numero_apolice", [383, 252, 515, 268], "digitos"),
  c("acompanhamento", "numero_endosso", [533, 252, 665, 268], "digitos"),
  c("acompanhamento", "data_recebimento", [264, 341, 350, 357], "data"),
  c("acompanhamento", "recebido_por", [520, 299, 665, 313], "texto"),
  c("acompanhamento", "data_entrega", [264, 437, 350, 453], "data"),
  c("acompanhamento", "forma_entrega", [393, 438, 650, 454], "texto"),
  c("acompanhamento", "entregue_para", [393, 485, 665, 501], "texto"),
  c("acompanhamento", "assinatura_proposta", [270, 555, 420, 571], "texto"),
  // ---- comissões (cabeçalho) ----
  c("comissoes", "base_calculo", [480, 228, 632, 242], "texto"),
  c("comissoes", "valor_base", [479, 253, 580, 267], "dinheiro"),
  c("comissoes", "pct_sobre_base", [479, 279, 580, 293], "pct"),
  c("comissoes", "valor_total", [479, 305, 580, 319], "dinheiro"),
  c("comissoes", "forma_recebimento", [480, 330, 632, 344], "texto"),
  c("comissoes", "premiacao_tipo", [654, 228, 812, 242], "texto"),
  c("comissoes", "premiacao_valor", [653, 305, 754, 319], "dinheiro"),
  c("comissoes", "premiacao_forma", [654, 330, 812, 344], "texto"),
  // ---- itens ----
  c("itens", "item", [230, 246, 272, 262], "int"),
  c("itens", "inicio_contrato", [290, 246, 372, 262], "data"),
  c("itens", "final_contrato", [400, 246, 482, 262], "data"),
  c("itens", "cep", [373, 307, 466, 321], "digitos"),
  c("itens", "logradouro", [520, 307, 850, 321], "texto"),
  c("itens", "numero", [863, 307, 905, 321], "texto"),
  c("itens", "complemento", [373, 343, 466, 357], "texto"),
  c("itens", "bairro", [480, 343, 655, 357], "texto"),
  c("itens", "cidade", [669, 343, 848, 357], "texto"),
  c("itens", "uf", [863, 343, 890, 357], "texto"),
  ...[0, 1, 2].flatMap((i) => {
    const y = 417 + i * 26.5;
    return [c("itens", `garantido${i + 1}_nome`, [229, y, 560, y + 14], "texto"), c("itens", `garantido${i + 1}_pessoa`, [578, y, 714, y + 14], "texto"), c("itens", `garantido${i + 1}_cpf_cnpj`, [736, y, 914, y + 14], "digitos")] as Campo[];
  }),
  ...[0, 1, 2, 3].flatMap((i) => {
    const y = 522 + i * 18;
    return [c("itens", `garantia${i + 1}_nome`, [243, y, 552, y + 13], "texto"), c("itens", `garantia${i + 1}_importancia`, [556, y, 656, y + 13], "dinheiro"), c("itens", `garantia${i + 1}_taxa`, [660, y, 718, y + 13], "dinheiro"), c("itens", `garantia${i + 1}_premio`, [722, y, 800, y + 13], "dinheiro"), c("itens", `garantia${i + 1}_franquia`, [805, y, 892, y + 13], "dinheiro")] as Campo[];
  }),
  // ---- repasses ----
  c("repasses", "canal_vendas", [896, 223, 1138, 237], "texto"),
  c("repasses", "corretagem", [895, 277, 1140, 291], "texto"),
  c("repasses", "repasse_para", [342, 438, 680, 452], "texto"),
  c("repasses", "comissao_base_calculo", [480, 486, 632, 500], "texto"),
  c("repasses", "comissao_valor_base", [479, 512, 580, 526], "dinheiro"),
  c("repasses", "comissao_pct", [479, 538, 580, 552], "pct"),
  c("repasses", "comissao_valor_total", [479, 564, 580, 578], "dinheiro"),
  c("repasses", "comissao_forma_repasse", [480, 588, 632, 602], "texto"),
  c("repasses", "premiacao_base_calculo", [653, 486, 800, 500], "texto"),
  c("repasses", "premiacao_valor_base", [652, 512, 755, 526], "dinheiro"),
  c("repasses", "premiacao_pct", [652, 538, 755, 552], "pct"),
  c("repasses", "premiacao_valor_total", [652, 564, 755, 578], "dinheiro"),
  c("repasses", "premiacao_forma_repasse", [653, 588, 812, 602], "texto"),
  ...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => {
    const y = 219 + i * 20.2;
    return [c("repasses", `linha${i + 1}_agente`, [249, y, 297, y + 14], "texto"), c("repasses", `linha${i + 1}_produtor`, [301, y, 557, y + 14], "texto"), c("repasses", `linha${i + 1}_pct`, [603, y, 676, y + 14], "pct"), c("repasses", `linha${i + 1}_total`, [680, y, 788, y + 14], "dinheiro")] as Campo[];
  }),
];

export const TELAS_COM_CAMPOS = [...new Set(CAMPOS.map((x) => x.tela))];
export const VARIANTES = ["a", "c", "d"] as const;
