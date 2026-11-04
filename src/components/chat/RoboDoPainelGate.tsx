import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { chatVisivelPara } from "@/lib/chat/acesso";
import { roboLiberadoPara } from "@/lib/chat/niveisAcesso";
import RoboDoPainel from "./RoboDoPainel";

// Mesmo critério da rota /api/chat/robo: só aparece para quem pode usar o Robô O2 (e-mail @o2seguros.com.br com o chat liberado).
// Fica dentro de <Suspense> para não atrasar o carregamento do painel.
async function Conteudo({ painelId, competencia }: { painelId: string; competencia: string }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !chatVisivelPara(user.email) || !roboLiberadoPara(user.email)) return null;
  return <RoboDoPainel painelId={painelId} competencia={competencia} />;
}

export default function RoboDoPainelGate(props: { painelId: string; competencia: string }) {
  return (
    <Suspense fallback={null}>
      <Conteudo {...props} />
    </Suspense>
  );
}
