-- ERP O2 — filtros do setor imobiliário (Matheus 25/10/2026): inquilino, proprietário e imóvel na tela de Documentos.
-- Aplicado via MCP (migrations erp_docs_por_partes / erp_docs_por_partes_v2). Resolve no banco e devolve até
-- p_limite documentos (mais recentes primeiro) que atendem a todos os campos informados; a tela faz um único
-- .in("id", …) em vez de montar listas enormes de ids na URL (a combinação inquilino + proprietário estourava).
create index if not exists erp_item_partes_item_idx on public.erp_item_partes (item_id);
-- função: ver public.erp_docs_por_partes(p_inquilino text, p_proprietario text, p_imovel text, p_limite int default 400)
--   inquilino   = locatarios (nome ilike / CPF-CNPJ exato) → erp_documentos.locatario_id ∪ erp_item_partes papel 'locatario'
--   proprietário = erp_item_partes papel 'proprietario' ou 'garantido' (nome ilike / documento exato)
--   imóvel      = erp_documento_itens logradouro/bairro/complemento ilike, ou CEP (8 dígitos)
--   security invoker (RLS de quem consulta), plpgsql com arrays intermediários (versão SQL pura levava 17 s).
