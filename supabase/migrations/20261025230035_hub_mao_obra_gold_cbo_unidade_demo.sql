-- Gold amarelo (auditor 24/10) · Mão de obra · aba Funções: CBO vazio e "Por unidade" sem valor na DEMO Construtora Modelo.
-- Semente aditiva e idempotente: só preenche CBO onde está vazio e cria perfis de produção (R$/m²) só para função de
-- produção da DEMO que ainda não tem perfil. Sem UPDATE/DELETE em dado de cliente (a empresa é a DEMO fixa).
DO $$
DECLARE v_c constant uuid := 'b0700000-0000-4000-a000-000000000006';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_c) THEN RETURN; END IF;
  UPDATE public.erp_funcao_mao_obra f SET cbo = m.cbo
    FROM (VALUES ('Servente', '7170-20'), ('Pedreiro', '7152-10'), ('Gesseiro', '7165-05'), ('Pintor', '7166-10'),
                 ('Carpinteiro', '7155-05'), ('Eletricista', '7156-15'), ('Encanador', '7241-10'),
                 ('Mestre de obras', '7102-05'), ('Engenheiro', '2142-05')) m(nome, cbo)
   WHERE f.company_id = v_c AND f.nome = m.nome AND f.cbo IS NULL;
  INSERT INTO public.erp_mao_obra_custo (company_id, tipo, funcao_id, descricao, vinculo, forma_pagamento, valor_unidade,
                                        quantidade_pessoas, conferido, conferido_em)
  SELECT v_c, 'perfil', f.id, f.nome || ' (perfil padrão · por m²)', 'pj', 'm2', p.valor, 2, true, now()
  FROM (VALUES ('Gesseiro', 18.00), ('Pintor', 14.00), ('Aplicador de piso vinílico', 22.00)) p(nome, valor)
  JOIN public.erp_funcao_mao_obra f ON f.company_id = v_c AND f.nome = p.nome
  WHERE NOT EXISTS (SELECT 1 FROM public.erp_mao_obra_custo k WHERE k.funcao_id = f.id);
END $$;
