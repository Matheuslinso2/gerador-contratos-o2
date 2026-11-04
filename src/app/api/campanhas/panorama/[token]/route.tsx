import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";
import { createServiceClient } from "@/lib/supabase/service";
import { dataBr, formatarValor, type DadosPanorama } from "@/lib/campanhas/panoramaCampanha";

export const dynamic = "force-dynamic";

// Imagem do PANORAMA da campanha dentro do e-mail de parcial. Endereço secreto
// por versão (token): só mostra os números da própria imobiliária, exatamente
// como foram gravados em campanhas_panoramas. Identidade: Manual de Marca O2
// (navy #01192e, laranja #F8540D, Poppins).
//
// Regras (03/11/2026): produção = novas contratações no PERÍODO INDIVIDUAL;
// Meta 1 = 100% (o percentual pode passar de 100); oportunidades (cotações
// APROVADAS ainda não contratadas) aparecem à parte e nunca somam na produção;
// produção indisponível NUNCA aparece como zero; sem selo "Em risco".

// Caminhos por extenso de propósito: o tracer da Vercel precisa vê-los no build.
const LOGO_BRANCA = `data:image/png;base64,${fs.readFileSync(path.join(process.cwd(), "public", "marca-o2", "o2-logo-branco.png")).toString("base64")}`;
const POPPINS_REGULAR = fs.readFileSync(path.join(process.cwd(), "src", "lib", "social", "fonts", "Poppins-Regular.woff"));
const POPPINS_SEMIBOLD = fs.readFileSync(path.join(process.cwd(), "src", "lib", "social", "fonts", "Poppins-SemiBold.woff"));
const POPPINS_BOLD = fs.readFileSync(path.join(process.cwd(), "src", "lib", "social", "fonts", "Poppins-Bold.woff"));

const NAVY = "#01192e";
const AZUL = "#00447E";
const LARANJA = "#F8540D";
const CINZA_CLARO = "#d9d9d9";
const CINZA_MEDIO = "#8d8683";
const CINZA_ESCURO = "#444440";
const VERDE = "#1b8a4a";

const MAX_OPORTUNIDADES_NA_IMAGEM = 6;
const cortar = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

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
  // Parciais anteriores + a de agora, lado a lado.
  const pontos = [...d.historico.map((h) => ({ rotulo: dataBr(h.data).slice(0, 5), valor: h.realizado })), { rotulo: dataBr(d.posicaoEm).slice(0, 5), valor: d.realizado }].slice(-6);
  const teto = Math.max(d.meta ?? 0, ...pontos.map((p) => p.valor), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 18 }}>
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

function Oportunidades({ d }: { d: DadosPanorama }) {
  const lista = d.oportunidades.slice(0, MAX_OPORTUNIDADES_NA_IMAGEM);
  const resto = d.oportunidades.length - lista.length;
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 22, borderTop: `2px solid ${CINZA_CLARO}`, paddingTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", fontSize: 24, fontWeight: 700, color: AZUL }}>
          {d.oportunidades.length
            ? `Oportunidades: ${d.oportunidades.length} cotação(ões) aprovada(s) aguardando contratação`
            : "Oportunidades: nenhuma cotação aprovada aguardando contratação"}
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 16, color: CINZA_MEDIO, marginTop: 2 }}>
        {`Não entram na produção até virarem contratação · cotações recebidas desde ${dataBr(d.oportunidadesDesde)}`}
        {d.emAnalise > 0 ? ` · ${d.emAnalise} em análise` : ""}
      </div>
      {lista.map((o, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8, padding: "8px 16px", background: i % 2 === 0 ? "#f4f7fb" : "#ffffff", borderRadius: 10 }}>
          <div style={{ display: "flex", fontSize: 20, fontWeight: 600, color: NAVY, width: 470 }}>{cortar(o.pretendente ?? "Pretendente não identificado", 34)}</div>
          <div style={{ display: "flex", fontSize: 18, color: CINZA_ESCURO, width: 210 }}>{o.produto}</div>
          <div style={{ display: "flex", fontSize: 18, color: CINZA_ESCURO, width: 260 }}>{o.aprovadaEm ? `aprovada em ${dataBr(o.aprovadaEm).slice(0, 5)}` : "aprovação: data indisponível"}</div>
          <div style={{ display: "flex", fontSize: 18, fontWeight: 600, color: LARANJA, width: 120, justifyContent: "flex-end" }}>{o.diasAguardando !== null ? `${o.diasAguardando} dia(s)` : "—"}</div>
        </div>
      ))}
      {resto > 0 && <div style={{ display: "flex", fontSize: 17, color: CINZA_MEDIO, marginTop: 8 }}>{`+ ${resto} outra(s) cotação(ões) aprovada(s)`}</div>}
    </div>
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{16,64}$/.test(token)) return new Response("Não encontrado", { status: 404 });
  const db = createServiceClient();
  const { data } = await db.from("campanhas_panoramas").select("id, dados, status").eq("token", token).maybeSingle();
  if (!data || data.status === "descartada") return new Response("Não encontrado", { status: 404 });
  // Parcial lida (03/11/2026): a imagem carregou no e-mail da imobiliária. Só conta depois do envio real e
  // nunca para visualização interna (?interno=1). Proxy do Gmail marcado: abertura por proxy é sinal fraco.
  if (data.status === "enviada" && !new URL(request.url).searchParams.has("interno")) {
    const ua = request.headers.get("user-agent") ?? "";
    try {
      await db.from("campanhas_panoramas_eventos").insert({ panorama_id: data.id, tipo: "imagem", agente: /GoogleImageProxy/i.test(ua) ? "google_proxy" : "outro" });
    } catch {
      // registrar nunca impede a imagem
    }
  }
  const d = data.dados as DadosPanorama;

  const indisponivel = d.dadosStatus !== "ok";
  const pct = d.percentual === null ? null : Math.max(0, Math.round(d.percentual));
  const larguraBarra = Math.max(Math.min(pct ?? 0, 100), pct ? 2 : 0);
  const atingiu = d.meta !== null && d.meta > 0 && d.realizado >= d.meta;
  const superou = atingiu && d.meta !== null && d.realizado > d.meta;
  const u = d.moeda || !d.unidade ? "" : ` ${d.unidade}`;
  // Selo só para notícia boa: "Meta atingida/superada" ou "No ritmo". Nada de "Em risco".
  const selo = indisponivel ? null : atingiu ? { texto: superou ? "Meta superada" : "Meta atingida", cor: VERDE } : d.farol === "no_ritmo" ? { texto: "No ritmo", cor: VERDE } : null;

  const temEvolucao = d.historico.length > 0;
  const linhasOpp = Math.min(d.oportunidades.length, MAX_OPORTUNIDADES_NA_IMAGEM);
  const alturaOpp = 98 + (d.emAnalise > 0 ? 0 : 0) + linhasOpp * 52 + (d.oportunidades.length > linhasOpp ? 30 : 0);
  const altura = 640 + alturaOpp + (temEvolucao ? 200 : 0);

  const layout = (
    <div style={{ display: "flex", flexDirection: "column", width: 1200, height: altura, background: "#ffffff", fontFamily: "Poppins" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: NAVY, height: 118, padding: "0 48px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_BRANCA} width={116} height={64} alt="" />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#ffffff" }}>{d.campanha}</div>
          <div style={{ display: "flex", fontSize: 18, color: CINZA_CLARO }}>{`Campanha de ${dataBr(d.inicio)} a ${dataBr(d.fim)}${d.encerrada ? " (encerrada)" : ""}`}</div>
          <div style={{ display: "flex", fontSize: 18, color: CINZA_CLARO }}>{`Parcial nº ${d.versao} · produção apurada até ${dataBr(d.apuradoAte)}`}</div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", padding: "28px 48px 0", flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700, color: NAVY }}>{cortar(d.participante, 34)}</div>
          {selo && <div style={{ display: "flex", fontSize: 20, fontWeight: 600, color: "#ffffff", background: selo.cor, borderRadius: 30, padding: "6px 22px" }}>{selo.texto}</div>}
        </div>

        {indisponivel ? (
          <div style={{ display: "flex", flexDirection: "column", marginTop: 24, padding: "20px 24px", background: "#fff8e6", border: "2px solid #e0b100", borderRadius: 16 }}>
            <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: NAVY }}>Produção indisponível no momento</div>
            <div style={{ display: "flex", fontSize: 19, color: CINZA_ESCURO, marginTop: 6 }}>Estamos conferindo o vínculo dos seus dados. Nenhum número foi estimado.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", marginTop: 24 }}>
              <div style={{ display: "flex", flex: 1, height: 34, background: CINZA_CLARO, borderRadius: 17 }}>
                <div style={{ display: "flex", width: `${larguraBarra}%`, height: 34, background: LARANJA, borderRadius: 17 }} />
              </div>
              <div style={{ display: "flex", fontSize: 54, fontWeight: 700, color: LARANJA, marginLeft: 28 }}>{pct === null ? "—" : `${pct}%`}</div>
            </div>
            <div style={{ display: "flex", fontSize: 18, color: CINZA_MEDIO, marginTop: 4 }}>{`da Meta 1 da campanha${d.meta ? ` (${formatarValor(d.meta, d.moeda)}${u})` : " — meta ainda não definida"}`}</div>

            <div style={{ display: "flex", marginTop: 22 }}>
              <Bloco rotulo="Meta" valor={d.meta ? formatarValor(d.meta, d.moeda) : "—"} unidade={d.unidade} />
              <div style={{ display: "flex", width: 16 }} />
              <Bloco rotulo="Realizado (novas)" valor={formatarValor(d.realizado, d.moeda)} unidade={d.unidade} destaque />
              <div style={{ display: "flex", width: 16 }} />
              <Bloco rotulo="Faltam" valor={d.faltam === null ? "—" : formatarValor(d.faltam, d.moeda)} unidade={atingiu ? (superou ? "meta superada" : "meta atingida") : d.unidade} />
              <div style={{ display: "flex", width: 16 }} />
              <Bloco rotulo="Dias até o fim" valor={d.encerrada ? "Encerrada" : `${d.diasRestantes}`} unidade={d.encerrada ? `em ${dataBr(d.fim).slice(0, 5)}` : `até ${dataBr(d.fim).slice(0, 5)}`} />
            </div>
          </div>
        )}

        <Oportunidades d={d} />
        {temEvolucao && !indisponivel && <Evolucao d={d} />}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 48px", height: 74, background: "#fff4ee", borderTop: `2px solid ${CINZA_CLARO}` }}>
        <div style={{ display: "flex", fontSize: 18, color: NAVY, fontWeight: 600, maxWidth: 900 }}>
          {d.premiacao ? `Ao atingir a meta: ${cortar(d.premiacao, 150)}` : `Produção: novas contratações de Seguro Fiança e Capitalização (renovações não contam)`}
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
