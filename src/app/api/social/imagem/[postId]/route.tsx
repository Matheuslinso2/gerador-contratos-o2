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

// Caminhos escritos por extenso (não via helper com args dinâmicos) de
// propósito: o tracer de arquivos da Vercel precisa "ver" a chamada em tempo
// de build pra incluir o arquivo no bundle da função.
const LOGO_BRANCA = `data:image/png;base64,${fs.readFileSync(path.join(process.cwd(), "public", "marca-o2", "o2-logo-branco.png")).toString("base64")}`;
const LOGO_COLORIDA = `data:image/png;base64,${fs.readFileSync(path.join(process.cwd(), "public", "marca-o2", "o2-logo-horizontal.png")).toString("base64")}`;

const FONTE_ARCHIVO_BLACK = fs.readFileSync(
  path.join(process.cwd(), "src", "lib", "social", "fonts", "ArchivoBlack-Regular.woff")
);
const FONTE_INTER_800 = fs.readFileSync(
  path.join(process.cwd(), "src", "lib", "social", "fonts", "Inter-ExtraBold.woff")
);
const FONTE_INTER_600 = fs.readFileSync(
  path.join(process.cwd(), "src", "lib", "social", "fonts", "Inter-SemiBold.woff")
);

const NAVY = "#01192e";
const CORAL = "#F8540D";

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

type LayoutProps = { post: DadosPost; rotulo: string; data: string };

// --- peças reaproveitadas (mas cada layout as combina de um jeito diferente) --

// Casa simples construída só com formas. O truque de borda pra triângulo
// (3 lados transparentes) não renderiza direito no satori — vira um
// retângulo — então o telhado é um quadrado girado 45° "espetado" atrás do
// corpo (a própria casa, desenhada por cima, corta a metade de baixo do
// losango e sobra só o pico triangular).
function Casa({ cor, tamanho }: { cor: string; tamanho: number }) {
  const corpoLargura = tamanho * 0.78;
  const corpoAltura = tamanho * 0.58;
  const telhado = tamanho * 0.62;
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: corpoLargura,
        height: tamanho,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: (corpoLargura - telhado) / 2,
          width: telhado,
          height: telhado,
          backgroundColor: cor,
          transform: "rotate(45deg)",
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 0,
          width: corpoLargura,
          height: corpoAltura,
          backgroundColor: cor,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          paddingBottom: tamanho * 0.06,
        }}
      >
        <div
          style={{
            width: tamanho * 0.16,
            height: tamanho * 0.28,
            backgroundColor: "rgba(0,0,0,0.22)",
            borderRadius: "3px 3px 0 0",
            display: "flex",
          }}
        />
      </div>
    </div>
  );
}

// Silhueta de prédios (skyline) — barras de altura variável.
function Skyline({ cor, alturaBase }: { cor: string; alturaBase: number }) {
  const fatores = [0.45, 0.75, 0.55, 1, 0.65, 0.85, 0.5, 0.7];
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
      {fatores.map((f, i) => (
        <div
          key={i}
          style={{
            width: 26,
            height: alturaBase * f,
            backgroundColor: cor,
            borderRadius: "3px 3px 0 0",
            display: "flex",
          }}
        />
      ))}
    </div>
  );
}

function Glow({ cor, tamanho, opacidade = 0.22 }: { cor: string; tamanho: number; opacidade?: number }) {
  return (
    <div
      style={{
        position: "absolute",
        width: tamanho,
        height: tamanho,
        borderRadius: 9999,
        backgroundColor: cor,
        opacity: opacidade,
        display: "flex",
      }}
    />
  );
}

function Pill({ texto, bg, corTexto }: { texto: string; bg: string; corTexto: string }) {
  return (
    <div style={{ display: "flex", alignSelf: "flex-start", backgroundColor: bg, borderRadius: 999, padding: "10px 22px" }}>
      <span style={{ display: "flex", color: corTexto, fontSize: 22, fontFamily: "Archivo Black", letterSpacing: 0.5 }}>
        {texto.toUpperCase()}
      </span>
    </div>
  );
}

function RodapeBase({
  data,
  corNome,
  corCargo,
  logo,
  logoLargura,
  logoAltura,
}: {
  data: string;
  corNome: string;
  corCargo: string;
  logo: string;
  logoLargura: number;
  logoAltura: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ display: "flex", color: corNome, fontSize: 26, fontFamily: "Inter", fontWeight: 600 }}>
          Matheus Lins
        </span>
        <span style={{ display: "flex", color: corCargo, fontSize: 19, fontFamily: "Inter", fontWeight: 600 }}>
          Sócio-diretor · O2 Seguros
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} width={logoLargura} height={logoAltura} alt="" style={{ objectFit: "contain" }} />
        <span style={{ display: "flex", color: corCargo, fontSize: 17, fontFamily: "Inter", fontWeight: 600, opacity: 0.7 }}>
          {data}
        </span>
      </div>
    </div>
  );
}

// --- os 5 layouts, cada um com composição própria (não é o mesmo esqueleto) --

// 1. Dica de mercado — fundo claro em gradiente quente, texto escuro, ícone
// de casa coral. Tom "app fintech jovem", nada de fundo escuro.
function LayoutDica({ post, rotulo, data }: LayoutProps) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(150deg, #fff1e4 0%, #ffd9a8 55%, #ffc078 100%)",
        padding: "76px",
        fontFamily: "Inter",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", right: -60, bottom: -40, display: "flex" }}>
        <Casa cor="rgba(255,90,59,0.16)" tamanho={340} />
      </div>

      <Pill texto={rotulo} bg={NAVY} corTexto="white" />

      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 26 }}>
        <div
          style={{
            display: "flex",
            color: NAVY,
            fontSize: 62,
            fontFamily: "Inter",
            fontWeight: 800,
            lineHeight: 1.14,
            letterSpacing: -1.5,
          }}
        >
          {post.titulo_card}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Casa cor={CORAL} tamanho={56} />
        </div>
      </div>

      <RodapeBase
        data={data}
        corNome={NAVY}
        corCargo="rgba(0,33,58,0.65)"
        logo={LOGO_COLORIDA}
        logoLargura={104}
        logoAltura={57}
      />
    </div>
  );
}

// 2. Atualização de tecnologia — quase preto, neon ciano, skyline com glow.
function LayoutTecnologia({ post, rotulo, data }: LayoutProps) {
  const CIANO = "#2fe6e6";
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#05080c",
        padding: "76px",
        fontFamily: "Inter",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", left: "50%", top: 380, display: "flex" }}>
        <Glow cor={CIANO} tamanho={520} opacidade={0.16} />
      </div>

      <Pill texto={rotulo} bg={CIANO} corTexto="#05080c" />

      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "flex-end", gap: 28 }}>
        <div style={{ display: "flex" }}>
          <Skyline cor={CIANO} alturaBase={150} />
        </div>
        <div
          style={{
            display: "flex",
            color: "white",
            fontSize: 58,
            fontFamily: "Archivo Black",
            lineHeight: 1.1,
          }}
        >
          {post.titulo_card}
        </div>
      </div>

      <div style={{ marginTop: 32, display: "flex" }}>
        <RodapeBase
          data={data}
          corNome="white"
          corCargo="rgba(255,255,255,0.5)"
          logo={LOGO_BRANCA}
          logoLargura={96}
          logoAltura={53}
        />
      </div>
    </div>
  );
}

// 3. Apresentação de produto — fundo claro tipo catálogo, ícone de casa
// grande, grade de benefícios. Bem diferente dos dois de fundo escuro.
function LayoutProduto({ post, rotulo, data }: LayoutProps) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#faf3ea",
        padding: "76px",
        fontFamily: "Inter",
        overflow: "hidden",
      }}
    >
      <Pill texto={rotulo} bg={CORAL} corTexto="white" />

      <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 44 }}>
        <Casa cor={CORAL} tamanho={220} />
        <div style={{ display: "flex", flex: 1, minWidth: 0, flexDirection: "column", gap: 22 }}>
          <div
            style={{
              display: "flex",
              color: NAVY,
              fontSize: 46,
              fontFamily: "Inter",
              fontWeight: 800,
              lineHeight: 1.18,
              letterSpacing: -1,
            }}
          >
            {post.titulo_card}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {["Cotação rápida", "Regulado SUSEP"].map((item) => (
              <div key={item} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    backgroundColor: NAVY,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span style={{ display: "flex", color: "white", fontSize: 14, fontFamily: "Archivo Black" }}>✓</span>
                </div>
                <span style={{ display: "flex", color: NAVY, fontSize: 22, fontFamily: "Inter", fontWeight: 600 }}>
                  {item}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ borderTop: `2px solid ${NAVY}22`, paddingTop: 28, display: "flex" }}>
        <RodapeBase
          data={data}
          corNome={NAVY}
          corCargo="rgba(0,33,58,0.6)"
          logo={LOGO_COLORIDA}
          logoLargura={104}
          logoAltura={57}
        />
      </div>
    </div>
  );
}

// 4. Dado de mercado — divisão diagonal duotone (esmeralda/navy), número
// gigante atravessando a divisão.
function LayoutDado({ post, rotulo, data }: LayoutProps) {
  const ESMERALDA = "#10b981";
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: ESMERALDA,
        padding: "76px",
        fontFamily: "Inter",
        overflow: "hidden",
      }}
    >
      {/* Quadrado gigante girado 45°, centralizado no canto superior direito
          — a metade que sobra dentro do card vira uma divisão diagonal
          limpa cortando o card ao meio. */}
      <div
        style={{
          position: "absolute",
          top: -864,
          right: -864,
          width: 1728,
          height: 1728,
          backgroundColor: NAVY,
          transform: "rotate(45deg)",
          display: "flex",
        }}
      />

      <Pill texto={rotulo} bg="rgba(255,255,255,0.16)" corTexto="white" />

      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 20 }}>
        <div
          style={{
            display: "flex",
            color: "white",
            fontSize: post.numero_destaque && post.numero_destaque.length > 8 ? 140 : 210,
            fontFamily: "Archivo Black",
            lineHeight: 1,
          }}
        >
          {post.numero_destaque ?? "—"}
        </div>
        <div style={{ display: "flex", color: "white", fontSize: 36, fontFamily: "Inter", fontWeight: 800, lineHeight: 1.3, maxWidth: 760 }}>
          {post.titulo_card}
        </div>
      </div>

      <RodapeBase
        data={data}
        corNome="white"
        corCargo="rgba(255,255,255,0.65)"
        logo={LOGO_BRANCA}
        logoLargura={96}
        logoAltura={53}
      />
    </div>
  );
}

// 5. Autoridade pessoal — fundo claro e quente, composição centralizada tipo
// citação editorial (bem diferente da grade à esquerda dos outros).
function LayoutAutoridade({ post, rotulo, data }: LayoutProps) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        backgroundColor: "#f3ede3",
        padding: "76px",
        fontFamily: "Inter",
        overflow: "hidden",
      }}
    >
      <Pill texto={rotulo} bg={NAVY} corTexto="white" />

      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
          textAlign: "center",
        }}
      >
        <span style={{ display: "flex", color: CORAL, fontSize: 140, fontFamily: "Archivo Black", lineHeight: 0.4 }}>
          “
        </span>
        <div
          style={{
            display: "flex",
            color: NAVY,
            fontSize: 50,
            fontFamily: "Inter",
            fontWeight: 800,
            lineHeight: 1.25,
            letterSpacing: -1,
            textAlign: "center",
            maxWidth: 820,
          }}
        >
          {post.titulo_card}
        </div>
        <div style={{ width: 80, height: 6, borderRadius: 3, backgroundColor: CORAL, display: "flex" }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_COLORIDA} width={104} height={57} alt="" style={{ objectFit: "contain" }} />
        <span style={{ display: "flex", color: NAVY, fontSize: 24, fontFamily: "Inter", fontWeight: 700 }}>
          Matheus Lins
        </span>
        <span style={{ display: "flex", color: "rgba(0,33,58,0.6)", fontSize: 18, fontFamily: "Inter", fontWeight: 600 }}>
          Sócio-diretor · O2 Seguros · {data}
        </span>
      </div>
    </div>
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
  const data = fmtData(post.criado_em);

  const props = { post, rotulo, data };

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
