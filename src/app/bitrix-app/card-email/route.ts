import { NextRequest, NextResponse } from "next/server";
import { salvarInstalacao } from "@/lib/bitrix/appAuth";
import { entityTypeIdPorPlacement } from "@/lib/bitrix/entidadesCard";
import { MODELOS_EMAIL } from "@/lib/bitrix/modelosEmail";

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

  const { accessToken, refreshToken, memberId, expiresIn, dominio } = extrairDadosAuth(campos);

  if (accessToken && refreshToken && dominio && memberId) {
    try {
      await salvarInstalacao({
        dominio,
        memberId,
        accessToken,
        refreshToken,
        expiresInSegundos: Number(expiresIn ?? 3600),
      });
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
  const modelosDoCard = MODELOS_EMAIL.filter(
    (m) => !m.entidades || (entityTypeIdDoPost !== null && m.entidades.includes(entityTypeIdDoPost))
  );

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
    <label for="remetente-nome">Remetente (seu nome)</label>
    <input id="remetente-nome" type="text" maxlength="40" placeholder="Ex: Henrique Guterres" autocomplete="off" />
    <div id="dica-remetente"></div>

    <label for="para">Para</label>
    <input id="para" type="email" required placeholder="cliente@exemplo.com" />

    <label for="modelo" id="rotulo-modelo">Modelo de e-mail</label>
    <select id="modelo">
      <option value="">Em branco (escrever do zero)</option>
    </select>
    <div id="dica-modelo">Escolha um modelo para preencher assunto e mensagem. Depois é só editar o que precisar.</div>

    <div id="bloco-vincular" style="display:none;">
      <div id="aviso-sem-conversa">Este card ainda não tem conversa por e-mail registrada. Se o cliente já conversa com a equipe pelo Gmail, vincule essa conversa para este e-mail entrar nela (em vez de abrir outra).</div>
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
    var infoCard = null;
    var ultimoAssuntoModelo = "";
    var ultimoCorpoModelo = "";

    function escaparHtml(texto) {
      return String(texto).split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;");
    }

    function preencherPlaceholders(texto, comoHtml) {
      var valores = {
        responsavel: (infoCard && infoCard.responsavel) || "[nome do cliente]",
        empresa: (infoCard && infoCard.empresa) || "[empresa/imóvel]",
        card: (infoCard && infoCard.tituloCard) || "[título do card]",
      };
      Object.keys(valores).forEach(function (chave) {
        var valor = comoHtml ? escaparHtml(valores[chave]) : valores[chave];
        texto = texto.split("{{" + chave + "}}").join(valor);
      });
      return texto;
    }

    function popularModelos() {
      var select = document.getElementById("modelo");
      if (!MODELOS_EMAIL.length) {
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
        aplicarConversa();
        corpoEl.focus();
      });
    }
    popularModelos();

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
      chamarConversasGmail({ acao: "buscar", enderecos: [para] })
        .then(function (r) {
          botao.disabled = false;
          botao.textContent = "Procurar conversa no Gmail";
          if (!r.ok) { erroEl.textContent = r.erro || "Falha ao consultar o Gmail."; return; }
          if (!r.conversas.length) {
            listaEl.textContent = "Nenhuma conversa dos últimos 45 dias com " + para + ". Este e-mail abrirá uma conversa nova.";
            return;
          }
          var escolhida = "";
          r.conversas.forEach(function (c) {
            var linha = document.createElement("label");
            linha.className = "conversa-gmail";
            var radio = document.createElement("input");
            radio.type = "radio";
            radio.name = "conversa-gmail";
            radio.addEventListener("change", function () { escolhida = c.threadId; vincular.disabled = false; });
            var texto = document.createElement("span");
            var titulo = document.createElement("b");
            titulo.textContent = c.assunto;
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
          vincular.disabled = true;
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
    document.querySelectorAll("#barra-formatacao button").forEach(function (botao) {
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

        // Nome que a imobiliária vê como remetente. Lembrado no navegador de
        // quem usa (só conveniência -- sem isso o campo só fica vazio).
        var remetenteEl = document.getElementById("remetente-nome");
        var dicaRemetenteEl = document.getElementById("dica-remetente");
        function atualizarDicaRemetente() {
          var nome = remetenteEl.value.replace(/[^\\p{L}\\p{N} '\\-]/gu, "").replace(/\\s+/g, " ").trim();
          dicaRemetenteEl.textContent = "Aparece na caixa de entrada como: " + (nome ? nome + " | O2 Seguros" : "O2 Seguros");
        }
        function restaurarRemetente() {
          try { remetenteEl.value = localStorage.getItem("o2_remetente_nome") || ""; } catch (e) {}
          atualizarDicaRemetente();
        }
        remetenteEl.addEventListener("input", atualizarDicaRemetente);
        restaurarRemetente();

        document.getElementById("form-email").addEventListener("submit", function (evento) {
          evento.preventDefault();
          var corpoEl = document.getElementById("corpo");
          var mensagem = document.getElementById("mensagem");
          mensagem.className = "";
          mensagem.textContent = "";

          if (!corpoEl.textContent.trim()) {
            mensagem.className = "erro";
            mensagem.textContent = "Escreva uma mensagem.";
            corpoEl.focus();
            return;
          }

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
              remetenteNome: remetenteEl.value,
              para: document.getElementById("para").value,
              assunto: document.getElementById("assunto").value,
              corpo: corpoEl.innerHTML,
              anexos: anexosConcluidos,
            }),
          })
            .then(function (resp) { return resp.json().then(function (dados) { return { ok: resp.ok, dados: dados }; }); })
            .then(function (resultado) {
              botao.disabled = false;
              if (resultado.ok && resultado.dados.ok) {
                mensagem.className = "sucesso";
                mensagem.textContent = "E-mail enviado.";
                try { localStorage.setItem("o2_remetente_nome", remetenteEl.value); } catch (e) {}
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
