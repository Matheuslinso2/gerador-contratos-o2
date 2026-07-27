import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  ImageRun,
  Packer,
  Header,
  Footer,
  PageNumber,
  BorderStyle,
} from "docx";

const COR_PRINCIPAL = "1F3B57";
const COR_TEXTO = "262626";
const COR_SECUNDARIA = "6B6B6B";

type Imobiliaria = {
  nome: string;
  cnpj: string;
  creci: string | null;
  endereco: string | null;
  texto_base_contrato: string;
  indice_reajuste: string;
  percentual_multa_atraso: number;
  percentual_juros_mora: number;
  percentual_honorarios_advocaticios: number;
  dia_vencimento_aluguel: number;
  plataforma_assinatura: string | null;
  logo_url: string | null;
};

type Cobertura = { nome: string; texto: string };

type SeguroIncendio = {
  seguradoraNome: string;
  produtoNome: string;
  clausulaBase: string;
  coberturas: Cobertura[];
};

export type ContratoParaDocx = {
  imobiliaria: Imobiliaria;
  tipoGarantiaNome: string;
  seguradoraNome: string | null;
  produtoNome: string;
  clausulaBase: string;
  coberturas: Cobertura[];
  seguroIncendio: SeguroIncendio | null;
  locador: string;
  locadorProcurador: boolean;
  locatario: string;
  ocupantesAdicionais: string | null;
  enderecoImovel: string;
  finalidade: "residencial" | "nao_residencial";
  valorAluguel: number;
  dataInicio: string;
  prazoMeses: number;
  fiador: string | null;
  valorCaucao: number | null;
  laudoModo: "nenhum" | "link" | "arquivo_separado" | "arquivo_embutido";
  laudoVistoriaUrl: string | null;
  laudoArquivoNome: string | null;
};

function paragrafosDeTexto(texto: string, opts: { italic?: boolean } = {}) {
  return texto
    .split(/\n\n+/)
    .map((bloco) => bloco.trim())
    .filter(Boolean)
    .map(
      (bloco) =>
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 180, line: 300 },
          children: [new TextRun({ text: bloco, italics: opts.italic, color: COR_TEXTO })],
        })
    );
}

function tituloSecao(texto: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 380, after: 180 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: COR_PRINCIPAL, space: 4 },
    },
    children: [new TextRun({ text: texto.toUpperCase(), bold: true, color: COR_PRINCIPAL, size: 24 })],
  });
}

function linhaDado(rotulo: string, valor: string) {
  return new Paragraph({
    spacing: { after: 90 },
    children: [
      new TextRun({ text: `${rotulo}: `, bold: true, color: COR_PRINCIPAL }),
      new TextRun({ text: valor, color: COR_TEXTO }),
    ],
  });
}

function blocoClausulaComCoberturas(
  subtitulo: string,
  clausulaBase: string,
  coberturas: Cobertura[]
) {
  return [
    new Paragraph({
      spacing: { after: 160 },
      children: [new TextRun({ text: subtitulo, bold: true, italics: true, color: COR_PRINCIPAL })],
    }),
    ...paragrafosDeTexto(clausulaBase),
    ...coberturas.flatMap((cob) => [
      new Paragraph({
        spacing: { before: 160, after: 80 },
        children: [
          new TextRun({ text: `Cobertura adicional: ${cob.nome}`, bold: true, italics: true, color: COR_PRINCIPAL }),
        ],
      }),
      ...paragrafosDeTexto(cob.texto),
    ]),
  ];
}

async function carregarLogo(logoUrl: string | null) {
  if (!logoUrl) return null;
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = logoUrl.split(".").pop()?.toLowerCase();
    const type = ext === "jpg" || ext === "jpeg" ? "jpg" : ext === "gif" ? "gif" : "png";
    return { buffer, type: type as "png" | "jpg" | "gif" };
  } catch {
    return null;
  }
}

function linhaAssinatura(rotulo: string, nomeCompleto?: string) {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 560, after: 40 },
      children: [new TextRun("_______________________________________")],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 20 },
      children: [new TextRun({ text: rotulo, bold: true, color: COR_TEXTO })],
    }),
    ...(nomeCompleto
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: nomeCompleto, size: 20, color: COR_SECUNDARIA })],
          }),
        ]
      : []),
  ];
}

const fmtMoeda = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtData = (iso: string) => {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
};

export async function gerarContratoDocx(c: ContratoParaDocx): Promise<Buffer> {
  const logo = await carregarLogo(c.imobiliaria.logo_url);

  const cabecalho: Paragraph[] = [];
  if (logo) {
    cabecalho.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
        children: [
          new ImageRun({
            data: logo.buffer,
            type: logo.type,
            transformation: { width: 210, height: 77 },
          }),
        ],
      })
    );
  }
  cabecalho.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 80 },
      children: [new TextRun({ text: "CONTRATO DE LOCAÇÃO", bold: true, color: COR_PRINCIPAL })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: `${c.imobiliaria.nome} — CNPJ ${c.imobiliaria.cnpj}${
            c.imobiliaria.creci ? ` — CRECI ${c.imobiliaria.creci}` : ""
          }`,
          size: 20,
          color: COR_SECUNDARIA,
        }),
      ],
    }),
    ...(c.imobiliaria.endereco
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 260 },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 8, color: COR_PRINCIPAL, space: 10 },
            },
            children: [new TextRun({ text: c.imobiliaria.endereco, size: 18, color: COR_SECUNDARIA })],
          }),
        ]
      : [
          new Paragraph({
            spacing: { after: 260 },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 8, color: COR_PRINCIPAL, space: 10 },
            },
            children: [],
          }),
        ])
  );

  // Bloco de identificação: dados específicos desta locação (não é cláusula jurídica,
  // é só a ficha de dados que varia a cada contrato). O texto jurídico "padrão" de
  // prazo/pagamento/multa/juros/honorários/uso/rescisão já vem pronto e correto dentro
  // do texto-base da imobiliária — não é gerado aqui.
  const dadosLocacao = [
    tituloSecao("Dados da Locação"),
    linhaDado(
      "Locador(es)",
      c.locador + (c.locadorProcurador ? " (representado por procurador/administradora)" : "")
    ),
    linhaDado("Locatário(s)", c.locatario),
    ...(c.ocupantesAdicionais ? [linhaDado("Ocupantes adicionais autorizados", c.ocupantesAdicionais)] : []),
    linhaDado("Imóvel", c.enderecoImovel),
    linhaDado("Finalidade", c.finalidade === "residencial" ? "Residencial" : "Não residencial"),
    linhaDado("Valor do aluguel", fmtMoeda(c.valorAluguel)),
    linhaDado("Índice de reajuste", c.imobiliaria.indice_reajuste),
    linhaDado("Data de início", fmtData(c.dataInicio)),
    linhaDado("Prazo", `${c.prazoMeses} meses`),
    ...(c.fiador ? [linhaDado("Fiador(es)", c.fiador)] : []),
    ...(c.valorCaucao ? [linhaDado("Valor da caução", fmtMoeda(c.valorCaucao))] : []),
    ...(c.laudoModo === "link" && c.laudoVistoriaUrl
      ? [linhaDado("Laudo de vistoria inicial", c.laudoVistoriaUrl)]
      : c.laudoModo === "arquivo_separado" && c.laudoArquivoNome
        ? [
            linhaDado(
              "Laudo de vistoria inicial",
              `Documento anexo, entregue separadamente (${c.laudoArquivoNome}), parte integrante deste contrato`
            ),
          ]
        : c.laudoModo === "arquivo_embutido" && c.laudoArquivoNome
          ? [
              linhaDado(
                "Laudo de vistoria inicial",
                "Anexado como páginas finais deste contrato — disponível na versão em PDF completo, na página de contratos gerados"
              ),
            ]
          : []),
  ];

  // Seções numeradas dinamicamente, já que Seguro Incêndio e Assinatura são opcionais.
  const secoes: { titulo: string; corpo: Paragraph[] }[] = [
    { titulo: "Disposições Gerais", corpo: paragrafosDeTexto(c.imobiliaria.texto_base_contrato) },
    {
      titulo: `Da Garantia Locatícia — ${c.tipoGarantiaNome}`,
      corpo: blocoClausulaComCoberturas(
        c.seguradoraNome
          ? `Seguradora: ${c.seguradoraNome} — Produto: ${c.produtoNome}`
          : `Produto: ${c.produtoNome}`,
        c.clausulaBase,
        c.coberturas
      ),
    },
  ];

  if (c.seguroIncendio) {
    secoes.push({
      titulo: "Do Seguro Incêndio (item obrigatório, protege o patrimônio do locador)",
      corpo: blocoClausulaComCoberturas(
        `Seguradora: ${c.seguroIncendio.seguradoraNome} — Produto: ${c.seguroIncendio.produtoNome}`,
        c.seguroIncendio.clausulaBase,
        c.seguroIncendio.coberturas
      ),
    });
  }

  if (c.imobiliaria.plataforma_assinatura) {
    secoes.push({
      titulo: "Da Assinatura Eletrônica",
      corpo: [
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 120, line: 300 },
          children: [
            new TextRun({
              text: `As partes reconhecem como válida a assinatura eletrônica deste contrato realizada através da plataforma ${c.imobiliaria.plataforma_assinatura}.`,
              color: COR_TEXTO,
            }),
          ],
        }),
      ],
    });
  }

  const secoesNumeradas = secoes.flatMap((secao, i) => [
    tituloSecao(`${i + 1}. ${secao.titulo}`),
    ...secao.corpo,
  ]);

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22, color: COR_TEXTO },
        },
      },
    },
    sections: [
      {
        properties: {},
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: c.imobiliaria.nome, size: 16, color: COR_SECUNDARIA }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                border: {
                  top: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 6 },
                },
                children: [
                  new TextRun({
                    text: `${c.imobiliaria.nome}${c.imobiliaria.cnpj ? " — CNPJ " + c.imobiliaria.cnpj : ""}   ·   Página `,
                    size: 16,
                    color: COR_SECUNDARIA,
                  }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: COR_SECUNDARIA }),
                  new TextRun({ text: " de ", size: 16, color: COR_SECUNDARIA }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: COR_SECUNDARIA }),
                ],
              }),
            ],
          }),
        },
        children: [
          ...cabecalho,
          ...dadosLocacao,
          ...secoesNumeradas,

          new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            spacing: { before: 500, after: 300, line: 300 },
            children: [
              new TextRun({
                text: `E por estarem de acordo com todas as cláusulas e condições deste instrumento, as partes assinam o presente contrato em ${fmtData(
                  c.dataInicio
                )}.`,
                color: COR_TEXTO,
              }),
            ],
          }),

          ...linhaAssinatura("LOCADOR(ES)"),
          ...linhaAssinatura("LOCATÁRIO(S)", c.locatario),
          ...(c.fiador ? linhaAssinatura("FIADOR(ES)", c.fiador) : []),
          ...linhaAssinatura("TESTEMUNHA 1"),
          ...linhaAssinatura("TESTEMUNHA 2"),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
