-- Vários códigos do Corp por ficha (22/10/2026). Uma imobiliária pode ter
-- mais de um produtor no Corp (ex.: Dreher — 327 "MARCUS DREHER IMOVEIS/
-- KARLA" e 356 "KARLA CLARK ALMEIDA DREHER"). Cada produtor já é um registro
-- de fonte `corp_produtor` ligado à ficha; `imobiliarias.codigo_produtor_corp`
-- continua sendo só o código PRINCIPAL. Quem precisa de todos os códigos
-- (Campanhas, Repasses, quadro "Produtores no Corp") lê esta visão.

create or replace view imobiliaria_codigos_corp with (security_invoker = true) as
select i.id as imobiliaria_id, c.codigo, c.nome_corp, c.cpf_cnpj,
       c.codigo = nullif(btrim(i.codigo_produtor_corp), '') as principal
from imobiliarias i
join lateral (
  select r.chave_externa as codigo, r.nome_original as nome_corp, nullif(r.dados ->> 'cpf_cnpj', '') as cpf_cnpj
  from imobiliaria_registros_fonte r
  where r.fonte = 'corp_produtor' and r.situacao = 'confirmado' and r.imobiliaria_id = i.id
  union all
  -- código digitado à mão na ficha que ainda não virou registro de fonte
  select btrim(i.codigo_produtor_corp), null, null
  where nullif(btrim(i.codigo_produtor_corp), '') is not null
    and not exists (select 1 from imobiliaria_registros_fonte r2
                    where r2.fonte = 'corp_produtor' and r2.situacao = 'confirmado'
                      and r2.imobiliaria_id = i.id and r2.chave_externa = btrim(i.codigo_produtor_corp))
) c on true;

-- Produção de cada produtor do Corp das fichas pedidas, no período (mesma
-- regra do Power BI: linha incluída na base da corretora, por início de
-- vigência; documento = Nosso Nº + tipo + endosso, como o painel do Corp).
create or replace function produtores_corp_das_fichas(p_ids uuid[], p_de date, p_ate date)
returns table (imobiliaria_id uuid, ficha text, codigo text, nome_corp text, principal boolean,
               documentos bigint, premio numeric, comissao numeric, ultima_vigencia date)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user <> 'postgres' and not is_colaborador_o2() then
    raise exception 'sem permissão';
  end if;
  return query
  select c.imobiliaria_id, i.nome, c.codigo, coalesce(c.nome_corp, max(g.produtor)), c.principal,
         count(distinct (g.nosso_numero, g.tipo, g.numero_endosso)) filter (where g.id is not null),
         coalesce(sum(g.pr_liquido), 0), coalesce(sum(g.vl_com), 0), max(g.ini_vig)
  from imobiliaria_codigos_corp c
  join imobiliarias i on i.id = c.imobiliaria_id
  left join corp_grade g on g.codigo_produtor::text = c.codigo and g.incluir_corretora
                        and g.ini_vig between p_de and p_ate
  where c.imobiliaria_id = any(p_ids)
  group by c.imobiliaria_id, i.nome, c.codigo, c.nome_corp, c.principal
  order by i.nome, c.principal desc, c.codigo;
end $$;
revoke all on function produtores_corp_das_fichas(uuid[], date, date) from public, anon;
grant execute on function produtores_corp_das_fichas(uuid[], date, date) to authenticated, service_role;
