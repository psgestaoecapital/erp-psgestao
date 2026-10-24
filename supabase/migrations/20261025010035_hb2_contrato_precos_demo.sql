-- HB2 · Contrato de preços do cliente: 1 contrato COMPLETO e FICTÍCIO na Construtora Modelo - DEMO (faixas de quantidade,
-- 4 regimes e código por regime no ERP do cliente). Só INSERT de dado novo, idempotente (pula se já existe), sem tocar dado real.
DO $$
DECLARE
  v_co uuid := 'b0700000-0000-4000-a000-000000000006';
  v_t uuid;
  s record; f record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = v_co) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.erp_tabela_preco_cliente WHERE company_id = v_co AND nome = 'Contrato modelo — Piso industrial (fictício)') THEN RETURN; END IF;

  INSERT INTO public.erp_tabela_preco_cliente (company_id, nome, vigencia_inicio, vigencia_fim)
  VALUES (v_co, 'Contrato modelo — Piso industrial (fictício)', date '2026-01-01', date '2026-12-31') RETURNING id INTO v_t;

  FOR s IN SELECT * FROM (VALUES
    ('piso-uretano-6',  'Piso de uretano 6 mm',  'm²', 118.00),
    ('epoxi-autonivel', 'Epóxi autonivelante',   'm²',  96.00),
    ('preparo-base',    'Preparação de base',    'm²',  18.50)
  ) AS x(ref, nome, un, base) LOOP
    FOR f IN SELECT * FROM (VALUES
      (0::numeric, 100::numeric, 1.00), (100, 500, 0.94), (500, 1000, 0.90),
      (1000, 5000, 0.86), (5000, 10000, 0.83), (10000, NULL::numeric, 0.80)
    ) AS y(de, ate, fator) LOOP
      INSERT INTO public.erp_tabela_preco_item (company_id, tabela_id, servico_ref, servico_nome, unidade, faixa_de, faixa_ate, preco_base)
      VALUES (v_co, v_t, s.ref, s.nome, s.un, f.de, f.ate, round(s.base * f.fator, 4));
    END LOOP;
  END LOOP;

  INSERT INTO public.erp_tabela_preco_condicao (company_id, tabela_id, condicao, percentual) VALUES
    (v_co, v_t, 'noturno', 20), (v_co, v_t, 'sabado', 50), (v_co, v_t, 'domingo_feriado', 100);

  INSERT INTO public.erp_tabela_preco_codigo (company_id, tabela_id, servico_ref, condicao, codigo_externo) VALUES
    (v_co, v_t, 'piso-uretano-6', 'normal', 'DEMO-1001'), (v_co, v_t, 'piso-uretano-6', 'noturno', 'DEMO-1002'),
    (v_co, v_t, 'piso-uretano-6', 'sabado', 'DEMO-1003'), (v_co, v_t, 'piso-uretano-6', 'domingo_feriado', 'DEMO-1004'),
    (v_co, v_t, 'epoxi-autonivel', 'normal', 'DEMO-2001'), (v_co, v_t, 'epoxi-autonivel', 'noturno', 'DEMO-2002'),
    (v_co, v_t, 'epoxi-autonivel', 'sabado', 'DEMO-2003'), (v_co, v_t, 'epoxi-autonivel', 'domingo_feriado', 'DEMO-2004');
  -- 'preparo-base' fica SEM código de propósito: a tela deve avisar "serviço sem código no cliente".
END $$;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'hub.tabela_preco.depara', 'Tabela de preço', 'De-para com o cliente',
  'Nada a preencher: é um aviso de conferência.',
  'Mostra serviço da tabela sem código no ERP do cliente e código que não corresponde a nenhum serviço, para a medição e a NF saírem com o código certo.',
  'Preparação de base sem código: peça o código ao cliente.',
  'Medir um serviço sem código e a nota do cliente ser recusada.', 8, '/dashboard/projetos/tabelas-preco', 'hub', 'publicado'
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo WHERE chave = 'hub.tabela_preco.depara');
