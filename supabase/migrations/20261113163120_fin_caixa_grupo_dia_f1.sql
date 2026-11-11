-- Item 5 (P2/Pdois, CEO 11/11) — GESTÃO DE CAIXA DO GRUPO · F1 (só leitura)
-- Tela nova GE > Financeiro: /dashboard/financeiro/caixa-grupo
-- "Caixa do dia" do GRUPO (várias empresas/CNPJs): para cada empresa e no total,
-- saldo inicial (fim do dia anterior), ENTRADAS do dia (recebimentos baixados),
-- SAÍDAS do dia (pagamentos baixados), saldo final; e por conta bancária.
--
-- GENÉRICO para qualquer grupo econômico (mesmo padrão do DRE consolidado, RD-26):
-- a tela resolve os company_ids do grupo (fn_grupo_empresa) e chama esta RPC com p_company_ids[].
--
-- Aritmética espelha a fn_fluxo_caixa_diario (fonte confiável), PROVADA no dado (RD-38):
--   Pdois 36b69d77, dia 2026-11-10 → entradas 30.603,00 e saídas 27.734,93 batem com a RPC oficial.
--   Soma por conta + "sem conta vinculada" = total da empresa (reconcilia).
-- F1 NÃO considera transferências entre contas (internas) — ficam para F2/conciliação.
-- Aditiva: função NOVA, RLS por empresa via fn__guarda_empresa, REVOKE anon.

CREATE OR REPLACE FUNCTION public.fn_fin_caixa_grupo_dia(
  p_company_ids uuid[],
  p_data date DEFAULT CURRENT_DATE
) RETURNS jsonb
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  _cid uuid;
  v_empresas jsonb;
  v_grupo jsonb;
BEGIN
  IF p_company_ids IS NULL OR array_length(p_company_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhuma empresa informada');
  END IF;

  -- Guarda multitenant (fail-closed): cada empresa precisa ser acessível ao usuário.
  FOREACH _cid IN ARRAY p_company_ids LOOP
    PERFORM public.fn__guarda_empresa(_cid);
  END LOOP;

  WITH cids AS (
    SELECT DISTINCT unnest(p_company_ids) AS company_id
  ),
  -- Contas de caixa (entram na tabela por conta e no saldo).
  contas AS (
    SELECT c.id AS conta_id, c.company_id, c.nome, c.banco, COALESCE(c.saldo_inicial, 0) AS saldo_inicial
    FROM erp_banco_contas c
    JOIN cids ON cids.company_id = c.company_id
    WHERE c.ativo = true AND COALESCE(c.soma_no_saldo, true) = true
  ),
  -- Recebimentos realizados (baixados), por conta (liga por conta_bancaria_id);
  -- exclui títulos de conta marcada incluir_no_fluxo=false (igual à RPC oficial).
  rec AS (
    SELECT er.company_id, er.conta_bancaria_id AS conta_id,
           SUM(COALESCE(NULLIF(er.valor_pago, 0), er.valor, 0)) FILTER (WHERE er.data_pagamento = p_data) AS dia,
           SUM(COALESCE(NULLIF(er.valor_pago, 0), er.valor, 0)) FILTER (WHERE er.data_pagamento < p_data) AS antes
    FROM erp_receber er
    JOIN cids ON cids.company_id = er.company_id
    WHERE er.deleted_at IS NULL
      AND er.status IN ('pago', 'recebido', 'parcial')
      AND er.data_pagamento IS NOT NULL AND er.data_pagamento <= p_data
      AND NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.id = er.conta_bancaria_id AND b.incluir_no_fluxo = false)
    GROUP BY er.company_id, er.conta_bancaria_id
  ),
  -- Pagamentos realizados (baixados), por conta (erp_pagar liga por NOME).
  pag AS (
    SELECT ep.company_id, lower(ep.conta_bancaria) AS conta_nome,
           SUM(COALESCE(NULLIF(ep.valor_pago, 0), ep.valor, 0)) FILTER (WHERE ep.data_pagamento = p_data) AS dia,
           SUM(COALESCE(NULLIF(ep.valor_pago, 0), ep.valor, 0)) FILTER (WHERE ep.data_pagamento < p_data) AS antes
    FROM erp_pagar ep
    JOIN cids ON cids.company_id = ep.company_id
    WHERE ep.deleted_at IS NULL
      AND ep.status IN ('pago', 'parcial')
      AND ep.data_pagamento IS NOT NULL AND ep.data_pagamento <= p_data
      AND NOT EXISTS (SELECT 1 FROM erp_banco_contas b WHERE b.company_id = ep.company_id AND b.incluir_no_fluxo = false AND lower(b.nome) = lower(ep.conta_bancaria))
    GROUP BY ep.company_id, lower(ep.conta_bancaria)
  ),
  -- Totais por empresa (todas as linhas, inclusive sem conta de caixa atribuída).
  rec_tot AS (SELECT company_id, SUM(dia) AS dia, SUM(antes) AS antes FROM rec GROUP BY company_id),
  pag_tot AS (SELECT company_id, SUM(dia) AS dia, SUM(antes) AS antes FROM pag GROUP BY company_id),
  -- Nível conta (só contas de caixa).
  acc AS (
    SELECT c.company_id, c.conta_id, c.nome, c.banco,
           c.saldo_inicial,
           COALESCE(r.dia, 0)   AS entradas,
           COALESCE(p.dia, 0)   AS saidas,
           COALESCE(r.antes, 0) AS rec_antes,
           COALESCE(p.antes, 0) AS pag_antes
    FROM contas c
    LEFT JOIN rec r ON r.company_id = c.company_id AND r.conta_id = c.conta_id
    LEFT JOIN pag p ON p.company_id = c.company_id AND p.conta_nome = lower(c.nome)
  ),
  acc_sum AS (
    SELECT company_id,
           SUM(entradas) AS entradas, SUM(saidas) AS saidas,
           SUM(saldo_inicial) AS saldo_inicial_contas,
           SUM(rec_antes) AS rec_antes, SUM(pag_antes) AS pag_antes
    FROM acc GROUP BY company_id
  ),
  emp AS (
    SELECT
      cids.company_id,
      COALESCE(co.nome_fantasia, co.razao_social, 'Empresa') AS empresa_nome,
      co.cnpj,
      -- "Sem conta vinculada": diferença entre o total da empresa e o atribuído às contas de caixa.
      COALESCE(rt.dia, 0)   - COALESCE(asum.entradas, 0)  AS sc_entradas,
      COALESCE(pt.dia, 0)   - COALESCE(asum.saidas, 0)     AS sc_saidas,
      (COALESCE(rt.antes, 0) - COALESCE(asum.rec_antes, 0))
        - (COALESCE(pt.antes, 0) - COALESCE(asum.pag_antes, 0)) AS sc_saldo_inicial,
      COALESCE(asum.saldo_inicial_contas, 0)
        + COALESCE(asum.rec_antes, 0) - COALESCE(asum.pag_antes, 0) AS saldo_inicial_contas_rolado,
      COALESCE(asum.entradas, 0) AS entradas_contas,
      COALESCE(asum.saidas, 0)   AS saidas_contas,
      COALESCE(rt.dia, 0)   AS entradas_emp,
      COALESCE(pt.dia, 0)   AS saidas_emp,
      (
        SELECT COALESCE(jsonb_agg(linha ORDER BY ord, nome), '[]'::jsonb)
        FROM (
          SELECT 0 AS ord, a.nome, a.banco,
                 jsonb_build_object(
                   'conta_id', a.conta_id, 'nome', a.nome, 'banco', a.banco,
                   'saldo_inicial', round(a.saldo_inicial + a.rec_antes - a.pag_antes, 2),
                   'entradas', round(a.entradas, 2),
                   'saidas', round(a.saidas, 2),
                   'saldo_final', round(a.saldo_inicial + a.rec_antes - a.pag_antes + a.entradas - a.saidas, 2)
                 ) AS linha
          FROM acc a WHERE a.company_id = cids.company_id
          UNION ALL
          -- Linha "sem conta vinculada" só aparece quando há movimento sem conta de caixa.
          SELECT 1 AS ord, 'Sem conta vinculada' AS nome, NULL::text AS banco,
                 jsonb_build_object(
                   'conta_id', NULL, 'nome', 'Sem conta vinculada', 'banco', NULL,
                   'saldo_inicial', round((COALESCE(rt.antes,0)-COALESCE(asum.rec_antes,0)) - (COALESCE(pt.antes,0)-COALESCE(asum.pag_antes,0)), 2),
                   'entradas', round(COALESCE(rt.dia,0)-COALESCE(asum.entradas,0), 2),
                   'saidas', round(COALESCE(pt.dia,0)-COALESCE(asum.saidas,0), 2),
                   'saldo_final', round(
                      ((COALESCE(rt.antes,0)-COALESCE(asum.rec_antes,0)) - (COALESCE(pt.antes,0)-COALESCE(asum.pag_antes,0)))
                      + (COALESCE(rt.dia,0)-COALESCE(asum.entradas,0)) - (COALESCE(pt.dia,0)-COALESCE(asum.saidas,0)), 2)
                 ) AS linha
          WHERE round(COALESCE(rt.dia,0)-COALESCE(asum.entradas,0),2) <> 0
             OR round(COALESCE(pt.dia,0)-COALESCE(asum.saidas,0),2) <> 0
             OR round((COALESCE(rt.antes,0)-COALESCE(asum.rec_antes,0)) - (COALESCE(pt.antes,0)-COALESCE(asum.pag_antes,0)),2) <> 0
        ) linhas
      ) AS contas
    FROM cids
    LEFT JOIN companies co ON co.id = cids.company_id
    LEFT JOIN rec_tot rt ON rt.company_id = cids.company_id
    LEFT JOIN pag_tot pt ON pt.company_id = cids.company_id
    LEFT JOIN acc_sum asum ON asum.company_id = cids.company_id
  ),
  emp_json AS (
    SELECT
      company_id, empresa_nome, cnpj, contas,
      round(saldo_inicial_contas_rolado + sc_saldo_inicial, 2) AS saldo_inicial,
      round(entradas_emp, 2) AS entradas,
      round(saidas_emp, 2)   AS saidas,
      round(saldo_inicial_contas_rolado + sc_saldo_inicial + entradas_emp - saidas_emp, 2) AS saldo_final
    FROM emp
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'company_id', company_id,
      'empresa_nome', empresa_nome,
      'cnpj', cnpj,
      'saldo_inicial', saldo_inicial,
      'entradas', entradas,
      'saidas', saidas,
      'saldo_final', saldo_final,
      'contas', contas
    ) ORDER BY empresa_nome), '[]'::jsonb),
    jsonb_build_object(
      'saldo_inicial', round(COALESCE(SUM(saldo_inicial), 0), 2),
      'entradas', round(COALESCE(SUM(entradas), 0), 2),
      'saidas', round(COALESCE(SUM(saidas), 0), 2),
      'saldo_final', round(COALESCE(SUM(saldo_final), 0), 2)
    )
  INTO v_empresas, v_grupo
  FROM emp_json;

  RETURN jsonb_build_object(
    'ok', true,
    'data', p_data,
    'grupo', v_grupo,
    'empresas', v_empresas
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_fin_caixa_grupo_dia(uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_fin_caixa_grupo_dia(uuid[], date) TO authenticated, service_role;

-- RD-95: "?" em todo campo/indicador/coluna/ação da tela nova.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/financeiro/caixa-grupo', 'gestao_empresarial', 'publicado'
FROM (VALUES
  ('ge.caixa_grupo.data', 'Filtros', 'Dia',
   'Escolha o dia do caixa. Começa em hoje; use ‹ › para ver outro dia.',
   'Mostra o movimento do caixa daquele dia: o que você tinha no início, o que entrou, o que saiu e com quanto terminou.',
   'Escolha ontem para conferir o fechamento do dia anterior.',
   'Achar que é um período: aqui é UM dia só; para a janela de vários dias use o Fluxo de Caixa.', 1),
  ('ge.caixa_grupo.visao', 'Filtros', 'Por CNPJ / Consolidado',
   'Escolha ver cada empresa do grupo em separado (por CNPJ) ou tudo somado (consolidado).',
   'Permite olhar o caixa de uma empresa por vez ou o caixa do grupo inteiro numa linha só.',
   'Consolidado para saber o caixa do grupo; por CNPJ para ver quanto é de cada empresa.',
   'Procurar uma empresa que não é do grupo: a tela mostra só as empresas às quais você tem acesso.', 2),
  ('ge.caixa_grupo.saldo_inicial', 'Indicadores', 'Saldo inicial',
   'Nada a preencher: é o saldo das contas no fim do dia anterior (antes dos movimentos deste dia).',
   'Diz com quanto o caixa começou o dia.',
   'Se o grupo terminou ontem com R$ 10.000,00, o saldo inicial de hoje é R$ 10.000,00.',
   'Confundir com saldo do extrato do banco: aqui é a visão do caixa (baixas registradas no sistema).', 3),
  ('ge.caixa_grupo.entradas', 'Indicadores', 'Entradas do dia',
   'Nada a preencher: é a soma dos recebimentos baixados no dia (contas a receber quitadas).',
   'Mostra quanto entrou no caixa no dia.',
   'Se foram recebidos R$ 795,00 no dia, é esse o valor.',
   'Contar títulos só vencidos: entra quem foi BAIXADO (recebido) no dia, não o que apenas venceu.', 4),
  ('ge.caixa_grupo.saidas', 'Indicadores', 'Saídas do dia',
   'Nada a preencher: é a soma dos pagamentos baixados no dia (contas a pagar quitadas).',
   'Mostra quanto saiu do caixa no dia.',
   'Se foram pagos R$ 1.200,00 no dia, é esse o valor.',
   'Contar contas só agendadas: sai quem foi BAIXADO (pago) no dia, não o que só está previsto.', 5),
  ('ge.caixa_grupo.saldo_final', 'Indicadores', 'Saldo final',
   'Nada a preencher: é o saldo inicial + entradas − saídas do dia.',
   'Diz com quanto o caixa terminou o dia.',
   'Saldo inicial R$ 10.000,00 + entradas R$ 795,00 − saídas R$ 1.200,00 = R$ 9.595,00.',
   'Esperar que bata com o extrato do banco sem conciliar: a conciliação bancária é a etapa do fechamento (em breve).', 6),
  ('ge.caixa_grupo.col.conta', 'Colunas', 'Conta',
   'Nada a preencher: é a conta bancária (banco + empresa). "Sem conta vinculada" agrupa baixas sem conta informada.',
   'Mostra em qual conta de cada empresa o dinheiro entrou ou saiu.',
   'Sicredi · Prigol.',
   'Procurar um título específico: esta tela resume por CONTA; o detalhe do título fica no Receber/Pagar.', 7),
  ('ge.caixa_grupo.col.saldo_inicial', 'Colunas', 'Saldo inicial (conta)',
   'Nada a preencher: saldo daquela conta no fim do dia anterior.',
   'Diz com quanto cada conta começou o dia.',
   'R$ 8.737,15.',
   'Confundir com o saldo inicial cadastrado da conta: aqui já está rolado até o dia escolhido.', 8),
  ('ge.caixa_grupo.col.entradas', 'Colunas', 'Entradas (conta)',
   'Nada a preencher: recebimentos baixados no dia naquela conta.',
   'Mostra quanto entrou em cada conta no dia.',
   'R$ 795,00.',
   'Somar as linhas e não bater com o total: confira a linha "Sem conta vinculada".', 9),
  ('ge.caixa_grupo.col.saidas', 'Colunas', 'Saídas (conta)',
   'Nada a preencher: pagamentos baixados no dia naquela conta.',
   'Mostra quanto saiu de cada conta no dia.',
   'R$ 1.200,00.',
   'Esquecer que pagamento liga a conta pelo NOME: pagamento com nome de conta diferente cai em "Sem conta vinculada".', 10),
  ('ge.caixa_grupo.col.saldo_final', 'Colunas', 'Saldo final (conta)',
   'Nada a preencher: saldo inicial da conta + entradas − saídas do dia.',
   'Diz com quanto cada conta terminou o dia.',
   'R$ 8.332,15.',
   'Esperar bater com o extrato sem conciliar: conciliação é a etapa do fechamento (em breve).', 11)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3: origem do dado rastreada em system_screens.
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, componentes_principais, views_consumidas, rpcs_chamadas, estado_real, modulo)
VALUES (
  'dashboard.financeiro.caixa-grupo',
  '/dashboard/financeiro/caixa-grupo',
  'gestao_empresarial',
  'Caixa do grupo (caixa do dia)',
  'Caixa do dia do grupo econômico: por empresa/CNPJ e consolidado, com saldo inicial, entradas, saídas, saldo final e detalhamento por conta bancária. Só leitura (F1).',
  ARRAY['CaixaGrupoDia'],
  ARRAY[]::text[],
  ARRAY['fn_grupo_empresa','fn_fin_caixa_grupo_dia','fn_ajuda_campo_listar'],
  'parcial',
  'financeiro'
)
ON CONFLICT (id) DO UPDATE SET
  rota = EXCLUDED.rota,
  area = EXCLUDED.area,
  titulo = EXCLUDED.titulo,
  descricao_funcional = EXCLUDED.descricao_funcional,
  componentes_principais = EXCLUDED.componentes_principais,
  rpcs_chamadas = EXCLUDED.rpcs_chamadas,
  atualizado_em = now();
