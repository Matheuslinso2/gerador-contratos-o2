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
// usada com força (cunha diagonal + elemento gráfico), não só como detalhe.
const COR_TIPO: Record<string, string> = {
  dica_mercado: "#f4b400",
  atualizacao_tecnologia: "#14b8a6",
  apresentacao_produto: "#ff5a3b",
  dado_mercado: "#10b981",
  autoridade_pessoal: "#ff5a3b",
};

const FUNDO_ESCURO = "#0b1626";
const FUNDO_ESCURO_2 = "#040a12";

// Caminhos escritos por extenso (não via helper genérico) de propósito: o
// tracer de arquivos da Vercel precisa conseguir "ver" a chamada em tempo de
// build pra incluir o arquivo no bundle da função — path.join(process.cwd(),
// ...variável) não é rastreável e o arquivo some em produção (ficou faltando
// a logo e as fontes até eu perceber isso).
const LOGO_BRANCA_DATA_URI = (() => {
  const base64 = fs.readFileSync(path.join(process.cwd(), "public", "marca-o2", "o2-logo-branco.png")).toString("base64");
  return `data:image/png;base64,${base64}`;
})();

const FONTE_ARCHIVO_BLACK = fs.readFileSync(
  path.join(process.cwd(), "src", "lib", "social", "fonts", "ArchivoBlack-Regular.woff")
);
const FONTE_INTER_800 = fs.readFileSync(
  path.join(process.cwd(), "src", "lib", "social", "fonts", "Inter-ExtraBold.woff")
);
const FONTE_INTER_600 = fs.readFileSync(
  path.join(process.cwd(), "src", "lib", "social", "fonts", "Inter-SemiBold.woff")
);

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

// Grade esparsa de pontos bem sutis — dá textura/profundidade ao fundo sem
// competir com o texto (referência: grão sutil dos posters de evento).
function Textura() {
  const linhas = 9;
  const colunas = 9;
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexWrap: "wrap", padding: "60px" }}>
      {Array.from({ length: linhas * colunas }).map((_, i) => (
        <div
          key={i}
          style={{
            width: "11.1%",
            height: "11.1%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ width: 3, height: 3, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.16)", display: "flex" }} />
        </div>
      ))}
    </div>
  );
}

// Fundo escuro com profundidade: gradiente radial + textura de pontos +
// cunha diagonal na cor do tipo, com uma "sombra" da própria cunha por
// baixo pra dar sensação de camada (não é mais um bloco chapado).
function Fundo({ cor, children }: { cor: string; children: ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: `radial-gradient(circle at 78% 88%, ${FUNDO_ESCURO} 0%, ${FUNDO_ESCURO_2} 65%)`,
        padding: "76px",
        fontFamily: "Inter",
        overflow: "hidden",
      }}
    >
      <Textura />
      <div
        style={{
          position: "absolute",
          top: -395,
          left: -395,
          width: 780,
          height: 780,
          backgroundColor: "#000",
          opacity: 0.35,
          transform: "rotate(45deg)",
          display: "flex",
        }}
      />
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
        <span style={{ display: "flex", color: "white", fontSize: 27, fontFamily: "Inter", fontWeight: 600 }}>
          Matheus Lins
        </span>
        <span style={{ display: "flex", color: "rgba(255,255,255,0.5)", fontSize: 20, fontFamily: "Inter", fontWeight: 600 }}>
          Sócio-diretor · O2 Seguros
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
        <Logo />
        <span style={{ display: "flex", color: "rgba(255,255,255,0.35)", fontSize: 18, fontFamily: "Inter", fontWeight: 600 }}>
          {data}
        </span>
      </div>
    </div>
  );
}

function Rotulo({ texto, cor }: { texto: string; cor: string }) {
  return (
    <span style={{ display: "flex", color: cor, fontSize: 30, fontFamily: "Archivo Black", letterSpacing: 0.5 }}>
      {texto.toUpperCase()}
    </span>
  );
}

// Círculo desfocado-simulado (camadas translúcidas) atrás de um elemento
// gráfico — o "glow" que dá profundidade sem depender de blur real.
function Glow({ cor, tamanho }: { cor: string; tamanho: number }) {
  return (
    <div
      style={{
        position: "absolute",
        width: tamanho,
        height: tamanho,
        borderRadius: 9999,
        backgroundColor: cor,
        opacity: 0.16,
        display: "flex",
      }}
    />
  );
}

function Titulo({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        color: "white",
        fontSize: 60,
        fontFamily: "Inter",
        fontWeight: 800,
        lineHeight: 1.16,
        letterSpacing: -1.5,
      }}
    >
      {children}
    </div>
  );
}

// --- os 5 layouts ----------------------------------------------------------

// 1. Dica de mercado — aspa enorme com glow atrás, tom âmbar.
function LayoutDica({ post, rotulo, cor, data }: LayoutProps) {
  return (
    <Fundo cor={cor}>
      <Rotulo texto={rotulo} cor={cor} />
      <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", gap: 8 }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <div style={{ position: "absolute", left: -20, top: -30, display: "flex" }}>
            <Glow cor={cor} tamanho={220} />
          </div>
          <span style={{ display: "flex", color: cor, fontSize: 170, fontFamily: "Archivo Black", lineHeight: 0.5 }}>
            “
          </span>
        </div>
        <Titulo>{post.titulo_card}</Titulo>
      </div>
      <Rodape data={data} />
    </Fundo>
  );
}

// 2. Atualização de tecnologia — seta grande estilo "próximo passo", tom teal.
function LayoutTecnologia({ post, rotulo, cor, data }: LayoutProps) {
  return (
    <Fundo cor={cor}>
      <Rotulo texto={rotulo} cor={cor} />
      <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", gap: 24 }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ position: "absolute", left: -30, top: -30, display: "flex" }}>
            <Glow cor={cor} tamanho={180} />
          </div>
          <span style={{ display: "flex", color: cor, fontSize: 92, fontFamily: "Archivo Black", lineHeight: 0.5 }}>
            →
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ width: 44, height: 8, borderRadius: 4, backgroundColor: cor, opacity: 0.35 + i * 0.2, display: "flex" }} />
            ))}
          </div>
        </div>
        <Titulo>{post.titulo_card}</Titulo>
      </div>
      <Rodape data={data} />
    </Fundo>
  );
}

// 3. Apresentação de produto — faixa/ribbon com o nome do rótulo, tom coral.
function LayoutProduto({ post, rotulo, cor, data }: LayoutProps) {
  return (
    <Fundo cor={cor}>
      <div
        style={{
          display: "flex",
          alignSelf: "flex-start",
          alignItems: "center",
          gap: 10,
          backgroundColor: cor,
          borderRadius: 10,
          padding: "10px 22px",
          transform: "rotate(-2deg)",
        }}
      >
        <span style={{ display: "flex", color: "#0b1626", fontSize: 26, fontFamily: "Archivo Black" }}>
          {rotulo.toUpperCase()}
        </span>
      </div>
      <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", gap: 30 }}>
        <Titulo>{post.titulo_card}</Titulo>
        <div style={{ display: "flex", gap: 28 }}>
          {["Cotação rápida", "Regulado SUSEP"].map((item) => (
            <div key={item} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ display: "flex", color: cor, fontSize: 26, fontFamily: "Archivo Black" }}>✓</span>
              <span style={{ display: "flex", color: "rgba(255,255,255,0.8)", fontSize: 22, fontFamily: "Inter", fontWeight: 600 }}>
                {item}
              </span>
            </div>
          ))}
        </div>
      </div>
      <Rodape data={data} />
    </Fundo>
  );
}

// 4. Dado de mercado — número gigante com glow e seta de crescimento, tom esmeralda.
function LayoutDado({ post, rotulo, cor, data }: LayoutProps) {
  return (
    <Fundo cor={cor}>
      <Rotulo texto={rotulo} cor={cor} />
      <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", gap: 16 }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ position: "absolute", left: -40, top: -40, display: "flex" }}>
            <Glow cor={cor} tamanho={280} />
          </div>
          <span
            style={{
              display: "flex",
              color: cor,
              fontSize: post.numero_destaque && post.numero_destaque.length > 8 ? 128 : 176,
              fontFamily: "Archivo Black",
              lineHeight: 1,
            }}
          >
            {post.numero_destaque ?? "—"}
          </span>
          <span style={{ display: "flex", color: cor, fontSize: 64, fontFamily: "Archivo Black" }}>↑</span>
        </div>
        <div style={{ display: "flex", color: "white", fontSize: 38, fontFamily: "Inter", fontWeight: 800, lineHeight: 1.3 }}>
          {post.titulo_card}
        </div>
      </div>
      <Rodape data={data} />
    </Fundo>
  );
}

// 5. Autoridade pessoal — aspa grande com glow, frase estilo depoimento, tom coral.
function LayoutAutoridade({ post, rotulo, cor, data }: LayoutProps) {
  return (
    <Fundo cor={cor}>
      <Rotulo texto={rotulo} cor={cor} />
      <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", gap: 4 }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <div style={{ position: "absolute", left: -20, top: -20, display: "flex" }}>
            <Glow cor={cor} tamanho={200} />
          </div>
          <span style={{ display: "flex", color: cor, fontSize: 150, fontFamily: "Archivo Black", lineHeight: 0.4 }}>
            “
          </span>
        </div>
        <div style={{ display: "flex", color: "white", fontSize: 54, fontFamily: "Inter", fontWeight: 800, lineHeight: 1.22, letterSpacing: -1 }}>
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

  try {
    return new ImageResponse(layout, {
      width: 1080,
      height: 1080,
      fonts: [
        { name: "Archivo Black", data: FONTE_ARCHIVO_BLACK, weight: 400, style: "normal" },
        { name: "Inter", data: FONTE_INTER_800, weight: 800, style: "normal" },
        { name: "Inter", data: FONTE_INTER_600, weight: 600, style: "normal" },
      ],
    });
  } catch (erro) {
    console.error("Falha ao gerar imagem do post", postId, erro);
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    return new Response(`Erro ao gerar imagem: ${mensagem}`, { status: 500 });
  }
}
