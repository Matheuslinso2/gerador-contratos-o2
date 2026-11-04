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

-- 3) FALHA ACHADA (04/11/2026): 15 funções SECURITY DEFINER protegiam a execução com "current_user <> 'postgres'". Dentro de uma
-- função SECURITY DEFINER o current_user é SEMPRE o dono (postgres), então a guarda nunca barrava ninguém: um usuário logado qualquer
-- (inclusive conta de imobiliária parceira) executava erp_importar_corp, erp_previsao_*, corp_*, erp_retrato, mesclar_imobiliarias_previa
-- etc. (testado com perfil externo, em transação com rollback). Correção aplicada: a guarda agora olha auth.role():
--   A) "... and auth.role() is not null and not is_colaborador_o2()"  (service_role passa pela 1ª condição; chamada de banco sem JWT, como
--      pg_cron/SQL editor, tem auth.role() nulo e passa);
--   B) erp_retrato: (auth.role() is null or auth.role() = 'service_role');  C) mesclar_imobiliarias_previa: auth.role() is null.
-- Funções reescritas: corp_atualizar_retratos, corp_conferir_documentos_fora, corp_gerar_telas_prontas, corp_marcar_deduplicacao,
-- corp_painel_inconsistencias, erp_baixa_erp_processar_base, erp_importar_corp, erp_importar_corp_selecionados, erp_previsao_ajustar,
-- erp_previsao_receita_aplicar, erp_previsao_receita_gerar, erp_previsao_receita_regra_gerar, erp_retrato, mesclar_imobiliarias_previa,
-- produtores_corp_das_fichas. REGRA: nunca usar current_user/session_user como guarda dentro de função SECURITY DEFINER.

-- 4) Dez funções de gravação sem nenhuma guarda, chamadas só por crons/scripts com service_role: execução fechada para usuários.
revoke execute on function
  public.erp_cotacao_planilha_chave_atualizar(), public.erp_cotacao_planilha_heranca(), public.erp_cotacao_seguradora_exata_atualizar(),
  public.erp_negocio_garantir(), public.erp_nibo_repasse_conferir(), public.erp_planilha_documento_vincular(),
  public.erp_planilha_registro_atualizar(integer), public.erp_planilha_registro_classificar_imovel(integer),
  public.erp_tratativas_vincular(), public.erp_verificacao_calcular(text, text, integer, text)
from public, anon, authenticated;
grant execute on function
  public.erp_cotacao_planilha_chave_atualizar(), public.erp_cotacao_planilha_heranca(), public.erp_cotacao_seguradora_exata_atualizar(),
  public.erp_negocio_garantir(), public.erp_nibo_repasse_conferir(), public.erp_planilha_documento_vincular(),
  public.erp_planilha_registro_atualizar(integer), public.erp_planilha_registro_classificar_imovel(integer),
  public.erp_tratativas_vincular(), public.erp_verificacao_calcular(text, text, integer, text)
to service_role;
