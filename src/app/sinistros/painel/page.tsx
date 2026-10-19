import { redirect } from "next/navigation";

// O painel de KPIs separado deixou de existir (planejamento v2): os KPIs são a
// tela de entrada do módulo. Endereço antigo mantido só para links salvos.
export default function PainelSinistrosAntigo() {
  redirect("/sinistros");
}
