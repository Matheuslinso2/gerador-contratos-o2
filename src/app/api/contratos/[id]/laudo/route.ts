import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { data: contrato, error } = await supabase
    .from("contratos")
    .select("laudo_arquivo_path, laudo_arquivo_nome, imobiliarias(user_id)")
    .eq("id", id)
    .single();

  if (error || !contrato) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }

  const imobiliaria = Array.isArray(contrato.imobiliarias) ? contrato.imobiliarias[0] : contrato.imobiliarias;
  if (imobiliaria.user_id !== user.id) {
    return NextResponse.json({ error: "Sem permissão para este contrato" }, { status: 403 });
  }

  if (!contrato.laudo_arquivo_path) {
    return NextResponse.json({ error: "Este contrato não tem laudo anexado." }, { status: 404 });
  }

  const { data: arquivo, error: downloadError } = await supabase.storage
    .from("laudos")
    .download(contrato.laudo_arquivo_path);

  if (downloadError || !arquivo) {
    return NextResponse.json({ error: "Não foi possível ler o arquivo do laudo." }, { status: 500 });
  }

  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const nome = contrato.laudo_arquivo_nome || "laudo-de-vistoria";

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": arquivo.type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${nome.replace(/"/g, "")}"`,
    },
  });
}
