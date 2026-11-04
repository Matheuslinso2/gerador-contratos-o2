-- Segurança 04/11/2026 (auditoria do banco com os verificadores do Supabase) — itens aplicados direto via MCP.
-- Este arquivo é o registro. Idempotente.

-- 1) 77 funções SECURITY INVOKER sem search_path fixo (aviso function_search_path_mutable): fixa o caminho de busca.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as fn
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.prokind in ('f','p')
      and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', r.fn);
  end loop;
end $$;

-- 2) Três visões que rodavam como administrador (security_definer_view, ERROR) passam a respeitar as regras de quem consulta.
alter view public.imobiliaria_email_evidencia_v set (security_invoker = true);
alter view public.erp_apolice_o2_prontidao_v set (security_invoker = true);
alter view public.erp_apolice_o2_prontidao_ramo_v set (security_invoker = true);
revoke all on public.imobiliaria_email_evidencia_v, public.erp_apolice_o2_prontidao_v, public.erp_apolice_o2_prontidao_ramo_v from anon;
revoke insert, update, delete, truncate, references, trigger on public.imobiliaria_email_evidencia_v, public.erp_apolice_o2_prontidao_v, public.erp_apolice_o2_prontidao_ramo_v from authenticated;

-- Pendente (decisão por função): 73 funções SECURITY DEFINER executáveis por qualquer usuário logado, inclusive as que gravam
-- (mesclar_imobiliarias, erp_aprovar_baixa_extrato, erp_autorizar_repasse, erp_importar_corp...). Ver lista no relatório de 04/11.
