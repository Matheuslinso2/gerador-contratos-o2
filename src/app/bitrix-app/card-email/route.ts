import { NextRequest, NextResponse } from "next/server";
import { salvarInstalacao } from "@/lib/bitrix/appAuth";
import { entityTypeIdPorPlacement } from "@/lib/bitrix/entidadesCard";

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

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>E-mail do card — O2 Seguros</title>
  <script src="https://api.bitrix24.com/api/v1/"></script>
  <style>
    body { font-family: 'Poppins', system-ui, sans-serif; margin: 0; padding: 20px; color: #01192e; background: #fff; }
    #status { font-size: 13px; color: #8d8683; margin-bottom: 12px; }
    label { display: block; font-size: 12px; font-weight: 600; color: #444440; margin: 12px 0 4px; }
    input { width: 100%; box-sizing: border-box; padding: 9px 10px; border: 1px solid #d9d9d9; border-radius: 8px; font-family: inherit; font-size: 14px; }
    #barra-formatacao { display: flex; gap: 4px; margin-top: 6px; }
    #barra-formatacao button { margin: 0; background: #fff; color: #01192e; border: 1px solid #d9d9d9; border-radius: 6px; width: 30px; height: 30px; padding: 0; font-size: 13px; font-weight: 700; cursor: pointer; line-height: 1; }
    #barra-formatacao button:hover { background: #f4f4f4; }
    #barra-formatacao button[data-cmd="italic"] { font-style: italic; }
    #corpo { min-height: 140px; box-sizing: border-box; padding: 9px 10px; border: 1px solid #d9d9d9; border-radius: 8px; font-family: inherit; font-size: 14px; margin-top: 6px; }
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
  </style>
</head>
<body>
  <div id="status">Carregando informações do card…</div>

  <div id="preview-card"></div>

  <form id="form-email" style="display:none;">
    <label for="para">Para</label>
    <input id="para" type="email" required placeholder="cliente@exemplo.com" />

    <label for="assunto">Assunto</label>
    <input id="assunto" type="text" required />

    <label for="corpo">Mensagem</label>
    <div id="barra-formatacao">
      <button type="button" data-cmd="bold" title="Negrito"><b>B</b></button>
      <button type="button" data-cmd="italic" title="Itálico">I</button>
      <button type="button" data-cmd="insertUnorderedList" title="Lista">•—</button>
      <button type="button" data-cmd="createLink" title="Link">🔗</button>
    </div>
    <div id="corpo" contenteditable="true" role="textbox" aria-multiline="true"></div>

    <button class="enviar" id="botao-enviar" type="submit">Enviar</button>
    <div id="mensagem"></div>
  </form>

  <script>
    var itemId = ${JSON.stringify(itemIdDoPost)};
    var entityTypeId = ${JSON.stringify(entityTypeIdDoPost)};

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
          var linhas = "";
          if (info.tituloCard) linhas += '<div class="linha"><span class="rotulo">Card</span><span class="valor">#' + itemId + ' · ' + info.tituloCard + '</span></div>';
          if (info.empresa) linhas += '<div class="linha"><span class="rotulo">Empresa/Imóvel</span><span class="valor">' + info.empresa + '</span></div>';
          if (info.responsavel) linhas += '<div class="linha"><span class="rotulo">Responsável</span><span class="valor">' + info.responsavel + '</span></div>';
          linhas += '<div class="aviso" style="margin-top:6px;">Esse bloco (+ o selo "' + info.badge + '") entra automaticamente no e-mail, junto com sua mensagem.</div>';
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

    try {
      BX24.init(function () {
        var info = BX24.placement.info();
        if (info && info.options && info.options.ID) itemId = String(info.options.ID);
        habilitarFormulario();

        var authInicial = BX24.getAuth();
        if (itemId && entityTypeId) carregarPreviaCard(authInicial && authInicial.access_token);

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
              para: document.getElementById("para").value,
              assunto: document.getElementById("assunto").value,
              corpo: corpoEl.innerHTML,
            }),
          })
            .then(function (resp) { return resp.json().then(function (dados) { return { ok: resp.ok, dados: dados }; }); })
            .then(function (resultado) {
              botao.disabled = false;
              if (resultado.ok && resultado.dados.ok) {
                mensagem.className = "sucesso";
                mensagem.textContent = "E-mail enviado.";
                document.getElementById("form-email").reset();
                corpoEl.innerHTML = "";
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
