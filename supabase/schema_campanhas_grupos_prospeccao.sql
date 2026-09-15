-- Refinamento do Matheus sobre prospecção (15/09/2026): grupo de
-- prospecção é um tipo distinto (imobiliárias sem cadastro no Workspace,
-- não necessariamente clientes), com criação própria ("Novo grupo de
-- prospecção") e planilha com 4 colunas -- CNPJ/CPF, e-mail, nome da
-- imobiliária E nome do responsável (duas pessoas/nomes diferentes: a
-- empresa e quem de fato recebe o e-mail). Tabela tinha só 0 linhas até
-- agora, seguro renomear sem migração de dados.
alter table campanhas_grupos_contatos rename column nome to nome_imobiliaria;
alter table campanhas_grupos_contatos add column if not exists nome_responsavel text;

alter table campanhas_grupos add column if not exists tipo text not null default 'padrao' check (tipo in ('padrao', 'prospeccao'));
