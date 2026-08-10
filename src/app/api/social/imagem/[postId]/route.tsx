import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { ImageResponse } from "next/og";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const ROTULO_CATEGORIA: Record<string, string> = {
  mercado_imobiliario: "Mercado Imobiliário",
  seguro_imobiliario: "Seguro Imobiliário",
  institucional: "O2 Seguros",
};

const ROTULO_TIPO: Record<string, string> = {
  dica_mercado: "Dica de mercado",
  atualizacao_tecnologia: "Tech update",
  apresentacao_produto: "Produto O2",
  dado_mercado: "Dado de mercado",
  autoridade_pessoal: "Ponto de vista",
};

// Cor de destaque por tipo de post — cada layout tem sua própria paleta,
// além da diferenciação por categoria.
const COR_TIPO: Record<string, string> = {
  dica_mercado: "#f4b400",
  atualizacao_tecnologia: "#14b8a6",
  apresentacao_produto: "#ff5a3b",
  dado_mercado: "#10b981",
  autoridade_pessoal: "#ff5a3b",
};

// Logo branca oficial embutida como data URI — satori (motor do ImageResponse)
// não busca arquivos relativos do /public, precisa de URL absoluta ou data URI.
const LOGO_BRANCA_DATA_URI = (() => {
  const caminho = path.join(process.cwd(), "public", "marca-o2", "o2-logo-branco.png");
  const base64 = fs.readFileSync(caminho).toString("base64");
  return `data:image/png;base64,${base64}`;
})();

function fmtData(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

type DadosPost = {
  titulo_card: string;
  categoria: string;
  tipo_post: string | null;
  numero_destaque: string | null;
  criado_em: string;
};

// --- peças reaproveitadas entre os 5 layouts ------------------------------

function Fundo({ cor, children }: { cor: string; children: ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(135deg, #012a49 0%, #00213a 55%, #001526 100%)",
        padding: "72px",
        fontFamily: "sans-serif",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -160,
          right: -160,
          width: 460,
          height: 460,
          borderRadius: 9999,
          border: `36px solid ${cor}33`,
          display: "flex",
        }}
      />
      {children}
    </div>
  );
}

function Cabecalho({ rotulo, cor }: { rotulo: string; cor: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      {/* Logo real tem proporção ~1.82:1 (3046x1678) — largura calculada pra não esticar. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGO_BRANCA_DATA_URI} width={112} height={62} alt="" style={{ objectFit: "contain" }} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          backgroundColor: cor,
          borderRadius: 999,
          padding: "12px 24px",
        }}
      >
        <div style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: "white", display: "flex" }} />
        <span style={{ color: "white", fontSize: 24, fontWeight: 700, letterSpacing: 1 }}>
          {rotulo.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

function Rodape({ cor, data }: { cor: string; data: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderTop: "2px solid rgba(255,255,255,0.14)",
        paddingTop: 32,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 999,
            backgroundColor: "rgba(255,255,255,0.08)",
            border: `2px solid ${cor}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: cor,
            fontSize: 26,
            fontWeight: 800,
          }}
        >
          M
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ color: "white", fontSize: 26, fontWeight: 700 }}>Matheus Lino</span>
          <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 21 }}>Sócio-diretor · O2 Seguros</span>
        </div>
      </div>
      <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 22 }}>{data}</span>
    </div>
  );
}

// --- os 5 layouts ----------------------------------------------------------

// 1. Dica de mercado — aspas gigantes desbotadas atrás do texto, tom âmbar.
function LayoutDica({ post, rotulo, cor, data }: { post: DadosPost; rotulo: string; cor: string; data: string }) {
  return (
    <Fundo cor={cor}>
      <div
        style={{
          position: "absolute",
          top: 20,
          left: 40,
          fontSize: 320,
          color: `${cor}22`,
          fontWeight: 800,
          display: "flex",
          lineHeight: 1,
        }}
      >
        “
      </div>
      <Cabecalho rotulo={rotulo} cor={cor} />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 32 }}>
        <div style={{ width: 96, height: 10, borderRadius: 6, backgroundColor: cor, display: "flex" }} />
        <div
          style={{ display: "flex", color: "white", fontSize: 58, fontWeight: 800, lineHeight: 1.2, letterSpacing: -1 }}
        >
          {post.titulo_card}
        </div>
      </div>
      <Rodape cor={cor} data={data} />
    </Fundo>
  );
}

// 2. Atualização de tecnologia — grade de pontos (feel "digital") + barra segmentada.
function LayoutTecnologia({ post, rotulo, cor, data }: { post: DadosPost; rotulo: string; cor: string; data: string }) {
  const linhas = 5;
  const colunas = 6;
  const pontos = Array.from({ length: linhas * colunas });
  return (
    <Fundo cor={cor}>
      <div style={{ position: "absolute", top: 120, right: 60, display: "flex", flexDirection: "column", gap: 14 }}>
        {Array.from({ length: linhas }).map((_, linha) => (
          <div key={linha} style={{ display: "flex", gap: 14 }}>
            {Array.from({ length: colunas }).map((_, coluna) => (
              <div
                key={coluna}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  backgroundColor: `${cor}${(linha + coluna) % 3 === 0 ? "55" : "22"}`,
                  display: "flex",
                }}
              />
            ))}
          </div>
        ))}
        {pontos.length === 0 && null}
      </div>
      <Cabecalho rotulo={rotulo} cor={cor} />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 32 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ width: 40, height: 8, borderRadius: 4, backgroundColor: cor, display: "flex" }} />
          ))}
        </div>
        <div
          style={{ display: "flex", color: "white", fontSize: 58, fontWeight: 800, lineHeight: 1.2, letterSpacing: -1 }}
        >
          {post.titulo_card}
        </div>
      </div>
      <Rodape cor={cor} data={data} />
    </Fundo>
  );
}

// 3. Apresentação de produto — cartão central estilo "vitrine", tom coral.
function LayoutProduto({ post, rotulo, cor, data }: { post: DadosPost; rotulo: string; cor: string; data: string }) {
  return (
    <Fundo cor={cor}>
      <Cabecalho rotulo={rotulo} cor={cor} />
      <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
            backgroundColor: "rgba(255,255,255,0.06)",
            border: `2px solid ${cor}66`,
            borderRadius: 28,
            padding: "56px 52px",
          }}
        >
          <div
            style={{
              display: "flex",
              color: "white",
              fontSize: 52,
              fontWeight: 800,
              lineHeight: 1.2,
              letterSpacing: -1,
            }}
          >
            {post.titulo_card}
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            {["Cotação rápida", "Time humano", "Regulado SUSEP"].map((item) => (
              <div
                key={item}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  backgroundColor: `${cor}22`,
                  borderRadius: 999,
                  padding: "8px 16px",
                }}
              >
                <span style={{ color: cor, fontSize: 20, fontWeight: 800 }}>✓</span>
                <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 18 }}>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <Rodape cor={cor} data={data} />
    </Fundo>
  );
}

// 4. Dado de mercado — o número domina o card, título vira legenda de apoio.
function LayoutDado({ post, rotulo, cor, data }: { post: DadosPost; rotulo: string; cor: string; data: string }) {
  return (
    <Fundo cor={cor}>
      <Cabecalho rotulo={rotulo} cor={cor} />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 20 }}>
        <div
          style={{
            display: "flex",
            color: cor,
            fontSize: post.numero_destaque && post.numero_destaque.length > 8 ? 130 : 190,
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: -2,
          }}
        >
          {post.numero_destaque ?? "—"}
        </div>
        <div style={{ display: "flex", color: "white", fontSize: 40, fontWeight: 700, lineHeight: 1.3 }}>
          {post.titulo_card}
        </div>
      </div>
      <Rodape cor={cor} data={data} />
    </Fundo>
  );
}

// 5. Autoridade pessoal — estilo depoimento, avatar grande, tom navy contido.
function LayoutAutoridade({ post, rotulo, cor, data }: { post: DadosPost; rotulo: string; cor: string; data: string }) {
  return (
    <Fundo cor={cor}>
      <Cabecalho rotulo={rotulo} cor={cor} />
      <div style={{ display: "flex", alignItems: "center", gap: 40, flex: 1 }}>
        <div
          style={{
            width: 160,
            height: 160,
            borderRadius: 9999,
            backgroundColor: "rgba(255,255,255,0.08)",
            border: `3px solid ${cor}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: cor,
            fontSize: 72,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          M
        </div>
        <div
          style={{
            display: "flex",
            color: "white",
            fontSize: 48,
            fontWeight: 800,
            lineHeight: 1.25,
            letterSpacing: -1,
          }}
        >
          {post.titulo_card}
        </div>
      </div>
      <Rodape cor={cor} data={data} />
    </Fundo>
  );
}

// Card gerado por post — precisa ser acessível sem login (o Instagram busca
// essa URL direto pra publicar), por isso usa o cliente com service role em
// vez do cliente de sessão normal.
export async function GET(_request: Request, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const supabase = createServiceClient();

  const { data: post } = await supabase
    .from("social_media_posts")
    .select("titulo_card, categoria, tipo_post, numero_destaque, criado_em")
    .eq("id", postId)
    .maybeSingle<DadosPost>();

  if (!post) {
    return new Response("Post não encontrado", { status: 404 });
  }

  const rotulo = post.tipo_post ? ROTULO_TIPO[post.tipo_post] : (ROTULO_CATEGORIA[post.categoria] ?? "O2 Seguros");
  const cor = (post.tipo_post && COR_TIPO[post.tipo_post]) ?? "#ff5a3b";
  const data = fmtData(post.criado_em);

  const props = { post, rotulo, cor, data };

  let layout: ReactNode;
  switch (post.tipo_post) {
    case "dica_mercado":
      layout = <LayoutDica {...props} />;
      break;
    case "atualizacao_tecnologia":
      layout = <LayoutTecnologia {...props} />;
      break;
    case "apresentacao_produto":
      layout = <LayoutProduto {...props} />;
      break;
    case "dado_mercado":
      layout = post.numero_destaque ? <LayoutDado {...props} /> : <LayoutAutoridade {...props} />;
      break;
    default:
      layout = <LayoutAutoridade {...props} />;
  }

  return new ImageResponse(layout, { width: 1080, height: 1080 });
}
