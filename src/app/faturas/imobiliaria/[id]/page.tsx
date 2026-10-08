import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// O cadastro da imobiliária é ÚNICO na plataforma (pedido do Matheus,
// 08/10/2026): faturas, repasse, campanhas e WhatsApp ficam todos em
// /admin/imobiliarias/[id], em sequência. Esta tela antiga do Faturas
// (que editava só e-mail de fatura e de repasse) virou um redirecionamento
// -- links e "voltar" antigos continuam funcionando.
export default async function ImobiliariaFaturasPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const { id } = await params;
  const { ok, erro } = await searchParams;
  const qs = new URLSearchParams();
  if (ok) qs.set("sucesso", ok);
  if (erro) qs.set("erro", erro);
  redirect(`/admin/imobiliarias/${id}${qs.size ? `?${qs}` : ""}`);
}
