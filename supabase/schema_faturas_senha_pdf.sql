-- Guarda a senha que realmente abriu o PDF (ex: Porto usa os 5 primeiros
-- dígitos do CNPJ da O2) -- precisa ir no corpo do e-mail de envio, senão a
-- imobiliária recebe o anexo e não consegue abrir.

alter table faturas add column if not exists senha_pdf text;
