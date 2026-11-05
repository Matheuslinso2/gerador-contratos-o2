import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { enviarEmail } from "@/lib/email";
import { EMAIL_COMERCIAL_O2 } from "@/lib/integracoes/emailO2";
import { criarCardSeguroIncendio, montarEmailSeguroIncendio, type CoberturaSelecionada, type SeguroIncendioPayload } from "@/lib/integracoes/seguroIncendio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Campanha Black O2 (04/11/2026): a página o2seguros.com.br/black-o2 (WordPress/Elementor) cota Seguro Incêndio para PROPRIETÁRIOS
// e fiadores indicados por imobiliárias. Cada envio vira (1) um card na SPA Ramos Elementares (mesmo fluxo da ficha /seguro-incendio),
// com a Fonte do card = a campanha, e (2) uma linha em /leads-site. Configuração no WordPress: ação "Webhook" do formulário apontando
// para /api/integracoes/wordpress-black-o2?secret=<token> (o mesmo token do wordpress-leads).
const CAMPANHA = { nome: "Black O2", url: "https://o2seguros.com.br/black-o2/", detalhe: "Seguro Incêndio com 20% OFF (página black-o2)" };
const EMAIL_DESTINO_INCENDIO = "incendio@o2seguros.com.br";

// Confere a senha da URL. Falha momentânea do banco NÃO pode virar "senha errada" (achado 05/11/2026: um envio de teste levou 401 e o lead se
// perdeu, porque o AFI não repete o envio): tenta 3 vezes e, se o banco continuar fora, lança erro (resposta 503, não 401).
async function autorizado(request: NextRequest): Promise<boolean> {
  const secret = request.nextUrl.searchParams.get("secret");
  if (!secret) return false;
  let ultimoErro: unknown = null;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const { data, error } = await createServiceClient().from("wordpress_leads_tokens").select("id").eq("token", secret).maybeSingle();
    if (!error) return Boolean(data);
    ultimoErro = error;
    await new Promise((r) => setTimeout(r, 800 * (tentativa + 1)));
  }
  throw new Error(`banco indisponível ao conferir a senha: ${(ultimoErro as { message?: string })?.message ?? "erro"}`);
}

// Elementor/Advanced Form Integration manda os campos soltos na raiz, ou dentro de "fields"/"form_fields" (cada um como texto ou como
// objeto { value }). Aceita todas as formas.
function achatar(payload: unknown): Record<string, string> {
  const bruto = (payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}) as Record<string, unknown>;
  const aninhado = bruto.fields ?? bruto.form_fields ?? bruto.data;
  const origem = aninhado && typeof aninhado === "object" ? (aninhado as Record<string, unknown>) : bruto;
  const saida: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(origem)) {
    const v = valor && typeof valor === "object" ? (valor as { value?: unknown }).value : valor;
    if (typeof v === "string") saida[chave.replace(/^form_fields\[|\]$/g, "")] = v.trim();
    else if (typeof v === "number") saida[chave] = String(v);
    else if (Array.isArray(v)) saida[chave] = v.join(", ");
  }
  return saida;
}

const so = (v: string) => v.replace(/\D/g, "");
const valorBr = (v: string) => v.replace(/^R\$\s*/i, "").trim();

// Bairro/cidade/UF pelo CEP (o formulário só pede CEP + rua); falha em silêncio.
async function viaCep(cep: string): Promise<{ bairro: string; cidade: string; uf: string }> {
  try {
    const r = await fetch(`https://viacep.com.br/ws/${so(cep)}/json/`, { signal: AbortSignal.timeout(5000) });
    const j = (await r.json()) as { erro?: boolean; bairro?: string; localidade?: string; uf?: string };
    if (j.erro) return { bairro: "", cidade: "", uf: "" };
    return { bairro: j.bairro ?? "", cidade: j.localidade ?? "", uf: j.uf ?? "" };
  } catch {
    return { bairro: "", cidade: "", uf: "" };
  }
}

// Perfil vindo do formulário ("Proprietário" / "Fiador" ...): aceita o texto como a página enviar e padroniza; vazio = não informado.
function normalizarPerfil(v: string): string {
  const t = v.trim().toLowerCase();
  if (t.startsWith("fiador")) return "Fiador com imóvel próprio";
  if (t.startsWith("propriet")) return "Proprietário";
  return "Proprietário ou fiador (perfil não informado)";
}

const COBERTURAS: { chave: string; label: string; int: string; valor?: string }[] = [
  { chave: "incendio", label: "Incêndio, raio e explosão", int: "int_incendio", valor: "valor_incendio" },
  { chave: "danosEletricos", label: "Danos elétricos", int: "int_eletricos", valor: "valor_eletricos" },
  { chave: "rouboFurto", label: "Roubo e furto de bens", int: "int_roubo", valor: "valor_roubo" },
  { chave: "vendavalFumaca", label: "Vendaval e fumaça", int: "int_vendaval", valor: "valor_vendaval" },
  { chave: "responsabilidadeCivil", label: "Responsabilidade civil", int: "int_rc", valor: "valor_rc" },
  { chave: "perdaAluguel", label: "Perda/pagamento de aluguel", int: "int_aluguel", valor: "valor_aluguel" },
  { chave: "assistencia24h", label: "Assistência 24h", int: "int_assistencia" },
];

export async function POST(request: NextRequest) {
  // Responde sempre 200 ao WordPress (não atrapalha quem preenche); o que falhar fica no log e no lead salvo.
  try {
    let liberado = false;
    try {
      liberado = await autorizado(request);
    } catch (e) {
      console.error("[black-o2]", e);
      return NextResponse.json({ ok: false, erro: "serviço indisponível, tente de novo" }, { status: 503 });
    }
    if (!liberado) return NextResponse.json({ ok: false, erro: "não autorizado" }, { status: 401 });
    const teste = request.nextUrl.searchParams.get("teste") === "1";
    const bruto = await request.json().catch(() => ({}));
    const c = achatar(bruto);
    const get = (k: string) => c[k] ?? "";

    const nome = get("nome");
    const email = get("email").toLowerCase();
    const telefone = get("telefone");
    const cpf = get("cpf");
    const cep = get("cep");
    const sb = createServiceClient();

    // 1) Sempre guarda o lead (aparece em /leads-site), mesmo que o card falhe.
    const { data: lead } = await sb
      .from("leads_site_o2seguros")
      .insert({
        formulario: "black_o2_seguro_incendio",
        pagina_url: CAMPANHA.url,
        nome: nome || null,
        email: email || null,
        telefone: telefone || null,
        utm_source: get("utm_source") || null,
        utm_medium: get("utm_medium") || null,
        utm_campaign: get("utm_campaign") || "black_o2",
        campos: bruto,
      })
      .select("id")
      .single();

    if (!nome || !(email || telefone)) {
      console.warn("[black-o2] envio sem nome e contato: lead salvo, sem card");
      return NextResponse.json({ ok: true, card: null, motivo: "sem nome/contato" });
    }

    const endereco = await viaCep(cep);
    const coberturas: CoberturaSelecionada[] = COBERTURAS.filter((x) => get(x.int) || (x.valor && get(x.valor))).map((x) => ({
      chave: x.chave,
      label: x.label,
      valor: x.valor ? valorBr(get(x.valor)) : "",
    }));
    const imobiliaria = get("imobiliaria");
    // Mesmo envio repetido (mesma pessoa/imóvel) não duplica o card: a chave é o hash dos dados do imóvel + CPF.
    const chave = crypto.createHash("sha1").update([so(cpf), so(cep), get("numero").toLowerCase(), get("complemento").toLowerCase()].join("|")).digest("hex").slice(0, 12);

    const payload: SeguroIncendioPayload = {
      responseId: `${teste ? "TESTE-" : ""}BLACKO2-${chave}`,
      modalidade: "Residencial",
      coberturas,
      email,
      solicitante: normalizarPerfil(get("perfil") || get("perfil_escolhido") || get("perfil_texto")),
      finsLocacao: "Não informado",
      nomeProprietario: teste ? `[TESTE - apagar] ${nome}` : nome,
      cpfProprietario: cpf,
      atividadeComercial: "",
      imovelCep: cep,
      imovelLogradouro: get("endereco").split(",")[0].trim(),
      imovelNumero: get("numero"),
      imovelComplemento: get("complemento"),
      imovelBairro: endereco.bairro,
      imovelCidade: endereco.cidade,
      imovelUf: endereco.uf,
      metragem: get("metragem"),
      valorAluguel: "",
      administradoPorImobiliaria: imobiliaria ? "Sim" : "Não",
      nomeImobiliaria: imobiliaria,
      preferencias: "Campanha Black O2: 20% OFF no Seguro Incêndio",
      telefone,
      qtdEnderecos: "",
      anexoPlanilha: "",
      anexoPlanilhaNome: "",
      campanha: CAMPANHA,
    };

    const resultado = await criarCardSeguroIncendio(payload, sb);
    if (lead?.id) await sb.from("leads_site_o2seguros").update({ observacoes: `Card Bitrix #${resultado.item.id} (Ramos Elementares)` }).eq("id", lead.id);

    // 2) Aviso por e-mail (mesmo padrão da ficha /seguro-incendio); no teste não avisa ninguém.
    if (resultado.created && !teste) {
      try {
        const { assunto, html } = montarEmailSeguroIncendio(payload, resultado);
        await enviarEmail({ para: EMAIL_DESTINO_INCENDIO, cc: [EMAIL_COMERCIAL_O2], assunto, html, remetente: "Plataforma O2 — Black O2" });
      } catch (e) {
        console.warn("[black-o2] falha no e-mail de aviso:", e);
      }
    }
    return NextResponse.json({ ok: true, card: resultado.item.id, criado: resultado.created });
  } catch (error) {
    console.error("[black-o2] erro inesperado:", error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
