-- Hub › Catálogo de Serviços: "?" (RD-95) da nova coluna "Origem".
-- A tela passou a exibir de onde veio cada serviço (Próprio / Biblioteca / Demonstração),
-- lendo o source_type real da view v_projetos_servicos_catalogo. Esta migration só adiciona
-- a ajuda de campo da coluna nova (aditiva, sem tocar dado de cliente).
-- Code: desenvolvedor_4_g

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_projetos', 'publicado'
FROM (VALUES
  ('projetos.catalogo.col_origem', 'Catálogo', 'Origem',
   'Nada a preencher: é só a indicação de onde veio o serviço.',
   'Mostra se o serviço foi criado pela sua empresa (Próprio), copiado da biblioteca pública de preços (Biblioteca, base SINAPI/TCPO/PS) ou semeado apenas para demonstração (Demonstração). Ajuda a saber o que já é seu e o que ainda precisa ser revisado.',
   'Um forro copiado da biblioteca aparece como "Biblioteca"; depois que você edita a composição e o preço, ele continua seu, mas a origem lembra de onde partiu.',
   'Achar que "Demonstração" é um serviço real da empresa: esses são dados de teste e devem ser substituídos pelos seus serviços antes de usar em orçamento.',
   35, '/dashboard/projetos/catalogo')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
