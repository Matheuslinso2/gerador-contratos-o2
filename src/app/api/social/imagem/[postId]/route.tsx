import { ImageResponse } from "next/og";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const ROTULO_CATEGORIA: Record<string, string> = {
  mercado_imobiliario: "Mercado Imobiliário",
  seguro_imobiliario: "Seguro Imobiliário",
  institucional: "O2 Seguros",
};

// Card gerado por post — precisa ser acessível sem login (o Instagram busca
// essa URL direto pra publicar), por isso usa o cliente com service role em
// vez do cliente de sessão normal.
export async function GET(_request: Request, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const supabase = createServiceClient();

  const { data: post } = await supabase
    .from("social_media_posts")
    .select("titulo_card, categoria")
    .eq("id", postId)
    .maybeSingle();

  if (!post) {
    return new Response("Post não encontrado", { status: 404 });
  }

  const rotulo = ROTULO_CATEGORIA[post.categoria] ?? "O2 Seguros";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#00213a",
          padding: "80px",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ width: 14, height: 14, borderRadius: 999, backgroundColor: "#ff5a3b" }} />
          <span style={{ color: "#ff5a3b", fontSize: 32, fontWeight: 700, letterSpacing: 1 }}>
            {rotulo.toUpperCase()}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            color: "white",
            fontSize: 64,
            fontWeight: 800,
            lineHeight: 1.15,
          }}
        >
          {post.titulo_card}
        </div>

        <div style={{ display: "flex", color: "rgba(255,255,255,0.6)", fontSize: 28 }}>Matheus · O2 Seguros</div>
      </div>
    ),
    { width: 1080, height: 1080 }
  );
}
