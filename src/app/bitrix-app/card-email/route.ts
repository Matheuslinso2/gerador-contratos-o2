import { NextRequest, NextResponse } from "next/server";
import { salvarInstalacao } from "@/lib/bitrix/appAuth";

export const dynamic = "force-dynamic";

// Handler do placement "E-mail" dentro do card do Bitrix (Fase 0: só prova
// que o mecanismo funciona, sem lógica de e-mail ainda -- ver
// C:\Users\O2-Grupo\.claude\plans\frolicking-floating-frog.md).
//
// O Bitrix sempre faz POST (não GET) toda vez que a aba do placement é
// aberta, reemitindo um token de acesso novo a cada abertura -- nomes de
// campo padrão (AUTH_ID/REFRESH_ID/AUTH_EXPIRES/DOMAIN/member_id) conforme a
// documentação de aplicativo local do Bitrix24, mas isso NUNCA foi testado
// contra este portal nesta sessão. Se o parsing abaixo não achar os campos
// esperados, os logs do Vercel vão mostrar as chaves recebidas de verdade
// para ajuste.
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

  const authId = campos.AUTH_ID;
  const refreshId = campos.REFRESH_ID;
  const authExpires = campos.AUTH_EXPIRES;
  const dominio = campos.DOMAIN;
  const memberId = campos.member_id;

  if (authId && refreshId && dominio && memberId) {
    try {
      await salvarInstalacao({
        dominio,
        memberId,
        accessToken: authId,
        refreshToken: refreshId,
        expiresInSegundos: Number(authExpires ?? 3600),
      });
    } catch (erro) {
      console.error("Falha ao salvar token do app Bitrix:", erro);
    }
  } else {
    console.warn("POST do placement sem os campos de auth esperados -- token não foi salvo/atualizado.");
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
