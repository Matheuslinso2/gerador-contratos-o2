-- Mesclar duas fichas de imobiliária (22/10/2026). Substitui a versão antiga,
-- de antes da base única, que só movia contratos/auditorias/faturas/membros:
-- com ela, apagar a ficha soltava os vínculos da base única (registros de
-- fonte ficavam sem ficha), apagava metas de campanha (cascade) e dava erro
-- quando a ficha tinha campanha, repasse ou sinistro.
--
-- Regra: TUDO que aponta para a ficha removida passa para a mantida; campos
-- vazios da mantida são completados com os da removida; listas de e-mail são
-- somadas; a ficha removida fica guardada inteira no histórico. Fichas em
-- grupos diferentes = recusa. Códigos do Corp diferentes são aceitos
-- (22/10/2026, ver schema_codigos_corp_ficha.sql): a ficha passa a ter os dois
-- produtores; o principal continua o da ficha mantida.
--
-- mesclar_imobiliarias_previa(manter, remover): só lê; mostra o que mudaria.

create or replace function mesclar_imobiliarias_previa(p_manter_id uuid, p_remover_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m imobiliarias%rowtype;
  r imobiliarias%rowtype;
  v jsonb := '{}'::jsonb;
  v_conflitos jsonb := '[]'::jsonb;
  v_avisos jsonb := '[]'::jsonb;
begin
  if not (is_admin_o2() or is_equipe_o2() or current_user = 'postgres' or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'não autorizado';
  end if;
  select * into m from imobiliarias where id = p_manter_id;
  select * into r from imobiliarias where id = p_remover_id;
  if m.id is null or r.id is null then raise exception 'ficha não encontrada'; end if;
  if m.id = r.id then raise exception 'não é possível mesclar uma ficha com ela mesma'; end if;

  if nullif(btrim(m.codigo_produtor_corp), '') is not null and nullif(btrim(r.codigo_produtor_corp), '') is not null
     and btrim(m.codigo_produtor_corp) <> btrim(r.codigo_produtor_corp) then
    v_avisos := v_avisos || to_jsonb(format('a ficha fica com 2 produtores do Corp: %s (principal) e %s', btrim(m.codigo_produtor_corp), btrim(r.codigo_produtor_corp)));
  end if;
  if m.grupo_id is not null and r.grupo_id is not null and m.grupo_id <> r.grupo_id then
    v_conflitos := v_conflitos || to_jsonb('as fichas estão em grupos diferentes'::text);
  end if;

  v := jsonb_build_object(
    'manter', m.nome, 'remover', r.nome,
    'codigo_corp_final', coalesce(nullif(btrim(m.codigo_produtor_corp), ''), nullif(btrim(r.codigo_produtor_corp), '')),
    'mover', jsonb_build_object(
      'registros_fonte', (select count(*) from imobiliaria_registros_fonte where imobiliaria_id = r.id),
      'historico', (select count(*) from imobiliaria_historico where imobiliaria_id = r.id),
      'membros', (select count(*) from imobiliaria_membros where imobiliaria_id = r.id),
      'contatos', (select count(*) from imobiliaria_contatos where imobiliaria_id = r.id),
      'whatsapp_contatos', (select count(*) from whatsapp_contatos where imobiliaria_id = r.id),
      'contratos', (select count(*) from contratos where imobiliaria_id = r.id),
      'auditorias', (select count(*) from auditorias_contrato where imobiliaria_id = r.id),
      'faturas', (select count(*) from faturas where imobiliaria_id = r.id),
      'faturas_envios', (select count(*) from faturas_envios where imobiliaria_id = r.id),
      'faturas_esperadas', (select count(*) from faturas_esperadas where imobiliaria_id = r.id),
      'repasses', (select count(*) from repasses where imobiliaria_id = r.id),
      'repasses_envios', (select count(*) from repasses_envios where imobiliaria_id = r.id),
      'sinistros', (select count(*) from sinistros where imobiliaria_id = r.id),
      'campanhas_envios', (select count(*) from campanhas_envios where imobiliaria_id = r.id),
      'campanhas_descadastros', (select count(*) from campanhas_descadastros where imobiliaria_id = r.id),
      'campanhas_metas', (select count(*) from campanhas_metas where imobiliaria_id = r.id),
      'campanhas_producao', (select count(*) from campanhas_producao where imobiliaria_id = r.id),
      'campanhas_selecionadas', (select count(*) from campanhas where r.id = any(imobiliarias_selecionadas)),
      'campanhas_grupos', (select count(*) from campanhas_grupos where r.id = any(imobiliaria_ids))
    ),
    'metas_que_ficam_com_a_mantida', (select count(*) from campanhas_metas a join campanhas_metas b on b.campanha_id = a.campanha_id
                                       where a.imobiliaria_id = r.id and b.imobiliaria_id = m.id),
    'avisos', v_avisos,
    'conflitos', v_conflitos);
  return v;
end $$;

-- A versão antiga devolvia void; trocar o tipo de retorno exige recriar.
drop function if exists mesclar_imobiliarias(uuid, uuid);
create function mesclar_imobiliarias(p_manter_id uuid, p_remover_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m imobiliarias%rowtype;
  r imobiliarias%rowtype;
  v_previa jsonb;
  v_quem text := coalesce(auth.jwt() ->> 'email', current_user);
begin
  v_previa := mesclar_imobiliarias_previa(p_manter_id, p_remover_id);
  if jsonb_array_length(v_previa -> 'conflitos') > 0 then
    raise exception 'mesclagem recusada: %', v_previa -> 'conflitos';
  end if;
  select * into m from imobiliarias where id = p_manter_id for update;
  select * into r from imobiliarias where id = p_remover_id for update;

  -- Login da ficha removida vira membro da mantida (regra antiga, mantida).
  if r.user_id is not null and r.email is not null
     and not exists (select 1 from imobiliarias where id = m.id and user_id = r.user_id)
     and not exists (select 1 from imobiliaria_membros where imobiliaria_id = m.id and email = r.email) then
    insert into imobiliaria_membros (imobiliaria_id, email) values (m.id, r.email);
  end if;
  update imobiliaria_membros x set imobiliaria_id = m.id where x.imobiliaria_id = r.id
    and not exists (select 1 from imobiliaria_membros y where y.imobiliaria_id = m.id and y.email = x.email);
  delete from imobiliaria_membros where imobiliaria_id = r.id;

  -- Base única: vínculos de fonte e histórico.
  update imobiliaria_registros_fonte set imobiliaria_id = m.id, updated_at = now() where imobiliaria_id = r.id;
  update imobiliaria_registros_fonte set sugestoes = (
      select coalesce(jsonb_agg(distinct case when s ->> 'imobiliaria_id' = r.id::text then jsonb_set(s, '{imobiliaria_id}', to_jsonb(m.id::text)) else s end), '[]'::jsonb)
      from jsonb_array_elements(sugestoes) s)
    where sugestoes @> jsonb_build_array(jsonb_build_object('imobiliaria_id', r.id::text));
  update imobiliaria_historico set imobiliaria_id = m.id where imobiliaria_id = r.id;

  -- Cadastro operacional.
  update imobiliaria_contatos set imobiliaria_id = m.id where imobiliaria_id = r.id;
  update whatsapp_contatos set imobiliaria_id = m.id where imobiliaria_id = r.id;
  update contratos set imobiliaria_id = m.id where imobiliaria_id = r.id;
  update auditorias_contrato set imobiliaria_id = m.id where imobiliaria_id = r.id;
  update faturas set imobiliaria_id = m.id where imobiliaria_id = r.id;
  update faturas_envios set imobiliaria_id = m.id where imobiliaria_id = r.id;
  update faturas_esperadas x set imobiliaria_id = m.id where x.imobiliaria_id = r.id
    and not exists (select 1 from faturas_esperadas y where y.imobiliaria_id = m.id and y.seguradora = x.seguradora
                    and y.cnpj_o2 is not distinct from x.cnpj_o2 and y.codigo_produtor is not distinct from x.codigo_produtor);
  delete from faturas_esperadas where imobiliaria_id = r.id;
  update repasses set imobiliaria_id = m.id where imobiliaria_id = r.id;
  update repasses_envios set imobiliaria_id = m.id where imobiliaria_id = r.id;
  update sinistros set imobiliaria_id = m.id where imobiliaria_id = r.id;

  -- Campanhas (meta/produção repetida na mesma campanha: fica a da mantida).
  update campanhas_envios set imobiliaria_id = m.id where imobiliaria_id = r.id;
  update campanhas_descadastros set imobiliaria_id = m.id where imobiliaria_id = r.id;
  update campanhas_metas x set imobiliaria_id = m.id where x.imobiliaria_id = r.id
    and not exists (select 1 from campanhas_metas y where y.campanha_id = x.campanha_id and y.imobiliaria_id = m.id);
  delete from campanhas_metas where imobiliaria_id = r.id;
  update campanhas_producao x set imobiliaria_id = m.id where x.imobiliaria_id = r.id
    and not exists (select 1 from campanhas_producao y where y.campanha_id = x.campanha_id and y.imobiliaria_id = m.id);
  delete from campanhas_producao where imobiliaria_id = r.id;
  update campanhas set imobiliarias_selecionadas = (select array_agg(distinct case when u = r.id then m.id else u end) from unnest(imobiliarias_selecionadas) u)
    where r.id = any(imobiliarias_selecionadas);
  update campanhas_grupos set imobiliaria_ids = (select array_agg(distinct case when u = r.id then m.id else u end) from unnest(imobiliaria_ids) u)
    where r.id = any(imobiliaria_ids);

  -- Completa a ficha mantida com o que só a removida tinha.
  update imobiliarias set
    codigo_produtor_corp = coalesce(nullif(btrim(m.codigo_produtor_corp), ''), nullif(btrim(r.codigo_produtor_corp), '')),
    grupo_id = coalesce(m.grupo_id, r.grupo_id),
    creci = coalesce(nullif(m.creci, ''), r.creci),
    endereco = coalesce(nullif(m.endereco, ''), r.endereco),
    bairro = coalesce(nullif(m.bairro, ''), r.bairro),
    cidade = coalesce(nullif(m.cidade, ''), r.cidade),
    uf = coalesce(nullif(m.uf, ''), r.uf),
    telefone = coalesce(nullif(m.telefone, ''), r.telefone),
    email = coalesce(nullif(m.email, ''), r.email),
    responsavel = coalesce(nullif(m.responsavel, ''), r.responsavel),
    origem_comercial = coalesce(nullif(m.origem_comercial, ''), r.origem_comercial),
    email_faturas = (select array_agg(distinct e) from unnest(coalesce(m.email_faturas, '{}') || coalesce(r.email_faturas, '{}')) e where e <> ''),
    email_repasses = (select array_agg(distinct e) from unnest(coalesce(m.email_repasses, '{}') || coalesce(r.email_repasses, '{}')) e where e <> ''),
    -- Nunca descarta e-mail (Matheus, 23/10/2026): se as duas fichas têm
    -- e-mail principal diferente, o da removida entra na lista de campanhas
    -- (junto com o da mantida, se a lista estava vazia e a campanha ia para ele).
    email_campanhas = (select array_agg(distinct e) from unnest(
        coalesce(m.email_campanhas, '{}') || coalesce(r.email_campanhas, '{}') ||
        case when nullif(btrim(m.email), '') is not null and nullif(btrim(r.email), '') is not null and lower(btrim(m.email)) <> lower(btrim(r.email))
             then case when coalesce(array_length(m.email_campanhas, 1), 0) = 0 then array[btrim(m.email), btrim(r.email)] else array[btrim(r.email)] end
             else '{}'::text[] end) e where e <> ''),
    observacao_interna = nullif(concat_ws(E'\n\n', nullif(m.observacao_interna, ''),
      case when nullif(r.observacao_interna, '') is not null then 'Da ficha mesclada "' || r.nome || '": ' || r.observacao_interna end), '')
  where id = m.id;

  insert into imobiliaria_historico (imobiliaria_id, grupo_id, campo, antes, depois, motivo, origem)
  values (m.id, coalesce(m.grupo_id, r.grupo_id), 'mesclagem', to_jsonb(r), v_previa,
          format('Ficha "%s" (%s) mesclada nesta por %s', r.nome, coalesce(r.cnpj, 'sem CPF/CNPJ'), v_quem), 'manual');

  delete from imobiliarias where id = r.id;
  return v_previa;
end $$;

revoke all on function mesclar_imobiliarias_previa(uuid, uuid) from public, anon;
revoke all on function mesclar_imobiliarias(uuid, uuid) from public, anon;
grant execute on function mesclar_imobiliarias_previa(uuid, uuid) to authenticated, service_role;
grant execute on function mesclar_imobiliarias(uuid, uuid) to authenticated, service_role;
