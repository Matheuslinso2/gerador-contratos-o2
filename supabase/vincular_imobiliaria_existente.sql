-- Depois de criar e CONFIRMAR sua conta de login real, rode isso para vincular
-- a imobiliária "Matheus Ferreira Lins" (cadastrada antes de existir login) à sua conta.
-- Troque o e-mail abaixo pelo e-mail que você usou para criar a conta.

update imobiliarias
set user_id = (select id from auth.users where email = 'matheus@o2seguros.com.br')
where nome = 'Matheus Ferreira Lins';
