"use server";

import { redirect } from "next/navigation";
import { registrarInteressado } from "@/lib/interessadosAcesso";

// Acesso só por convite (04/11/2026): /signup não cria conta, senha nem ficha. A pessoa deixa o contato, a O2 é avisada e o
// comercial atende, levanta os dados da imobiliária e só depois envia o convite (ver lib/interessadosAcesso.ts).
export async function solicitarAcesso(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const nome = String(formData.get("nome_imobiliaria") ?? "").trim();
  const responsavel = String(formData.get("responsavel") ?? "").trim();
  const telefone = String(formData.get("telefone") ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !nome || !responsavel) {
    redirect(`/signup?erro=${encodeURIComponent("Preencha o nome da imobiliária, o responsável e um e-mail válido.")}`);
  }
  await registrarInteressado({ email, origem: "signup", nome, responsavel, telefone });
  // Mesma resposta em qualquer caso (não revela se o e-mail já tem conta).
  redirect(`/login?aviso=${encodeURIComponent("Recebemos seu contato! Nossa equipe comercial vai falar com você e, depois de conhecer a imobiliária, envia o convite de acesso para o seu e-mail.")}`);
}
