import { createClient } from "@/lib/supabase/server";
import { chatVisivelPara } from "@/lib/chat/acesso";
import ChatFlutuante from "./ChatFlutuante";

// Decide no servidor se o balão do chat aparece (ver lib/chat/acesso.ts). Fica dentro de <Suspense> no layout
// raiz para não atrasar o carregamento das telas.
export default async function ChatGate() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email || !chatVisivelPara(user.email)) return null;
  return <ChatFlutuante meuEmail={user.email.toLowerCase()} />;
}
