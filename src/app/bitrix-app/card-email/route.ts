import { NextRequest, NextResponse } from "next/server";
import { salvarInstalacaoSeValida, DOMINIO_PORTAL_O2 } from "@/lib/bitrix/appAuth";
import { entityTypeIdPorPlacement } from "@/lib/bitrix/entidadesCard";
import { MODELOS_EMAIL } from "@/lib/bitrix/modelosEmail";
import { ENTIDADES_COMERCIAL, listarModelosBanco } from "@/lib/bitrix/modelosEmailBanco";
import { listarAssinaturas, urlImagemAssinatura } from "@/lib/bitrix/assinaturasEmail";

export const dynamic = "force-dynamic";

// Handler do placement "E-mail" dentro do card do Bitrix (Fase 0: só prova
// que o mecanismo funciona, sem lógica de e-mail ainda -- ver
// C:\Users\O2-Grupo\.claude\plans\frolicking-floating-frog.md).
//
// O Bitrix chama essa URL em pelo menos 2 formatos diferentes de POST,
// confirmados nos logs de produção (2026-09-08, instalação real feita pelo
// Codex) -- nenhum dos dois bate com o nome de campo "documentação genérica"
// que eu tinha assumido antes de testar:
//
// 1) Evento ONAPPINSTALL (disparado 1x na instalação do app): campos
//    aninhados com colchete literal na chave (form-urlencoded, não JSON
//    aninhado de verdade) -- "auth[access_token]", "auth[refresh_token]",
//    "auth[domain]", "auth[member_id]", "auth[expires_in]".
// 2) Abertura do placement (toda vez que a aba é aberta num card): campos
//    soltos "AUTH_ID"/"REFRESH_ID"/"AUTH_EXPIRES"/"member_id", mas SEM
//    "DOMAIN" -- só vem "SERVER_ENDPOINT" (ex:
//    "https://o2seguros.bitrix24.com.br/rest/"), de onde o domínio é
//    derivado.
//
// Achado real #2 (reinstalação de 2026-09-09, confirmado pelo Codex): no
// ONAPPINSTALL desse portal, "auth[domain]" veio "oauth.bitrix.info" --
// o servidor de OAuth, não o portal -- então chamadas de API construídas
// com ele iam falhar (https://oauth.bitrix.info/rest/... não existe).
// SERVER_ENDPOINT é sempre o endereço real de onde a chamada chegou, então
// vira a fonte PREFERIDA; "auth[domain]"/"DOMAIN" só entra como fallback
// quando SERVER_ENDPOINT não vem, e mesmo assim é descartado se for esse
// valor claramente errado.
function extrairDadosAuth(campos: Record<string, string>) {
  const accessToken = campos["auth[access_token]"] ?? campos.AUTH_ID;
  const refreshToken = campos["auth[refresh_token]"] ?? campos.REFRESH_ID;
  const memberId = campos["auth[member_id]"] ?? campos.member_id;
  const expiresIn = campos["auth[expires_in]"] ?? campos.AUTH_EXPIRES;

  // "oauth.bitrix.info" é o servidor de OAuth, nunca um portal de verdade --
  // visto vindo tanto em auth[domain]/DOMAIN quanto (confirmado em produção,
  // 2026-09-10) em SERVER_ENDPOINT. Rejeitar nos dois caminhos, sempre.
  const dominioValido = (valor: string | undefined) =>
    valor && !valor.includes("oauth.bitrix.info") ? valor : undefined;

  let dominio: string | undefined;
  if (campos.SERVER_ENDPOINT) {
    dominio = dominioValido(campos.SERVER_ENDPOINT.replace(/^https?:\/\//, "").replace(/\/rest\/?$/, ""));
  }
  if (!dominio) {
    dominio = dominioValido(campos["auth[domain]"] ?? campos.DOMAIN);
  }

  return { accessToken, refreshToken, memberId, expiresIn, dominio };
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  let campos: Record<string, string> = {};

  try {
    if (contentType.includes("application/json")) {
      campos = await request.json();
    } else {
      const form = await request.formData();
      for (const [chave, valor] of form.entries()) campos[chave] = String(valor);
    }
  } catch (erro) {
    console.error("Falha ao ler POST do placement Bitrix:", erro);
  }

  console.log("Placement Bitrix recebeu POST com as chaves:", Object.keys(campos));

  const dadosAuth = extrairDadosAuth(campos);
  const { accessToken, refreshToken, memberId, expiresIn } = dadosAuth;
  // O Bitrix costuma mandar só SERVER_ENDPOINT=oauth.bitrix.info (descartado
  // acima), sem o domínio do portal -- e aí o token nunca era salvo. Como só o
  // portal da O2 é aceito e o token é conferido nele (salvarInstalacaoSeValida),
  // usa o domínio fixo quando não vier nenhum.
  const dominio = dadosAuth.dominio ?? DOMINIO_PORTAL_O2;

  if (accessToken && refreshToken && dominio && memberId) {
    try {
      const recusa = await salvarInstalacaoSeValida({
        dominio,
        memberId,
        accessToken,
        refreshToken,
        expiresInSegundos: Number(expiresIn ?? 3600),
      });
      if (recusa) console.warn(`Instalação do app Bitrix NÃO atualizada: ${recusa}`);
    } catch (erro) {
      console.error("Falha ao salvar token do app Bitrix:", erro);
    }
  } else {
    console.warn("POST do placement sem os campos de auth esperados -- token não foi salvo/atualizado.", {
      temAccessToken: Boolean(accessToken),
      temRefreshToken: Boolean(refreshToken),
      temDominio: Boolean(dominio),
      temMemberId: Boolean(memberId),
    });
  }

  // PLACEMENT_OPTIONS vem como string JSON (ex: '{"ID":"1540"}' para
  // CRM_DEAL_DETAIL_TAB). BX24.placement.info() no cliente é o caminho mais
  // confiável (não depende de parsear o POST cru), mas mantemos esse valor
  // do servidor como fallback caso o BX24.init demore/falhe.
  let itemIdDoPost: string | null = null;
  try {
    const placementOptions = campos.PLACEMENT_OPTIONS ? JSON.parse(campos.PLACEMENT_OPTIONS) : null;
    itemIdDoPost = placementOptions?.ID ? String(placementOptions.ID) : null;
  } catch {
    // PLACEMENT_OPTIONS ausente ou em formato inesperado -- sem problema,
    // a leitura via BX24.placement.info() no cliente é a fonte confiável.
  }

  // O nome do placement (ex: "CRM_DEAL_DETAIL_TAB") identifica em qual das
  // 6 entidades (Lead/Deal/4 SPAs) o card foi aberto -- é isso que decide o
  // CC certo no envio (ver src/lib/bitrix/entidadesCard.ts). Vem tanto no
  // POST quanto em BX24.placement.info().placement; usamos o do POST como
  // fonte inicial e reforçamos com o do cliente.
  const entityTypeIdDoPost = entityTypeIdPorPlacement(campos.PLACEMENT) ?? null;

  // Só mostra os modelos que valem pro tipo de card aberto (ex: modelos de
  // Fiança só nos cards de Seguro Fiança). Sem tipo identificado, mostra só
  // os que servem pra qualquer card.
  const modelosDoCodigo = MODELOS_EMAIL.filter(
    (m) => !m.entidades || (entityTypeIdDoPost !== null && m.entidades.includes(entityTypeIdDoPost))
  );
  // Modelos criados pela própria equipe (hoje só Leads e Negócios, da área
  // comercial): vêm do banco e entram na lista junto com os do código.
  const modelosDoBanco = entityTypeIdDoPost !== null ? await listarModelosBanco(entityTypeIdDoPost) : [];
  const modelosDoCard = [...modelosDoCodigo, ...modelosDoBanco];
  const podeCriarModelo = entityTypeIdDoPost !== null && ENTIDADES_COMERCIAL.includes(entityTypeIdDoPost);

  // Remetentes (equipe) com a imagem de assinatura de cada um.
  const assinaturas = (await listarAssinaturas()).map((a) => ({ ...a, imagem: urlImagemAssinatura(a.arquivo) }));

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>E-mail do card — O2 Seguros</title>
  <script src="https://api.bitrix24.com/api/v1/"></script>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
  <style>
    body { font-family: 'Poppins', system-ui, sans-serif; margin: 0; padding: 20px; color: #01192e; background: #fff; }
    #status { font-size: 13px; color: #8d8683; margin-bottom: 12px; }
    label { display: block; font-size: 12px; font-weight: 600; color: #444440; margin: 12px 0 4px; }
    input, select { width: 100%; box-sizing: border-box; padding: 9px 10px; border: 1px solid #d9d9d9; border-radius: 8px; font-family: inherit; font-size: 14px; background: #fff; color: #01192e; }
    #dica-modelo { font-size: 11px; color: #8d8683; margin-top: 4px; }
    #barra-formatacao { display: flex; gap: 4px; margin-top: 6px; }
    #barra-formatacao button { margin: 0; background: #fff; color: #01192e; border: 1px solid #d9d9d9; border-radius: 6px; width: 30px; height: 30px; padding: 0; font-size: 13px; font-weight: 700; cursor: pointer; line-height: 1; }
    #barra-formatacao button:hover { background: #f4f4f4; }
    #barra-formatacao button[data-cmd="italic"] { font-style: italic; }
    #corpo { min-height: 140px; box-sizing: border-box; padding: 9px 10px; border: 1px solid #d9d9d9; border-radius: 8px; font-family: verdana, sans-serif; font-size: 13px; line-height: 1.5; color: #073763; margin-top: 6px; }
    #corpo:focus { outline: 2px solid #F8540D22; }
    #corpo ul, #corpo ol { margin: 0 0 0 20px; padding: 0; }
    #corpo a { color: #F8540D; }
    #corpo .campo { background: #fff3d6; border-bottom: 1px dashed #ff9900; }
    #corpo .campo.falta { background: #ffe2e2; border-bottom-color: #c62828; }
    button.enviar { margin-top: 16px; background: #F8540D; color: #fff; border: none; padding: 10px 24px; border-radius: 999px; font-weight: 700; font-size: 14px; cursor: pointer; }
    button.enviar:disabled { opacity: 0.6; cursor: default; }
    #mensagem { margin-top: 12px; font-size: 13px; }
    #mensagem.erro { color: #c0392b; }
    #mensagem.sucesso { color: #1a7a3c; }
    #preview-card { display: none; background: #f8f8f7; border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; font-size: 12px; }
    #preview-card .linha { display: flex; gap: 8px; padding: 3px 0; }
    #preview-card .rotulo { color: #8d8683; width: 90px; flex-shrink: 0; }
    #preview-card .valor { color: #01192e; font-weight: 600; }
    #preview-card .aviso { color: #8d8683; font-style: italic; }
    #lista-anexos { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
    .anexo-item { display: flex; align-items: center; justify-content: space-between; background: #f8f8f7; border-radius: 6px; padding: 6px 10px; font-size: 12px; color: #01192e; }
    .anexo-item .remover { color: #c0392b; cursor: pointer; font-weight: 700; margin-left: 10px; }
    .anexo-item.enviando { color: #8d8683; font-style: italic; }
    #btn-anexar { background: #fff; color: #01192e; border: 1px solid #d9d9d9; border-radius: 999px; padding: 6px 14px; font-size: 12px; font-weight: 600; cursor: pointer; margin-top: 8px; }
    #btn-anexar:disabled { opacity: 0.6; cursor: default; }
    #dica-remetente { font-size: 12px; color: #8d8683; margin-top: 4px; }
    #dica-conversa { font-size: 12px; color: #8d8683; margin-top: 4px; }
    #bloco-vincular { margin-top: 14px; padding: 10px 12px; border: 1px solid #f3d9a4; background: #fff8e8; border-radius: 10px; font-size: 12px; color: #6b4e0a; }
    #bloco-vincular button { background: #fff; color: #01192e; border: 1px solid #d9c18a; border-radius: 999px; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; margin-top: 8px; }
    #bloco-vincular button:disabled { opacity: 0.6; cursor: default; }
    #erro-gmail { color: #b42318; margin-top: 6px; }
    .conversa-gmail { display: flex; gap: 8px; align-items: flex-start; background: #fff; border: 1px solid #f3d9a4; border-radius: 8px; padding: 8px; margin-top: 6px; cursor: pointer; }
    .conversa-gmail .detalhe { display: block; color: #8d8683; }
    .conversa-gmail input[type="radio"] { width: auto; flex: none; margin: 3px 0 0; padding: 0; }
    .conversa-gmail > span { flex: 1; text-align: left; }
    #bloco-endereco { margin-top: 16px; padding: 10px 12px; background: #f4f4f4; border-radius: 10px; font-size: 12px; color: #6b6663; }
    #bloco-endereco code { background: #fff; padding: 2px 6px; border-radius: 4px; color: #01192e; }
    #bloco-endereco button { background: none; border: none; color: #01192e; text-decoration: underline; cursor: pointer; font-size: 12px; }
    #assunto:disabled { background: #f4f4f4; color: #6b6663; }
  </style>
</head>
<body>
  <div id="status">Carregando informações do card…</div>

  <div id="preview-card"></div>

  <form id="form-email" style="display:none;">
    <label for="remetente-nome">Remetente (quem está enviando)</label>
    <select id="remetente-nome" required>
      <option value="">Escolha seu nome…</option>
    </select>
    <div id="dica-remetente"></div>
    <img id="previa-assinatura" alt="" style="display:none;margin-top:8px;max-width:100%;width:420px;border:1px solid #eee;border-radius:6px;" />

    <label for="para">Para</label>
    <input id="para" type="text" required placeholder="cliente@exemplo.com (mais de um: separe por vírgula ou ponto e vírgula)" />

    <label for="cc">Cc (cópia) — opcional</label>
    <input id="cc" type="text" placeholder="cobranca@o2seguros.com.br; outro@exemplo.com" />
    <div id="dica-cc" style="font-size:11px;color:#8d8683;margin-top:4px;">O endereço fixo do tipo de card (ex: incendio@) já vai em cópia automaticamente.</div>

    <label for="modelo" id="rotulo-modelo">Modelo de e-mail</label>
    <select id="modelo">
      <option value="">Em branco (escrever do zero)</option>
    </select>
    <div id="dica-modelo">Escolha um modelo para preencher assunto e mensagem. Depois é só editar o que precisar.</div>
    <div id="acoes-modelo" style="display:none;gap:8px;flex-wrap:wrap;margin-top:8px;align-items:center;">
      <button type="button" id="btn-salvar-modelo" style="border:1px solid #01192e;color:#01192e;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit;background:#fff;">Salvar como modelo</button>
      <button type="button" id="btn-atualizar-modelo" style="display:none;border:1px solid #01192e;color:#01192e;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit;background:#fff;">Atualizar este modelo</button>
      <button type="button" id="btn-excluir-modelo" style="display:none;border:1px solid #c62828;color:#c62828;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit;background:#fff;">Excluir este modelo</button>
    </div>
    <div id="bloco-inserir-campo" style="display:none;margin-top:10px;">
      <label for="inserir-campo" style="margin-top:0;">Inserir campo do cliente no texto</label>
      <select id="inserir-campo">
        <option value="">Escolha um campo para colocar no texto…</option>
        <option value="empresa">Nome da imobiliária</option>
        <option value="responsavel">Nome do responsável</option>
        <option value="card">Título do card</option>
        <option value="campanha">Nome da campanha</option>
        <option value="meta">Meta da imobiliária</option>
        <option value="realizado">Realizado até agora</option>
        <option value="faltam">Quanto falta para a meta</option>
        <option value="percentual">% da meta atingido</option>
        <option value="dias_restantes">Dias até o fim da campanha</option>
        <option value="prazo">Data final da campanha</option>
        <option value="cotacoes_abertas">Cotações em andamento</option>
        <option value="desempenho">Quadro de desempenho (barra e números)</option>
      </select>
    </div>
    <div id="msg-modelo" style="font-size:12px;margin-top:4px;"></div>
    <div id="dica-salvar-modelo" style="display:none;font-size:11px;color:#8d8683;margin-top:4px;">Use "Inserir campo" para colocar dados do cliente no texto (nome, meta, quanto falta, prazo, quadro de desempenho). Em cada card esses trechos se preenchem sozinhos com os dados daquela imobiliária e continuam editáveis; se faltar o dado, aparece um [trecho em vermelho] para completar. O modelo fica visível para toda a equipe comercial.</div>

    <div id="bloco-vincular" style="display:none;">
      <div id="aviso-sem-conversa">Este card ainda não tem conversa por e-mail registrada. Se o cliente já conversa com a equipe pelo Gmail, vincule essa conversa para este e-mail entrar nela (em vez de abrir outra).</div>
      <input id="busca-gmail" type="text" placeholder="Palavra do assunto (ex: cancelamento, pasta 345) — opcional" maxlength="80" style="margin-top:8px;" />
      <button type="button" id="btn-procurar-gmail">Procurar conversa no Gmail</button>
      <div id="erro-gmail"></div>
      <div id="lista-gmail"></div>
    </div>

    <label for="assunto">Assunto</label>
    <input id="assunto" type="text" required />
    <div id="dica-conversa" style="display:none;">Este card já tem uma conversa por e-mail: o envio entra nela automaticamente, junto com as mensagens anteriores.</div>

    <label for="corpo">Mensagem</label>
    <div id="barra-formatacao">
      <button type="button" data-cmd="bold" title="Negrito"><b>B</b></button>
      <button type="button" data-cmd="italic" title="Itálico">I</button>
      <button type="button" data-cmd="insertUnorderedList" title="Lista">•—</button>
      <button type="button" data-cmd="createLink" title="Link">🔗</button>
      <button type="button" id="btn-inserir-imagem" title="Inserir imagem (ou cole a imagem direto na mensagem)" style="width:auto;padding:0 8px;font-weight:600;">🖼️ Imagem</button>
      <input id="input-imagem" type="file" accept="image/png,image/jpeg,image/gif,image/webp" style="display:none;" />
      <button type="button" data-destaque="fundo" title="Destaque: fundo laranja, letra branca (igual aos modelos)" style="background:#ff9900;color:#fff;border-color:#ff9900;">A</button>
      <button type="button" data-destaque="texto" title="Texto laranja em negrito (igual aos modelos)" style="color:#ff9900;">A</button>
      <button type="button" data-destaque="limpar" title="Tirar cor/destaque do trecho selecionado" style="font-weight:400;">⌫</button>
    </div>
    <div id="corpo" contenteditable="true" role="textbox" aria-multiline="true"></div>

    <div id="lista-anexos"></div>
    <button id="btn-anexar" type="button">📎 Anexar arquivo (até 15 MB)</button>
    <input id="input-anexo" type="file" style="display:none;" />

    <button class="enviar" id="botao-enviar" type="submit">Enviar</button>
    <div id="mensagem"></div>

    <div id="bloco-endereco">
      <b>Vincular conversas do Gmail a este card:</b> ao responder o cliente pelo Gmail, coloque este endereço em cópia.
      <div><code id="endereco-card"></code> <button type="button" id="btn-copiar-endereco">Copiar</button></div>
      As respostas a e-mails enviados por aqui já voltam para o card automaticamente.
    </div>
  </form>

  <script>
    var itemId = ${JSON.stringify(itemIdDoPost)};
    var entityTypeId = ${JSON.stringify(entityTypeIdDoPost)};

    // Anexos sobem direto pro Supabase Storage a partir daqui (ver
    // anexo-upload-url/route.ts) -- contorna o limite de 4,5MB de corpo de
    // requisição do Vercel, que travaria um PDF/foto um pouco maior se
    // fosse mandado embutido no POST pra nossa própria função.
    var TAMANHO_MAXIMO_ANEXO = 15 * 1024 * 1024;
    var BUCKET_ANEXOS = "bitrix-email-anexos";
    var supabaseClient = window.supabase.createClient(
      ${JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")},
      ${JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "")}
    );
    var anexosConcluidos = [];

    // Modelos de e-mail (src/lib/bitrix/modelosEmail.ts). infoCard é preenchido
    // quando a prévia do card chega; até lá (ou se falhar) os placeholders viram
    // trechos entre colchetes pra pessoa completar à mão.
    var MODELOS_EMAIL = ${JSON.stringify(modelosDoCard).replace(/</g, "\\u003c")};
    var ASSINATURAS = ${JSON.stringify(assinaturas).replace(/</g, "\\u003c")};
    var infoCard = null;
    var PODE_CRIAR_MODELO = ${JSON.stringify(podeCriarModelo)};
    var ultimoAssuntoModelo = "";
    var ultimoCorpoModelo = "";

    function escaparHtml(texto) {
      return String(texto).split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;");
    }

    // Campos do cliente que os modelos podem usar. Cada um aparece no texto como
    // um trecho destacado (data-campo) que se preenche sozinho com os dados do
    // card e CONTINUA EDITÁVEL; sem o dado, vira um [trecho entre colchetes]
    // para a pessoa completar. Ao salvar como modelo, voltam a ser {{campo}}.
    var ROTULO_FALTANTE = {
      empresa: "[empresa/imóvel]",
      responsavel: "[nome do cliente]",
      card: "[título do card]",
      campanha: "[campanha]",
      meta: "[meta]",
      realizado: "[realizado]",
      faltam: "[quanto falta]",
      percentual: "[% da meta]",
      dias_restantes: "[dias até o fim]",
      prazo: "[data final]",
      cotacoes_abertas: "[cotações em andamento]",
      desempenho: "[quadro de desempenho: este card não tem os dados da campanha, preencha à mão]"
    };
    var CAMPOS_MODELO = Object.keys(ROTULO_FALTANTE);

    function valorCampo(chave) {
      var c = infoCard && infoCard.campanha;
      var mapa = {
        empresa: infoCard && infoCard.empresa,
        responsavel: infoCard && infoCard.responsavel,
        card: infoCard && infoCard.tituloCard,
        campanha: c && c.campanha,
        meta: c && c.meta,
        realizado: c && c.realizado,
        faltam: c && c.faltam,
        percentual: c && c.percentual,
        dias_restantes: c && c.diasRestantes,
        prazo: c && c.prazo,
        cotacoes_abertas: c && c.cotacoesAbertas
      };
      return mapa[chave] || null;
    }

    function preencherPlaceholders(texto, comoHtml) {
      CAMPOS_MODELO.forEach(function (chave) {
        var token = "{{" + chave + "}}";
        if (texto.indexOf(token) === -1) return;
        var valor = chave === "desempenho" ? (infoCard && infoCard.campanha ? infoCard.campanha.quadroHtml : null) : valorCampo(chave);
        var faltou = !valor;
        var exibido = faltou ? ROTULO_FALTANTE[chave] : valor;
        var resultado;
        if (!comoHtml) {
          resultado = chave === "desempenho" ? "" : exibido;
        } else if (chave === "desempenho" && !faltou) {
          resultado = '<div data-campo="desempenho" class="campo">' + valor + '</div>';
        } else {
          resultado = '<span data-campo="' + chave + '" class="campo' + (faltou ? ' falta' : '') + '">' + escaparHtml(exibido) + '</span>';
        }
        texto = texto.split(token).join(resultado);
      });
      return texto;
    }

    // Trechos de campo -> {{campo}} (para salvar como modelo).
    function paraTokens(html) {
      var div = document.createElement("div");
      div.innerHTML = html;
      div.querySelectorAll("[data-campo]").forEach(function (el) {
        el.replaceWith(document.createTextNode("{{" + el.getAttribute("data-campo") + "}}"));
      });
      return div.innerHTML;
    }
    // Tira a marcação dos campos antes de enviar (o e-mail sai limpo).
    function semMarcas(html) {
      var div = document.createElement("div");
      div.innerHTML = html;
      div.querySelectorAll("[data-campo]").forEach(function (el) {
        var frag = document.createDocumentFragment();
        while (el.firstChild) frag.appendChild(el.firstChild);
        el.replaceWith(frag);
      });
      return div.innerHTML;
    }

    function popularModelos() {
      var select = document.getElementById("modelo");
      if (PODE_CRIAR_MODELO) {
        document.getElementById("acoes-modelo").style.display = "flex";
        document.getElementById("dica-salvar-modelo").style.display = "block";
        document.getElementById("bloco-inserir-campo").style.display = "block";
      }
      if (!MODELOS_EMAIL.length && !PODE_CRIAR_MODELO) {
        // Nenhum modelo pra esse tipo de card: esconde o campo inteiro.
        document.getElementById("rotulo-modelo").style.display = "none";
        select.style.display = "none";
        document.getElementById("dica-modelo").style.display = "none";
        return;
      }
      MODELOS_EMAIL.forEach(function (modelo) {
        var opcao = document.createElement("option");
        opcao.value = modelo.id;
        opcao.textContent = modelo.nome;
        select.appendChild(opcao);
      });
      select.addEventListener("change", function () {
        var modelo = MODELOS_EMAIL.filter(function (m) { return m.id === select.value; })[0];
        var assuntoEl = document.getElementById("assunto");
        var corpoEl = document.getElementById("corpo");
        if (!modelo) return; // "Em branco" não apaga nada que a pessoa já escreveu

        // Só pede confirmação se a pessoa já mexeu no texto (diferente do último
        // modelo inserido) -- trocar de um modelo pra outro sem editar é livre.
        var corpoEditado = corpoEl.textContent.trim() && corpoEl.innerHTML !== ultimoCorpoModelo;
        if (corpoEditado && !window.confirm("A mensagem já tem texto. Substituir pelo modelo escolhido?")) {
          select.value = "";
          return;
        }

        var assuntoEditado = assuntoEl.value.trim() && assuntoEl.value !== ultimoAssuntoModelo;
        ultimoCorpoModelo = "";
        corpoEl.innerHTML = preencherPlaceholders(modelo.corpoHtml, true);
        ultimoCorpoModelo = corpoEl.innerHTML;
        if (!assuntoEditado) {
          assuntoEl.value = preencherPlaceholders(modelo.assunto, false);
          ultimoAssuntoModelo = assuntoEl.value;
        }
        // Modelos que pedem cópia fixa (ex: confirmação de contratação e de
        // cancelamento -> cobrança): soma ao campo Cc sem repetir nem apagar o que a pessoa pôs.
        if (modelo.cc && modelo.cc.length) {
          var ccEl = document.getElementById("cc");
          var atuais = listaEnderecos(ccEl.value);
          modelo.cc.forEach(function (e) {
            if (!atuais.some(function (a) { return a.toLowerCase() === e.toLowerCase(); })) atuais.push(e);
          });
          ccEl.value = atuais.join("; ");
        }
        aplicarConversa();
        corpoEl.focus();
      });
    }
    // "a@x.com; b@x.com, c@x.com" -> ["a@x.com", "b@x.com", "c@x.com"]
    function listaEnderecos(texto) {
      return String(texto || "").split(/[,;\\s]+/).map(function (e) { return e.trim(); }).filter(Boolean);
    }
    popularModelos();

    // ---- Modelos criados pela equipe (Leads e Negócios) ----
    function modeloSelecionado() {
      var id = document.getElementById("modelo").value;
      return MODELOS_EMAIL.filter(function (m) { return m.id === id; })[0] || null;
    }
    function atualizarBotoesModelo() {
      var m = modeloSelecionado();
      var editavel = !!(m && m.editavel);
      document.getElementById("btn-atualizar-modelo").style.display = editavel ? "inline-block" : "none";
      document.getElementById("btn-excluir-modelo").style.display = editavel ? "inline-block" : "none";
    }
    document.getElementById("modelo").addEventListener("change", atualizarBotoesModelo);

    // O texto da tela já tem os dados deste card; ao salvar, devolve os
    // trechos {{empresa}}/{{responsavel}}/{{card}} para o modelo servir em outros cards.
    function voltarPlaceholders(texto, comoHtml) {
      if (!infoCard) return texto;
      [["empresa", infoCard.empresa], ["responsavel", infoCard.responsavel], ["card", infoCard.tituloCard]].forEach(function (par) {
        var valor = par[1];
        if (!valor || String(valor).length < 4) return;
        var v = comoHtml ? escaparHtml(valor) : String(valor);
        texto = texto.split(v).join("{{" + par[0] + "}}");
      });
      return texto;
    }
    function avisoModelo(texto, erro) {
      var el = document.getElementById("msg-modelo");
      el.textContent = texto;
      el.style.color = erro ? "#c62828" : "#1b7a3a";
    }
    function pedirModelo(carga, aoConcluir) {
      var auth = BX24.getAuth();
      carga.authId = auth && auth.access_token;
      carga.entityTypeId = entityTypeId;
      avisoModelo("Salvando...", false);
      fetch("/bitrix-app/modelos-email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(carga) })
        .then(function (resp) { return resp.json(); })
        .then(function (dados) {
          if (dados && dados.ok) { aoConcluir(dados); } else { avisoModelo((dados && dados.erro) || "Falha ao salvar o modelo.", true); }
        })
        .catch(function () { avisoModelo("Falha de conexão. Tente de novo.", true); });
    }
    function textoPronto() {
      var corpoEl = document.getElementById("corpo");
      if (!corpoEl.textContent.trim()) { avisoModelo("Escreva a mensagem antes de salvar como modelo.", true); return null; }
      if (corpoEl.querySelector('img[src^="data:"], img[src^="blob:"], img[src^="file:"]')) { avisoModelo("Espere as imagens terminarem de carregar antes de salvar.", true); return null; }
      return {
        assunto: voltarPlaceholders(document.getElementById("assunto").value, false),
        corpoHtml: voltarPlaceholders(paraTokens(corpoEl.innerHTML), true),
      };
    }
    document.getElementById("btn-salvar-modelo").addEventListener("click", function () {
      var pronto = textoPronto();
      if (!pronto) return;
      var nome = window.prompt("Nome do modelo (ex: Black Friday - Seguro Incêndio):");
      if (!nome || !nome.trim()) return;
      pedirModelo({ acao: "salvar", nome: nome.trim(), assunto: pronto.assunto, corpoHtml: pronto.corpoHtml }, function (dados) {
        var m = dados.modelo;
        MODELOS_EMAIL.push(m);
        var opcao = document.createElement("option");
        opcao.value = m.id;
        opcao.textContent = m.nome;
        document.getElementById("modelo").appendChild(opcao);
        document.getElementById("modelo").value = m.id;
        ultimoAssuntoModelo = document.getElementById("assunto").value;
        ultimoCorpoModelo = document.getElementById("corpo").innerHTML;
        atualizarBotoesModelo();
        avisoModelo("Modelo salvo. Já aparece para toda a equipe comercial.", false);
      });
    });
    document.getElementById("btn-atualizar-modelo").addEventListener("click", function () {
      var m = modeloSelecionado();
      if (!m || !m.editavel) return;
      var pronto = textoPronto();
      if (!pronto) return;
      if (!window.confirm("Trocar o assunto e a mensagem do modelo “" + m.nome + "” pelo texto que está na tela?")) return;
      pedirModelo({ acao: "atualizar", id: m.id, assunto: pronto.assunto, corpoHtml: pronto.corpoHtml }, function (dados) {
        m.assunto = dados.modelo.assunto;
        m.corpoHtml = dados.modelo.corpoHtml;
        ultimoAssuntoModelo = document.getElementById("assunto").value;
        ultimoCorpoModelo = document.getElementById("corpo").innerHTML;
        avisoModelo("Modelo atualizado.", false);
      });
    });

    // ---- Inserir campo do cliente no texto ----
    document.getElementById("inserir-campo").addEventListener("change", function () {
      var chave = this.value;
      this.value = "";
      if (!chave) return;
      var corpoEl = document.getElementById("corpo");
      corpoEl.focus();
      if (ultimaSelecaoCorpo) {
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(ultimaSelecaoCorpo);
      }
      document.execCommand("insertHTML", false, preencherPlaceholders("{{" + chave + "}}", true));
    });

    document.getElementById("btn-excluir-modelo").addEventListener("click", function () {
      var m = modeloSelecionado();
      if (!m || !m.editavel) return;
      if (!window.confirm("Excluir o modelo “" + m.nome + "” para toda a equipe?")) return;
      pedirModelo({ acao: "excluir", id: m.id }, function () {
        MODELOS_EMAIL = MODELOS_EMAIL.filter(function (x) { return x.id !== m.id; });
        var select = document.getElementById("modelo");
        for (var i = select.options.length - 1; i >= 0; i--) { if (select.options[i].value === m.id) select.remove(i); }
        select.value = "";
        atualizarBotoesModelo();
        avisoModelo("Modelo excluído.", false);
      });
    });

    // Todo e-mail sobre este card entra na conversa mais recente dele (o
    // servidor garante: assunto "Re: ..." + cabeçalhos de resposta). Aqui só
    // mostramos o assunto travado pra ficar claro pra quem está escrevendo.
    var conversaDoCard = "";
    function aplicarConversa() {
      if (!conversaDoCard) return;
      var assuntoEl = document.getElementById("assunto");
      assuntoEl.value = "Re: " + conversaDoCard;
      assuntoEl.disabled = true;
      document.getElementById("dica-conversa").style.display = "block";
    }

    function carregarConversas(authId) {
      fetch("/bitrix-app/conversas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authId: authId, entityTypeId: entityTypeId, itemId: Number(itemId) }),
      })
        .then(function (resp) { return resp.json(); })
        .then(function (resultado) {
          // A busca no Gmail fica sempre disponível: card sem conversa registrada
          // oferece vincular a do Gmail; card com conversa permite trocar pela certa.
          document.getElementById("bloco-vincular").style.display = "block";
          if (!resultado.ok || !resultado.conversas || !resultado.conversas.length) return;
          conversaDoCard = resultado.conversas[0].assuntoBase;
          // Card com conversa: Para/Cc já vêm da última troca (editáveis), sem redigitar.
          var dest = resultado.destinatarios;
          if (dest && dest.para && dest.para.length) {
            var paraEl = document.getElementById("para");
            if (!paraEl.value.trim()) paraEl.value = dest.para.join("; ");
            var ccDest = document.getElementById("cc");
            var ccAtuais = listaEnderecos(ccDest.value);
            (dest.cc || []).forEach(function (e) {
              if (!ccAtuais.some(function (a) { return a.toLowerCase() === e.toLowerCase(); })) ccAtuais.push(e);
            });
            ccDest.value = ccAtuais.join("; ");
          }
          document.getElementById("aviso-sem-conversa").textContent =
            "Esta não é a conversa certa? O e-mail vai em \\u201C" + conversaDoCard + "\\u201D. Se o cliente conversa com a equipe em outra conversa do Gmail, procure e vincule a correta.";
          aplicarConversa();
        })
        .catch(function () { document.getElementById("bloco-vincular").style.display = "block"; }); // o servidor decide a conversa de qualquer forma
    }

    // Card sem conversa registrada: procura no Gmail a que a equipe já tem
    // com o cliente e vincula (uma vez só -- depois todo envio entra nela).
    function chamarConversasGmail(corpo) {
      var auth = BX24.getAuth();
      corpo.authId = auth && auth.access_token;
      corpo.entityTypeId = entityTypeId;
      corpo.itemId = Number(itemId);
      return fetch("/bitrix-app/conversas-gmail", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpo),
      }).then(function (resp) { return resp.json(); });
    }

    function procurarNoGmail() {
      var erroEl = document.getElementById("erro-gmail");
      var listaEl = document.getElementById("lista-gmail");
      var botao = document.getElementById("btn-procurar-gmail");
      erroEl.textContent = "";
      listaEl.textContent = "";
      var para = document.getElementById("para").value.trim();
      if (!para) {
        erroEl.textContent = "Preencha o destinatário (Para) primeiro.";
        return;
      }
      botao.disabled = true;
      botao.textContent = "Procurando…";
      var textoBusca = document.getElementById("busca-gmail").value.trim();
      chamarConversasGmail({ acao: "buscar", enderecos: listaEnderecos(para), texto: textoBusca })
        .then(function (r) {
          botao.disabled = false;
          botao.textContent = "Procurar conversa no Gmail";
          if (!r.ok) { erroEl.textContent = r.erro || "Falha ao consultar o Gmail."; return; }
          if (!r.conversas.length) {
            listaEl.textContent = textoBusca
              ? "Nenhuma conversa dos últimos 180 dias com " + para + " contendo “" + textoBusca + "”. Tente outra palavra ou deixe o campo vazio."
              : "Nenhuma conversa dos últimos 45 dias com " + para + ". Este e-mail abrirá uma conversa nova.";
            return;
          }
          var escolhida = "";
          var sugerida = r.conversas.filter(function (c) { return c.sugerida; })[0];
          if (sugerida) escolhida = sugerida.threadId;
          r.conversas.forEach(function (c) {
            var linha = document.createElement("label");
            linha.className = "conversa-gmail";
            var radio = document.createElement("input");
            radio.type = "radio";
            radio.name = "conversa-gmail";
            if (c.sugerida) radio.checked = true;
            radio.addEventListener("change", function () { escolhida = c.threadId; vincular.disabled = false; });
            var texto = document.createElement("span");
            var titulo = document.createElement("b");
            titulo.textContent = c.assunto + (c.sugerida ? "  ✔ sugerida pelo comentário TRATATIVA do card" : "");
            var detalhe = document.createElement("span");
            detalhe.className = "detalhe";
            detalhe.textContent = c.mensagens + (c.mensagens === 1 ? " mensagem" : " mensagens") + " · último em " + new Date(c.ultimaEm).toLocaleString("pt-BR") + " · " + c.participantes;
            var trecho = document.createElement("span");
            trecho.className = "detalhe";
            trecho.textContent = c.trecho;
            texto.appendChild(titulo);
            texto.appendChild(detalhe);
            texto.appendChild(trecho);
            linha.appendChild(radio);
            linha.appendChild(texto);
            listaEl.appendChild(linha);
          });
          var vincular = document.createElement("button");
          vincular.type = "button";
          vincular.textContent = "Vincular ao card (o e-mail sai nela)";
          vincular.disabled = !escolhida;
          vincular.addEventListener("click", function () {
            vincular.disabled = true;
            vincular.textContent = "Vinculando…";
            chamarConversasGmail({ acao: "vincular", threadId: escolhida }).then(function (v) {
              if (!v.ok) {
                erroEl.textContent = v.erro || "Falha ao vincular.";
                vincular.disabled = false;
                vincular.textContent = "Vincular ao card (o e-mail sai nela)";
                return;
              }
              conversaDoCard = v.assuntoBase;
              aplicarConversa();
              document.getElementById("bloco-vincular").style.display = "none";
              // Preenche Para/Cc com os participantes da conversa recém-vinculada.
              carregarConversas(BX24.getAuth() && BX24.getAuth().access_token);
            }).catch(function () {
              erroEl.textContent = "Falha de conexão. Tente de novo.";
              vincular.disabled = false;
              vincular.textContent = "Vincular ao card (o e-mail sai nela)";
            });
          });
          var aviso = document.createElement("div");
          aviso.textContent = "Nenhuma é a conversa certa? Não vincule: o e-mail abre uma conversa nova.";
          listaEl.appendChild(vincular);
          listaEl.appendChild(aviso);
        })
        .catch(function () {
          botao.disabled = false;
          botao.textContent = "Procurar conversa no Gmail";
          erroEl.textContent = "Falha de conexão. Tente de novo.";
        });
    }
    document.getElementById("btn-procurar-gmail").addEventListener("click", procurarNoGmail);
    document.getElementById("busca-gmail").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); procurarNoGmail(); }
    });

    function mostrarEnderecoCard() {
      var endereco = "card-" + entityTypeId + "-" + itemId + "@notificacoes.o2seguros.com.br";
      document.getElementById("endereco-card").textContent = endereco;
      document.getElementById("btn-copiar-endereco").addEventListener("click", function () {
        var botao = this;
        try {
          navigator.clipboard.writeText(endereco).then(function () { botao.textContent = "Copiado ✓"; });
        } catch (e) {
          botao.textContent = "Selecione e copie acima";
        }
      });
    }

    function mostrarStatus(texto) {
      document.getElementById("status").textContent = texto;
    }

    function habilitarFormulario() {
      if (!itemId || !entityTypeId) {
        mostrarStatus("Não foi possível identificar este card (placement não reconhecido). Avise o time de tecnologia.");
        return;
      }
      mostrarStatus("Card #" + itemId + " carregado.");
      document.getElementById("form-email").style.display = "block";
    }

    // Prévia do bloco "sobre este card" que vai automaticamente em todo
    // e-mail enviado por aqui (ver enviar-email/route.ts) -- pedido do
    // Matheus depois de perguntar onde isso aparecia: antes, só era visível
    // no e-mail final, nunca na tela de composição.
    function carregarPreviaCard(authId) {
      var previaEl = document.getElementById("preview-card");
      fetch("/bitrix-app/info-card", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authId: authId, entityTypeId: entityTypeId, itemId: Number(itemId) }),
      })
        .then(function (resp) { return resp.json(); })
        .then(function (resultado) {
          if (!resultado.ok || !resultado.info) return; // best-effort, some silenciosamente
          var info = resultado.info;
          infoCard = info;
          var linhas = "";
          if (info.tituloCard) linhas += '<div class="linha"><span class="rotulo">Card</span><span class="valor">#' + itemId + ' · ' + info.tituloCard + '</span></div>';
          if (info.empresa) linhas += '<div class="linha"><span class="rotulo">Empresa/Imóvel</span><span class="valor">' + info.empresa + '</span></div>';
          if (info.responsavel) linhas += '<div class="linha"><span class="rotulo">Responsável</span><span class="valor">' + info.responsavel + '</span></div>';
          linhas += '<div class="aviso" style="margin-top:6px;">Dados do card só para sua conferência — não vão no e-mail.</div>';
          previaEl.innerHTML = linhas;
          previaEl.style.display = "block";
        })
        .catch(function () {}); // prévia é só conveniência, nunca trava a composição
    }

    // execCommand é tecnicamente "obsoleto", mas continua funcionando em
    // todos os browsers modernos pra formatação simples dentro de um iframe
    // interno -- suficiente aqui sem adicionar uma lib de editor rich text
    // só pra negrito/itálico/lista/link.
    document.querySelectorAll("#barra-formatacao button[data-cmd]").forEach(function (botao) {
      botao.addEventListener("click", function () {
        document.getElementById("corpo").focus();
        var cmd = botao.getAttribute("data-cmd");
        if (cmd === "createLink") {
          var url = window.prompt("Link (com https://):");
          if (!url) return;
          document.execCommand(cmd, false, url);
        } else {
          document.execCommand(cmd, false, null);
        }
      });
    });

    // Destaques iguais aos dos modelos (modelosEmail.ts: dest() e laranja()).
    // A pessoa troca o "[MÊS/ANO]" do modelo pelo dado do card e quer que o
    // dado novo fique com a mesma cara do resto do e-mail.
    var MARCACAO_DESTAQUE = {
      fundo: ['<b><span style="background-color:#ff9900;color:#ffffff;">', "</span></b>"],
      texto: ['<b><span style="color:#ff9900;">', "</span></b>"],
    };
    document.querySelectorAll("#barra-formatacao button[data-destaque]").forEach(function (botao) {
      botao.addEventListener("mousedown", function (evento) { evento.preventDefault(); }); // não perde a seleção
      botao.addEventListener("click", function () {
        var corpoEl = document.getElementById("corpo");
        var selecao = window.getSelection();
        if (!selecao || selecao.isCollapsed || !corpoEl.contains(selecao.anchorNode)) {
          window.alert("Selecione no texto o trecho que quer formatar.");
          return;
        }
        var texto = escaparHtml(selecao.toString()).split("\\n").join("<br>");
        var tipo = botao.getAttribute("data-destaque");
        var html = tipo === "limpar"
          ? '<span style="color:#073763;">' + texto + "</span>"
          : MARCACAO_DESTAQUE[tipo][0] + texto + MARCACAO_DESTAQUE[tipo][1];
        corpoEl.focus();
        document.execCommand("insertHTML", false, html);
      });
    });

    // Colar sempre como texto puro: o que vem copiado do Bitrix/planilha traz
    // cor e fonte de lá (o "preto simples" no meio do e-mail colorido) e
    // texto puro herda a formatação do trecho onde foi colado.
    document.getElementById("corpo").addEventListener("paste", function (evento) {
      var dados = evento.clipboardData || window.clipboardData;
      if (!dados) return;
      var texto = dados.getData("text/plain");
      if (!texto) {
        // Colar imagem (print, imagem copiada de site/Word): sobe pro armazenamento e
        // entra no texto como link -- imagem embutida no próprio texto não chega no e-mail.
        var imagens = imagensDe(dados.files);
        if (imagens.length) {
          evento.preventDefault();
          imagens.forEach(inserirImagem);
        }
        return;
      }
      evento.preventDefault();
      document.execCommand("insertText", false, texto);
    });

    // Imagens no corpo da mensagem: colar, arrastar pra dentro ou botão "Imagem".
    // O arquivo sobe pro bucket público email-imagens (URL assinada pelo servidor)
    // e a mensagem leva a imagem pelo endereço dela.
    var BUCKET_IMAGENS = "email-imagens";
    var TAMANHO_MAXIMO_IMAGEM = 5 * 1024 * 1024;
    var TIPOS_IMAGEM = ["image/png", "image/jpeg", "image/gif", "image/webp"];
    var ultimaSelecaoCorpo = null;
    var imagensEnviando = 0;

    function imagensDe(arquivos) {
      return Array.prototype.slice.call(arquivos || []).filter(function (a) { return a && /^image\\//.test(a.type); });
    }

    document.addEventListener("selectionchange", function () {
      var corpoEl = document.getElementById("corpo");
      var sel = window.getSelection();
      if (sel && sel.rangeCount && corpoEl.contains(sel.anchorNode)) ultimaSelecaoCorpo = sel.getRangeAt(0).cloneRange();
    });

    function inserirImagem(arquivo) {
      var mensagem = document.getElementById("mensagem");
      mensagem.className = "";
      mensagem.textContent = "";
      if (TIPOS_IMAGEM.indexOf(arquivo.type) === -1) {
        mensagem.className = "erro";
        mensagem.textContent = "Formato de imagem não aceito (use PNG, JPG, GIF ou WebP).";
        return;
      }
      if (arquivo.size > TAMANHO_MAXIMO_IMAGEM) {
        mensagem.className = "erro";
        mensagem.textContent = "Imagem maior que 5 MB.";
        return;
      }
      imagensEnviando++;
      document.getElementById("botao-enviar").disabled = true;
      mensagem.textContent = "Enviando imagem…";
      var auth = BX24.getAuth();
      fetch("/bitrix-app/imagem-upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authId: auth && auth.access_token, entityTypeId: entityTypeId, itemId: Number(itemId), tipo: arquivo.type, tamanho: arquivo.size }),
      })
        .then(function (resp) { return resp.json(); })
        .then(function (r) {
          if (!r.ok) throw new Error(r.erro || "Falha ao preparar o envio da imagem.");
          return supabaseClient.storage.from(BUCKET_IMAGENS).uploadToSignedUrl(r.caminho, r.token, arquivo, { contentType: arquivo.type }).then(function (up) {
            if (up.error) throw up.error;
            return supabaseClient.storage.from(BUCKET_IMAGENS).getPublicUrl(r.caminho).data.publicUrl;
          });
        })
        .then(function (url) {
          var corpoEl = document.getElementById("corpo");
          corpoEl.focus();
          if (ultimaSelecaoCorpo) {
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(ultimaSelecaoCorpo);
          }
          document.execCommand("insertHTML", false, '<img src="' + url + '" alt="Imagem" style="max-width:100%;height:auto;" />');
          mensagem.textContent = "";
        })
        .catch(function (erro) {
          mensagem.className = "erro";
          mensagem.textContent = "Falha ao enviar a imagem: " + (erro && erro.message ? erro.message : "tente de novo.");
        })
        .finally(function () {
          imagensEnviando--;
          if (!imagensEnviando) document.getElementById("botao-enviar").disabled = false;
        });
    }

    var botaoImagem = document.getElementById("btn-inserir-imagem");
    botaoImagem.addEventListener("mousedown", function (evento) { evento.preventDefault(); }); // não perde o ponto do texto
    botaoImagem.addEventListener("click", function () { document.getElementById("input-imagem").click(); });
    document.getElementById("input-imagem").addEventListener("change", function (evento) {
      var escolhidas = imagensDe(evento.target.files);
      evento.target.value = "";
      escolhidas.forEach(inserirImagem);
    });
    document.getElementById("corpo").addEventListener("dragover", function (evento) {
      if (evento.dataTransfer && Array.prototype.indexOf.call(evento.dataTransfer.types || [], "Files") !== -1) evento.preventDefault();
    });
    document.getElementById("corpo").addEventListener("drop", function (evento) {
      var imagens = imagensDe(evento.dataTransfer && evento.dataTransfer.files);
      if (!imagens.length) return;
      evento.preventDefault();
      imagens.forEach(inserirImagem);
    });

    function renderizarAnexos() {
      var lista = document.getElementById("lista-anexos");
      lista.innerHTML = "";
      anexosConcluidos.forEach(function (anexo, indice) {
        var item = document.createElement("div");
        item.className = "anexo-item";
        var nomeSpan = document.createElement("span");
        nomeSpan.textContent = "📄 " + anexo.nome;
        var remover = document.createElement("span");
        remover.className = "remover";
        remover.textContent = "remover";
        remover.addEventListener("click", function () {
          anexosConcluidos.splice(indice, 1);
          renderizarAnexos();
        });
        item.appendChild(nomeSpan);
        item.appendChild(remover);
        lista.appendChild(item);
      });
    }

    function mostrarAnexoEnviando(nome) {
      var lista = document.getElementById("lista-anexos");
      var item = document.createElement("div");
      item.className = "anexo-item enviando";
      item.textContent = "Enviando " + nome + "…";
      lista.appendChild(item);
      return item;
    }

    document.getElementById("btn-anexar").addEventListener("click", function () {
      document.getElementById("input-anexo").click();
    });

    document.getElementById("input-anexo").addEventListener("change", function (evento) {
      var arquivo = evento.target.files && evento.target.files[0];
      evento.target.value = "";
      if (!arquivo) return;

      var mensagem = document.getElementById("mensagem");
      mensagem.className = "";
      mensagem.textContent = "";

      if (arquivo.size > TAMANHO_MAXIMO_ANEXO) {
        mensagem.className = "erro";
        mensagem.textContent = "Arquivo maior que 15 MB.";
        return;
      }

      var itemEnviando = mostrarAnexoEnviando(arquivo.name);
      var botaoAnexar = document.getElementById("btn-anexar");
      botaoAnexar.disabled = true;

      var auth = BX24.getAuth();
      fetch("/bitrix-app/anexo-upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          authId: auth && auth.access_token,
          entityTypeId: entityTypeId,
          itemId: Number(itemId),
          nomeArquivo: arquivo.name,
          tamanho: arquivo.size,
        }),
      })
        .then(function (resp) { return resp.json(); })
        .then(function (resultado) {
          if (!resultado.ok) throw new Error(resultado.erro || "Falha ao preparar envio do anexo.");
          return supabaseClient.storage.from(BUCKET_ANEXOS).uploadToSignedUrl(resultado.caminho, resultado.token, arquivo).then(function (up) {
            if (up.error) throw up.error;
            anexosConcluidos.push({ caminho: resultado.caminho, nome: arquivo.name });
          });
        })
        .then(function () {
          itemEnviando.remove();
          renderizarAnexos();
        })
        .catch(function (erro) {
          itemEnviando.remove();
          mensagem.className = "erro";
          mensagem.textContent = "Falha ao anexar \\"" + arquivo.name + "\\": " + (erro && erro.message ? erro.message : "tente de novo.");
        })
        .finally(function () {
          botaoAnexar.disabled = false;
        });
    });

    try {
      BX24.init(function () {
        var info = BX24.placement.info();
        if (info && info.options && info.options.ID) itemId = String(info.options.ID);
        habilitarFormulario();

        var authInicial = BX24.getAuth();
        if (itemId && entityTypeId) carregarPreviaCard(authInicial && authInicial.access_token);
        if (itemId && entityTypeId) carregarConversas(authInicial && authInicial.access_token);
        if (itemId && entityTypeId) mostrarEnderecoCard();

        // Quem está enviando: lista da equipe, cada um com a sua imagem de
        // assinatura. O nome vira o remetente na caixa de entrada de quem recebe.
        // Lembrado no navegador de quem usa (só conveniência).
        var remetenteEl = document.getElementById("remetente-nome");
        var dicaRemetenteEl = document.getElementById("dica-remetente");
        var previaAssinaturaEl = document.getElementById("previa-assinatura");
        ASSINATURAS.forEach(function (a) {
          var opcao = document.createElement("option");
          opcao.value = a.slug;
          opcao.textContent = a.nome + (a.cargo ? " — " + a.cargo : "");
          remetenteEl.appendChild(opcao);
        });
        function atualizarDicaRemetente() {
          var escolhida = ASSINATURAS.filter(function (a) { return a.slug === remetenteEl.value; })[0];
          dicaRemetenteEl.textContent = escolhida
            ? "Aparece na caixa de entrada como: " + escolhida.nome + " | O2 Seguros. A assinatura abaixo vai no fim do e-mail."
            : "Escolha quem está enviando: o nome e a assinatura saem no e-mail.";
          if (escolhida) {
            previaAssinaturaEl.src = escolhida.imagem;
            previaAssinaturaEl.alt = escolhida.nome;
            previaAssinaturaEl.style.display = "block";
          } else {
            previaAssinaturaEl.style.display = "none";
          }
        }
        function restaurarRemetente() {
          try { remetenteEl.value = localStorage.getItem("o2_remetente_assinatura") || ""; } catch (e) {}
          atualizarDicaRemetente();
        }
        remetenteEl.addEventListener("change", atualizarDicaRemetente);
        restaurarRemetente();

        document.getElementById("form-email").addEventListener("submit", function (evento) {
          evento.preventDefault();
          var corpoEl = document.getElementById("corpo");
          var mensagem = document.getElementById("mensagem");
          mensagem.className = "";
          mensagem.textContent = "";

          if (!remetenteEl.value) {
            mensagem.className = "erro";
            mensagem.textContent = "Escolha quem está enviando (campo Remetente).";
            remetenteEl.focus();
            return;
          }

          if (imagensEnviando) {
            mensagem.className = "erro";
            mensagem.textContent = "Aguarde terminar de enviar a imagem.";
            return;
          }
          // Imagem que ficou "dentro" do texto (data:/blob:) não chega no e-mail: avisa em vez de enviar sem ela.
          if (corpoEl.querySelector('img[src^="data:"], img[src^="blob:"], img[src^="file:"]')) {
            mensagem.className = "erro";
            mensagem.textContent = "Há uma imagem que não foi enviada corretamente. Apague-a e insira de novo (botão Imagem ou colando).";
            return;
          }

          if (!corpoEl.textContent.trim() && !corpoEl.querySelector("img")) {
            mensagem.className = "erro";
            mensagem.textContent = "Escreva uma mensagem.";
            corpoEl.focus();
            return;
          }

          var camposPendentes = Array.prototype.some.call(corpoEl.querySelectorAll(".campo.falta"), function (el) { return el.textContent.trim().charAt(0) === "["; });
          if (camposPendentes && !window.confirm("Ainda há campos em vermelho sem preencher (entre colchetes). Enviar mesmo assim?")) return;

          var botao = document.getElementById("botao-enviar");
          botao.disabled = true;

          var auth = BX24.getAuth();
          fetch("/bitrix-app/enviar-email", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              authId: auth && auth.access_token,
              entityTypeId: entityTypeId,
              itemId: Number(itemId),
              assinaturaSlug: remetenteEl.value,
              para: document.getElementById("para").value,
              cc: document.getElementById("cc").value,
              assunto: document.getElementById("assunto").value,
              corpo: semMarcas(corpoEl.innerHTML),
              anexos: anexosConcluidos,
            }),
          })
            .then(function (resp) { return resp.json().then(function (dados) { return { ok: resp.ok, dados: dados }; }); })
            .then(function (resultado) {
              botao.disabled = false;
              if (resultado.ok && resultado.dados.ok) {
                mensagem.className = "sucesso";
                mensagem.textContent = "E-mail enviado.";
                try { localStorage.setItem("o2_remetente_assinatura", remetenteEl.value); } catch (e) {}
                document.getElementById("form-email").reset();
                restaurarRemetente();
                aplicarConversa();
                corpoEl.innerHTML = "";
                ultimoAssuntoModelo = "";
                ultimoCorpoModelo = "";
                anexosConcluidos = [];
                renderizarAnexos();
              } else {
                mensagem.className = "erro";
                mensagem.textContent = (resultado.dados && resultado.dados.erro) || "Falha ao enviar.";
              }
            })
            .catch(function () {
              botao.disabled = false;
              mensagem.className = "erro";
              mensagem.textContent = "Falha de conexão. Tente de novo.";
            });
        });
      });
    } catch (erro) {
      mostrarStatus("Falha ao inicializar BX24: " + erro);
    }
  </script>
</body>
</html>`;

  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

// O Bitrix normalmente só faz POST para placements, mas alguns fluxos de
// teste/preview abrem a URL direto no navegador (GET) -- devolve algo
// legível em vez de 405.
export async function GET() {
  return new NextResponse("Esta página só funciona embutida como placement dentro de um card do Bitrix.", {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
