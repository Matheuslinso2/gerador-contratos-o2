import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import { createServiceClient } from "@/lib/supabase/service";
import { ROTULO_FAROL } from "@/lib/campanhas/desempenho";
import { dataBr, formatarValor, type DadosPanorama } from "@/lib/campanhas/panoramaCampanha";

export const dynamic = "force-dynamic";

// Imagem do PANORAMA da campanha (30/10/2026) que vai dentro do e-mail de
// parcial. Endereço secreto por versão (token): só mostra os números da
// própria imobiliária, exatamente como foram gravados em campanhas_panoramas.
// Identidade: Manual de Marca O2 (navy #01192e, laranja #F8540D, Poppins).

// Caminhos por extenso de propósito: o tracer da Vercel precisa vê-los no build.
const LOGO_BRANCA = `data:image/png;base64,${fs.readFileSync(path.join(process.cwd(), "public", "marca-o2", "o2-logo-branco.png")).toString("base64")}`;
const POPPINS_REGULAR = fs.readFileSync(path.join(process.cwd(), "src", "lib", "social", "fonts", "Poppins-Regular.woff"));
const POPPINS_SEMIBOLD = fs.readFileSync(path.join(process.cwd(), "src", "lib", "social", "fonts", "Poppins-SemiBold.woff"));
const POPPINS_BOLD = fs.readFileSync(path.join(process.cwd(), "src", "lib", "social", "fonts", "Poppins-Bold.woff"));

const NAVY = "#01192e";
const LARANJA = "#F8540D";
const CINZA_CLARO = "#d9d9d9";
const CINZA_MEDIO = "#8d8683";
const CINZA_ESCURO = "#444440";

const COR_FAROL: Record<string, string> = { atingida: "#1b8a4a", no_ritmo: "#1b8a4a", atencao: "#c98a00", em_risco: "#AF2505", nao_atingida: "#AF2505" };

function Bloco({ rotulo, valor, unidade, destaque }: { rotulo: string; valor: string; unidade?: string; destaque?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, border: `2px solid ${CINZA_CLARO}`, borderRadius: 18, padding: "16px 20px", background: destaque ? "#fff4ee" : "#ffffff" }}>
      <div style={{ display: "flex", fontSize: 18, color: CINZA_MEDIO, fontWeight: 600 }}>{rotulo}</div>
      <div style={{ display: "flex", fontSize: valor.length > 9 ? 32 : 44, fontWeight: 700, color: destaque ? LARANJA : NAVY, marginTop: 2 }}>{valor}</div>
      <div style={{ display: "flex", fontSize: 17, color: CINZA_MEDIO, height: 24 }}>{unidade ?? ""}</div>
    </div>
  );
}

function Evolucao({ d }: { d: DadosPanorama }) {
  // Parciais anteriores + a de agora, lado a lado, como % da meta (ou valor, sem meta).
  const pontos = [...d.historico.map((h) => ({ rotulo: dataBr(h.data).slice(0, 5), valor: h.realizado })), { rotulo: dataBr(d.posicaoEm).slice(0, 5), valor: d.realizado }].slice(-6);
  const teto = Math.max(d.meta ?? 0, ...pontos.map((p) => p.valor), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 4 }}>
      <div style={{ display: "flex", fontSize: 20, fontWeight: 600, color: CINZA_ESCURO }}>Evolução das parciais</div>
      <div style={{ display: "flex", alignItems: "flex-end", height: 150, marginTop: 8 }}>
        {pontos.map((p, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", marginRight: 26, height: 150 }}>
            <div style={{ display: "flex", fontSize: 16, fontWeight: 600, color: NAVY }}>{formatarValor(p.valor, d.moeda)}</div>
            <div style={{ display: "flex", width: 90, height: Math.max(8, Math.round((p.valor / teto) * 96)), background: i === pontos.length - 1 ? LARANJA : CINZA_CLARO, borderRadius: 8, marginTop: 3 }} />
            <div style={{ display: "flex", fontSize: 14, color: CINZA_MEDIO, marginTop: 3 }}>{p.rotulo}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{16,64}$/.test(token)) return new Response("Não encontrado", { status: 404 });
  const { data } = await createServiceClient().from("campanhas_panoramas").select("dados, status").eq("token", token).maybeSingle();
  if (!data || data.status === "descartada") return new Response("Não encontrado", { status: 404 });
  const d = data.dados as DadosPanorama;

  const pct = d.percentual === null ? null : Math.max(0, Math.round(d.percentual));
  const larguraBarra = Math.max(Math.min(pct ?? 0, 100), pct ? 2 : 0);
  const atingiu = d.meta !== null && d.meta > 0 && d.realizado >= d.meta;
  const u = d.moeda || !d.unidade ? "" : ` ${d.unidade}`;
  const temEvolucao = d.historico.length > 0;
  const altura = temEvolucao ? 860 : 690;

  const layout = (
    <div style={{ display: "flex", flexDirection: "column", width: 1200, height: altura, background: "#ffffff", fontFamily: "Poppins" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: NAVY, height: 118, padding: "0 48px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_BRANCA} width={116} height={64} alt="" />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#ffffff" }}>{d.campanha}</div>
          <div style={{ display: "flex", fontSize: 19, color: CINZA_CLARO }}>{`Parcial nº ${d.versao} · posição em ${dataBr(d.posicaoEm)}`}</div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", padding: "30px 48px 0", flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: NAVY }}>{d.participante.length > 34 ? d.participante.slice(0, 33) + "…" : d.participante}</div>
          <div style={{ display: "flex", fontSize: 20, fontWeight: 600, color: "#ffffff", background: COR_FAROL[d.farol] ?? CINZA_MEDIO, borderRadius: 30, padding: "6px 22px" }}>{ROTULO_FAROL[d.farol]}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", marginTop: 26 }}>
          <div style={{ display: "flex", flex: 1, height: 34, background: CINZA_CLARO, borderRadius: 17 }}>
            <div style={{ display: "flex", width: `${larguraBarra}%`, height: 34, background: LARANJA, borderRadius: 17 }} />
          </div>
          <div style={{ display: "flex", fontSize: 54, fontWeight: 700, color: LARANJA, marginLeft: 28 }}>{pct === null ? "—" : `${pct}%`}</div>
        </div>
        <div style={{ display: "flex", fontSize: 18, color: CINZA_MEDIO, marginTop: 4 }}>{`da meta da campanha${d.meta ? ` (${formatarValor(d.meta, d.moeda)}${u})` : " — meta ainda não definida"}`}</div>

        <div style={{ display: "flex", marginTop: 26 }}>
          <Bloco rotulo="Meta" valor={d.meta ? formatarValor(d.meta, d.moeda) : "—"} unidade={d.unidade} />
          <div style={{ display: "flex", width: 16 }} />
          <Bloco rotulo="Realizado" valor={formatarValor(d.realizado, d.moeda)} unidade={d.unidade} destaque />
          <div style={{ display: "flex", width: 16 }} />
          <Bloco rotulo={atingiu ? "Situação" : "Faltam"} valor={atingiu ? "Atingida" : d.faltam !== null ? formatarValor(d.faltam, d.moeda) : "—"} unidade={atingiu ? "parabéns pela parceria" : d.unidade} />
          <div style={{ display: "flex", width: 16 }} />
          <Bloco rotulo="Dias até o fim" valor={d.diasRestantes > 0 ? `${d.diasRestantes}` : "Encerrada"} unidade={d.diasRestantes > 0 ? `até ${dataBr(d.fim).slice(0, 5)}` : ""} />
        </div>

        {d.emAndamento > 0 && <div style={{ display: "flex", fontSize: 20, color: CINZA_ESCURO, marginTop: 18 }}>{`${d.emAndamento} cotação(ões) em andamento — nossa equipe ajuda a fechar.`}</div>}
        {temEvolucao && <Evolucao d={d} />}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 48px", height: 74, background: "#fff4ee", borderTop: `2px solid ${CINZA_CLARO}` }}>
        <div style={{ display: "flex", fontSize: 18, color: NAVY, fontWeight: 600, maxWidth: 900 }}>
          {d.premiacao ? `Ao atingir a meta: ${d.premiacao.length > 90 ? d.premiacao.slice(0, 89) + "…" : d.premiacao}` : `Campanha até ${dataBr(d.fim)}`}
        </div>
        <div style={{ display: "flex", fontSize: 18, color: LARANJA, fontWeight: 700 }}>#SomosTodosO2</div>
      </div>
    </div>
  );

  try {
    const resposta = new ImageResponse(layout, {
      width: 1200,
      height: altura,
      fonts: [
        { name: "Poppins", data: POPPINS_REGULAR, weight: 400, style: "normal" },
        { name: "Poppins", data: POPPINS_SEMIBOLD, weight: 600, style: "normal" },
        { name: "Poppins", data: POPPINS_BOLD, weight: 700, style: "normal" },
      ],
    });
    // A versão nunca muda depois de gravada: pode ficar em cache por muito tempo.
    resposta.headers.set("cache-control", "public, max-age=31536000, immutable");
    return resposta;
  } catch (erro) {
    console.error("Falha ao gerar a imagem do panorama", token, erro);
    return new Response("Erro ao gerar a imagem", { status: 500 });
  }
}
