-- Revisão de segurança 30/10/2026 — fase C (impedir que volte)
-- (docs/PLANO-SEGURANCA-PROXIMOS-PASSOS-2026-10-30.md)
--
-- 1) O Supabase dá EXECUTE para anon/authenticated em toda função nova criada
--    pelo postgres (privilégio padrão) -- foi assim que 33 funções do ERP
--    ficaram abertas para visitante. A partir daqui, função nova nasce
--    fechada para visitante; a que precisar ser pública recebe
--    "grant execute ... to anon" explícito. authenticated e service_role
--    continuam recebendo por padrão (telas logadas e crons não mudam).
--    Nenhuma tela chama RPC como visitante hoje (conferido: todos os .rpc(
--    do código usam sessão logada ou service_role).
--    O EXECUTE para PUBLIC é embutido no Postgres e só sai na regra global
--    (sem "in schema") -- testado: com só a regra do schema, função nova
--    continuava aberta para anon.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- 2) Única função liberada para logado que não conferia quem chama e mostra
--    dado interno (contagem de alertas de fatura): agora só para a equipe.
create or replace function public.erp_contar_alertas_fatura()
 returns table(alerta text, n bigint)
 language sql
 security definer
 set search_path to 'public'
as $function$
  select alerta, count(*) from erp_alertas_fatura_pronto where (select is_colaborador_o2()) group by 1;
$function$;
