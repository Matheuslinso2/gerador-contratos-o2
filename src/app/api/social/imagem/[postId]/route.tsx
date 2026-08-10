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

// Cor de destaque por tipo de post — cada layout tem sua própria cor,
// usada com força (crachá/cunha diagonal), não só como detalhe.
const COR_TIPO: Record<string, string> = {
  dica_mercado: "#f4b400",
  atualizacao_tecnologia: "#14b8a6",
  apresentacao_produto: "#ff5a3b",
  dado_mercado: "#10b981",
  autoridade_pessoal: "#ff5a3b",
};

const FUNDO_ESCURO = "#0b1626";

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

type LayoutProps = { post: DadosPost; rotulo: string; cor: string; data: string };

// --- peças reaproveitadas entre os 5 layouts ------------------------------

// Fundo escuro liso + cunha diagonal na cor do tipo, no estilo "pôster de
// evento" (referência: cards de palestrante do setor imobiliário) — nada de
// gradiente/anéis finos, que estava lendo como slide corporativo.
function Fundo({ cor, children }: { cor: string; children: ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: FUNDO_ESCURO,
        padding: "76px",
        fontFamily: "sans-serif",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -420,
          left: -420,
          width: 780,
          height: 780,
          backgroundColor: cor,
          transform: "rotate(45deg)",
          display: "flex",
        }}
      />
      {children}
    </div>
  );
}

function Logo() {
  // Logo real tem proporção ~1.82:1 (3046x1678) — largura calculada pra não esticar.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={LOGO_BRANCA_DATA_URI} width={96} height={53} alt="" style={{ objectFit: "contain" }} />;
}

function Rodape({ data }: { data: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ color: "white", fontSize: 27, fontWeight: 700 }}>Matheus Lins</span>
        <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 20 }}>Sócio-diretor · O2 Seguros</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
        <Logo />
        <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 18 }}>{data}</span>
      </div>
    </div>
  );
}

function Rotulo({ texto, cor }: { texto: string; cor: string }) {
  return (
    <span style={{ display: "flex", color: cor, fontSize: 30, fontWeight: 800, letterSpacing: 1 }}>
      {texto.toUpperCase()}
    </span>
  );
}

// --- os 5 layouts ----------------------------------------------------------

// 1. Dica de mercado — rótulo grande sobre a cunha, aspa de apoio, tom âmbar.
function LayoutDica({ post, rotulo, cor, data }: LayoutProps) {
  return (
    <Fundo cor={cor}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Rotulo texto={rotulo} cor={cor} />
      </div>
      <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", gap: 16 }}>
        <span style={{ display: "flex", color: cor, fontSize: 96, fontWeight: 800, lineHeight: 0.6 }}>“</span>
        <div style={{ display: "flex", color: "white", fontSize: 62, fontWeight: 800, lineHeight: 1.18, letterSpacing: -1 }}>
          {post.titulo_card}
        </div>
      </div>
      <Rodape data={data} />
    </Fundo>
  );
}

// 2. Atualização de tecnologia — rótulo + trilha de passos, tom teal.
function LayoutTecnologia({ post, rotulo, cor, data }: LayoutProps) {
  return (
    <Fundo cor={cor}>
      <Rotulo texto={rotulo} cor={cor} />
      <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", gap: 28 }}>
        <div style={{ display: "flex", gap: 10 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ width: 46, height: 6, borderRadius: 3, backgroundColor: cor, display: "flex" }} />
          ))}
        </div>
        <div style={{ display: "flex", color: "white", fontSize: 62, fontWeight: 800, lineHeight: 1.18, letterSpacing: -1 }}>
          {post.titulo_card}
        </div>
      </div>
      <Rodape data={data} />
    </Fundo>
  );
}

// 3. Apresentação de produto — rótulo grande, 2 chips soltos (sem caixa pesada), tom coral.
function LayoutProduto({ post, rotulo, cor, data }: LayoutProps) {
  return (
    <Fundo cor={cor}>
      <Rotulo texto={rotulo} cor={cor} />
      <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", gap: 28 }}>
        <div style={{ display: "flex", color: "white", fontSize: 62, fontWeight: 800, lineHeight: 1.18, letterSpacing: -1 }}>
          {post.titulo_card}
        </div>
        <div style={{ display: "flex", gap: 28 }}>
          {["Cotação rápida", "Regulado SUSEP"].map((item) => (
            <div key={item} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ display: "flex", color: cor, fontSize: 26, fontWeight: 800 }}>✓</span>
              <span style={{ display: "flex", color: "rgba(255,255,255,0.8)", fontSize: 22 }}>{item}</span>
            </div>
          ))}
        </div>
      </div>
      <Rodape data={data} />
    </Fundo>
  );
}

// 4. Dado de mercado — o número vira o rótulo em si, gigante, tom esmeralda.
function LayoutDado({ post, rotulo, cor, data }: LayoutProps) {
  return (
    <Fundo cor={cor}>
      <Rotulo texto={rotulo} cor={cor} />
      <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", gap: 16 }}>
        <div
          style={{
            display: "flex",
            color: cor,
            fontSize: post.numero_destaque && post.numero_destaque.length > 8 ? 140 : 200,
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: -2,
          }}
        >
          {post.numero_destaque ?? "—"}
        </div>
        <div style={{ display: "flex", color: "white", fontSize: 38, fontWeight: 700, lineHeight: 1.3 }}>
          {post.titulo_card}
        </div>
      </div>
      <Rodape data={data} />
    </Fundo>
  );
}

// 5. Autoridade pessoal — abertura de aspas grande + frase, sem crachá de avatar.
function LayoutAutoridade({ post, rotulo, cor, data }: LayoutProps) {
  return (
    <Fundo cor={cor}>
      <Rotulo texto={rotulo} cor={cor} />
      <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", gap: 12 }}>
        <span style={{ display: "flex", color: cor, fontSize: 110, fontWeight: 800, lineHeight: 0.5 }}>“</span>
        <div style={{ display: "flex", color: "white", fontSize: 54, fontWeight: 800, lineHeight: 1.22, letterSpacing: -1 }}>
          {post.titulo_card}
        </div>
      </div>
      <Rodape data={data} />
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
