import { NextRequest, NextResponse } from "next/server";
import { salvarInstalacao } from "@/lib/bitrix/appAuth";

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

  let dominio: string | undefined;
  if (campos.SERVER_ENDPOINT) {
    dominio = campos.SERVER_ENDPOINT.replace(/^https?:\/\//, "").replace(/\/rest\/?$/, "");
  } else {
    const dominioAuth = campos["auth[domain]"] ?? campos.DOMAIN;
    dominio = dominioAuth && dominioAuth !== "oauth.bitrix.info" ? dominioAuth : undefined;
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
  // CRM_DEAL_DETAIL_TAB). Mostramos o id aqui via BX24 no cliente também,
  // como caminho mais confiável -- ver comentário no HTML abaixo.
  let dealIdDoPost: string | null = null;
  try {
    const placementOptions = campos.PLACEMENT_OPTIONS ? JSON.parse(campos.PLACEMENT_OPTIONS) : null;
    dealIdDoPost = placementOptions?.ID ? String(placementOptions.ID) : null;
  } catch {
    // PLACEMENT_OPTIONS ausente ou em formato inesperado -- sem problema,
    // a leitura via BX24.placement.info() no cliente é a fonte confiável.
  }

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>E-mail do card — O2 Seguros</title>
  <script src="https://api.bitrix24.com/api/v1/"></script>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; color: #01192e; }
    #status { font-size: 15px; }
  </style>
</head>
<body>
  <div id="status">Carregando informações do card…</div>
  <script>
    function mostrar(texto) {
      document.getElementById("status").textContent = texto;
    }
    try {
      BX24.init(function () {
        var info = BX24.placement.info();
        var id = (info && info.options && info.options.ID) || ${JSON.stringify(dealIdDoPost)};
        mostrar(id ? ("Card #" + id + " carregado com sucesso.") : "Placement carregado, mas não veio ID do card.");
      });
    } catch (erro) {
      mostrar("Falha ao inicializar BX24: " + erro);
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
