import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Recebe o envio de QUALQUER formulário Elementor do site o2seguros.com.br,
// via a ação nativa "Webhook" (sem suporte a headers customizados -- por
// isso o token vai na própria URL, não num header, diferente do padrão
// usado nas integrações via Google Apps Script). Autenticação por token
// guardado no Supabase (não deu pra configurar env var no Vercel via MCP
// nesta rodada -- mesmo espírito de acesso_publico_tokens).
async function autorizado(request: NextRequest): Promise<boolean> {
  const secret = request.nextUrl.searchParams.get("secret");
  if (!secret) return false;
  const supabase = createServiceClient();
  const { data } = await supabase.from("wordpress_leads_tokens").select("id").eq("token", secret).maybeSingle();
  return Boolean(data);
}

function primeiraChaveComValor(campos: Record<string, unknown>, chaves: string[]): string | null {
  for (const chave of chaves) {
    const valor = campos[chave];
    if (typeof valor === "string" && valor.trim()) return valor.trim();
    if (typeof valor === "number") return String(valor);
  }
  return null;
}

// O Elementor manda os campos do formulário num formato que varia conforme a
// configuração (direto na raiz, ou dentro de "fields"/"form_fields"). Aceita
// os dois pra não quebrar se a estrutura exata só aparecer no teste real.
function extrairCampos(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") return {};
  const bruto = payload as Record<string, unknown>;
  const aninhado = bruto.fields ?? bruto.form_fields ?? bruto.data;
  if (aninhado && typeof aninhado === "object") return aninhado as Record<string, unknown>;
  return bruto;
}

export async function POST(request: NextRequest) {
  // Sempre responde rápido e sem erro pro Elementor, mesmo quando algo dá
  // errado aqui dentro -- o objetivo é nunca atrapalhar a experiência de
  // quem está preenchendo o formulário no site.
  try {
    if (!(await autorizado(request))) {
      return NextResponse.json({ ok: false, erro: "não autorizado" }, { status: 401 });
    }

    const payload = await request.json().catch(() => ({}));
    const campos = extrairCampos(payload);
    const formulario = request.nextUrl.searchParams.get("formulario") || null;
    // "_post_url" é o campo que o Advanced Form Integration manda de fato
    // pra formulários Elementor (confirmado no teste real, 02/10/2026).
    const paginaUrl = primeiraChaveComValor(campos, ["page_url", "pagina_url", "url", "_post_url"]);

    const supabase = createServiceClient();
    const { error } = await supabase.from("leads_site_o2seguros").insert({
      formulario,
      pagina_url: paginaUrl,
      nome: primeiraChaveComValor(campos, ["nome", "name", "seu_nome", "Nome", "full_name"]),
      email: primeiraChaveComValor(campos, ["email", "e-mail", "seu_email", "Email"]),
      telefone: primeiraChaveComValor(campos, ["telefone", "phone", "whatsapp", "celular", "Telefone"]),
      utm_source: primeiraChaveComValor(campos, ["utm_source", "UTM_source"]),
      utm_medium: primeiraChaveComValor(campos, ["utm_medium", "UTM_medium"]),
      utm_campaign: primeiraChaveComValor(campos, ["utm_campaign", "UTM_campaign"]),
      campos: payload,
    });

    if (error) {
      console.error("Falha ao gravar lead do site:", error);
      return NextResponse.json({ ok: false, erro: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Erro inesperado no webhook de leads do site:", error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
