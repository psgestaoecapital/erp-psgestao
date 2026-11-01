-- DRE Consolidado · drill 3º nível (CEO 14/10, uso em reuniões): LANÇAMENTOS de uma conta do plano no período.
-- Parte 1 (só leitura). Níveis 1 (grupo) e 2 (conta) já existem na tela; esta RPC entrega o 3º nível.
--
-- Espelha EXATAMENTE a composição de fn_psgc_dre_diario (de-para psgc_depara categoria→psgc_codigo, melhor por
-- confiança/revisado; regime competência=data_emissao, caixa=data_pagamento, previsto=data_vencimento) para que a
-- soma dos lançamentos feche CENTAVO A CENTAVO com a linha do DRE (psgc_dre). Devolve, por lançamento, as três datas
-- lado a lado (competência, vencimento, pagamento), e sinaliza `sem_competencia` (data_competencia IS NULL) — foi o
-- que distorceu a distribuição de lucros da Umuarama. `orfaos` = títulos mapeados para a conta SEM competência e SEM
-- emissão, mas com vencimento/pagamento no período (dinheiro real que some da competência) — para revisão.
--
-- Função NOVA, somente SELECT, com guarda por empresa (is_admin() OU empresas do usuário) e REVOKE anon.

CREATE OR REPLACE FUNCTION public.fn_psgc_dre_lancamentos(
  p_company_ids uuid[],
  p_psgc_codigo text,
  p_mes_ini date,
  p_mes_fim date,
  p_regime text DEFAULT 'competencia'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_regime     text := COALESCE(NULLIF(btrim(p_regime),''),'competencia');
  v_ini        date := date_trunc('month', p_mes_ini)::date;
  v_fim        date := (date_trunc('month', p_mes_fim) + interval '1 month - 1 day')::date;
  v_natureza   text; v_dre_grupo text; v_conta_nome text; v_is_receita boolean;
  v_lanc jsonb; v_orfaos jsonb; v_total numeric; v_dre_periodo numeric;
BEGIN
  IF p_company_ids IS NULL OR array_length(p_company_ids,1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhuma empresa informada');
  END IF;
  IF NOT public.is_admin() AND EXISTS (
    SELECT 1 FROM unnest(p_company_ids) x(id) WHERE x.id NOT IN (SELECT public.get_user_company_ids())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a uma ou mais empresas do grupo');
  END IF;

  SELECT nome, natureza, dre_grupo INTO v_conta_nome, v_natureza, v_dre_grupo
  FROM psgc_contas WHERE codigo = p_psgc_codigo;
  v_is_receita := COALESCE(v_dre_grupo IN ('ROB','RECEITAS_NAO_OP'), false) OR v_natureza = 'receita';

  IF v_is_receita THEN
    WITH tit AS (
      SELECT r.id, r.company_id,
             COALESCE(NULLIF(btrim(r.cliente_nome),''),'(sem nome)') AS pessoa,
             NULLIF(btrim(r.descricao),'')       AS descricao,
             NULLIF(btrim(r.numero_documento),'') AS documento,
             r.data_competencia, r.data_vencimento, r.data_pagamento,
             COALESCE(r.valor,0) AS valor, r.status,
             (CASE WHEN v_regime='caixa' THEN r.data_pagamento
                   WHEN v_regime='previsto' THEN r.data_vencimento
                   ELSE r.data_emissao END)::date AS data_regime
      FROM erp_receber r
      JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
        WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
          AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) best ON best.psgc_codigo = p_psgc_codigo
      WHERE r.company_id = ANY(p_company_ids) AND r.deleted_at IS NULL
        AND (r.status IS NULL OR r.status <> 'cancelado')
        AND CASE
          WHEN v_regime='caixa'    THEN r.data_pagamento IS NOT NULL AND r.data_pagamento BETWEEN v_ini AND v_fim
                                        AND COALESCE(r.forma_pagamento,'') NOT IN ('cartao_debito','cartao_credito')
          WHEN v_regime='previsto' THEN r.data_vencimento IS NOT NULL AND r.data_vencimento BETWEEN v_ini AND v_fim
                                        AND lower(COALESCE(r.status,'')) NOT IN ('pago','recebido','cancelado')
          ELSE r.data_emissao IS NOT NULL AND r.data_emissao BETWEEN v_ini AND v_fim
               AND NOT COALESCE(r.eh_repasse_cartao,false)
        END
    )
    SELECT jsonb_agg(jsonb_build_object(
             'id', id, 'empresa_id', company_id, 'pessoa', pessoa, 'descricao', descricao, 'documento', documento,
             'data_competencia', data_competencia, 'data_vencimento', data_vencimento, 'data_pagamento', data_pagamento,
             'valor', round(valor,2), 'status', status, 'sem_competencia', (data_competencia IS NULL)
           ) ORDER BY data_regime, valor DESC),
           round(COALESCE(SUM(valor),0),2)
      INTO v_lanc, v_total FROM tit;

    SELECT jsonb_agg(jsonb_build_object(
             'id', r.id, 'empresa_id', r.company_id,
             'pessoa', COALESCE(NULLIF(btrim(r.cliente_nome),''),'(sem nome)'),
             'descricao', NULLIF(btrim(r.descricao),''), 'documento', NULLIF(btrim(r.numero_documento),''),
             'data_competencia', r.data_competencia, 'data_vencimento', r.data_vencimento, 'data_pagamento', r.data_pagamento,
             'valor', round(COALESCE(r.valor,0),2), 'status', r.status, 'sem_competencia', true)
           ORDER BY COALESCE(r.data_vencimento, r.data_pagamento))
      INTO v_orfaos
    FROM erp_receber r
    JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = r.company_id AND pd.origem_codigo = r.categoria AND pd.ativo
        AND pc.dre_grupo IN ('ROB','RECEITAS_NAO_OP','NAO_OPER','RESULT_FIN')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON best.psgc_codigo = p_psgc_codigo
    WHERE r.company_id = ANY(p_company_ids) AND r.deleted_at IS NULL
      AND (r.status IS NULL OR r.status <> 'cancelado')
      AND r.data_competencia IS NULL AND r.data_emissao IS NULL
      AND COALESCE(r.data_vencimento, r.data_pagamento) BETWEEN v_ini AND v_fim;
  ELSE
    WITH tit AS (
      SELECT p.id, p.company_id,
             COALESCE(NULLIF(btrim(p.fornecedor_nome),''),'(sem nome)') AS pessoa,
             NULLIF(btrim(p.descricao),'')       AS descricao,
             NULLIF(btrim(p.numero_documento),'') AS documento,
             p.data_competencia, p.data_vencimento, p.data_pagamento,
             COALESCE(p.valor,0) AS valor, p.status,
             (CASE WHEN v_regime='caixa' THEN p.data_pagamento
                   WHEN v_regime='previsto' THEN p.data_vencimento
                   ELSE p.data_emissao END)::date AS data_regime
      FROM erp_pagar p
      JOIN LATERAL (
        SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
        WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
          AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
        ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
      ) best ON best.psgc_codigo = p_psgc_codigo
      WHERE p.company_id = ANY(p_company_ids) AND p.deleted_at IS NULL
        AND (p.status IS NULL OR p.status NOT IN ('cancelado','CANCELADO'))
        AND CASE
          WHEN v_regime='caixa'    THEN p.data_pagamento IS NOT NULL AND p.data_pagamento BETWEEN v_ini AND v_fim
          WHEN v_regime='previsto' THEN p.data_vencimento IS NOT NULL AND p.data_vencimento BETWEEN v_ini AND v_fim
                                        AND lower(COALESCE(p.status,'')) NOT IN ('pago','cancelado')
          ELSE p.data_emissao IS NOT NULL AND p.data_emissao BETWEEN v_ini AND v_fim
        END
    )
    SELECT jsonb_agg(jsonb_build_object(
             'id', id, 'empresa_id', company_id, 'pessoa', pessoa, 'descricao', descricao, 'documento', documento,
             'data_competencia', data_competencia, 'data_vencimento', data_vencimento, 'data_pagamento', data_pagamento,
             'valor', round(valor,2), 'status', status, 'sem_competencia', (data_competencia IS NULL)
           ) ORDER BY data_regime, valor DESC),
           round(COALESCE(SUM(valor),0),2)
      INTO v_lanc, v_total FROM tit;

    SELECT jsonb_agg(jsonb_build_object(
             'id', p.id, 'empresa_id', p.company_id,
             'pessoa', COALESCE(NULLIF(btrim(p.fornecedor_nome),''),'(sem nome)'),
             'descricao', NULLIF(btrim(p.descricao),''), 'documento', NULLIF(btrim(p.numero_documento),''),
             'data_competencia', p.data_competencia, 'data_vencimento', p.data_vencimento, 'data_pagamento', p.data_pagamento,
             'valor', round(COALESCE(p.valor,0),2), 'status', p.status, 'sem_competencia', true)
           ORDER BY COALESCE(p.data_vencimento, p.data_pagamento))
      INTO v_orfaos
    FROM erp_pagar p
    JOIN LATERAL (
      SELECT pd.psgc_codigo FROM psgc_depara pd JOIN psgc_contas pc ON pc.codigo = pd.psgc_codigo
      WHERE pd.company_id = p.company_id AND pd.origem_codigo = p.categoria AND pd.ativo
        AND pc.dre_grupo NOT IN ('ROB','RECEITAS_NAO_OP')
      ORDER BY pd.confianca DESC, pd.revisado DESC LIMIT 1
    ) best ON best.psgc_codigo = p_psgc_codigo
    WHERE p.company_id = ANY(p_company_ids) AND p.deleted_at IS NULL
      AND (p.status IS NULL OR p.status NOT IN ('cancelado','CANCELADO'))
      AND p.data_competencia IS NULL AND p.data_emissao IS NULL
      AND COALESCE(p.data_vencimento, p.data_pagamento) BETWEEN v_ini AND v_fim;
  END IF;

  -- valor da conta no período direto do psgc_dre (mesma fonte das 15 linhas) → reconciliação centavo a centavo.
  SELECT round(COALESCE(SUM(valor),0),2) INTO v_dre_periodo
  FROM psgc_dre
  WHERE company_id = ANY(p_company_ids) AND psgc_codigo = p_psgc_codigo
    AND COALESCE(regime,'competencia') = v_regime
    AND make_date(ano, mes, 1) BETWEEN v_ini AND date_trunc('month', v_fim)::date;

  RETURN jsonb_build_object(
    'ok', true,
    'conta_codigo', p_psgc_codigo, 'conta_nome', v_conta_nome,
    'is_receita', v_is_receita, 'fonte', CASE WHEN v_is_receita THEN 'erp_receber' ELSE 'erp_pagar' END,
    'regime', v_regime, 'mes_ini', v_ini, 'mes_fim', v_fim,
    'total', COALESCE(v_total,0), 'dre_periodo', v_dre_periodo,
    'lancamentos', COALESCE(v_lanc, '[]'::jsonb),
    'orfaos', COALESCE(v_orfaos, '[]'::jsonb)
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_psgc_dre_lancamentos(uuid[], text, date, date, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_psgc_dre_lancamentos(uuid[], text, date, date, text) TO authenticated, service_role;

-- RD-95: "?" das colunas do 3º nível (drill de lançamentos) na tela do DRE Consolidado.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
 ('financeiro.dre_consolidado.drill_lancamentos', '/dashboard/financeiro/dre-consolidado', 'Drill',
  'Lançamentos da conta',
  'Não se preenche aqui: é a lista dos títulos (contas a receber/pagar) que somam o valor desta conta no período.',
  'Mostra, título a título, de onde vem o número da linha do DRE — a soma dos lançamentos fecha com o valor da conta.',
  'Clicando em "Energia elétrica" aparecem as faturas de energia do período, com cliente/fornecedor, datas e valor.',
  'Achar que a lista é editável: aqui é só consulta. Reclassificar um título virá numa próxima etapa.',
  'financeiro', 10),
 ('financeiro.dre_consolidado.data_competencia', '/dashboard/financeiro/dre-consolidado', 'Drill',
  'Data de competência',
  'Não se preenche aqui: é a data em que o fato ocorreu (a que regime de competência usa para alocar no mês certo).',
  'É por ela que a competência distribui o resultado no mês correto — e a distribuição de lucros depende disso.',
  'Uma energia de setembro paga em outubro tem competência em setembro.',
  'Título SEM data de competência (destacado em vermelho): entra torto no resultado — revise e preencha a competência.',
  'financeiro', 11),
 ('financeiro.dre_consolidado.data_vencimento', '/dashboard/financeiro/dre-consolidado', 'Drill',
  'Data de vencimento',
  'Não se preenche aqui: é a data em que o título vence (usada pelo regime Previsto / fluxo de caixa).',
  'Serve para projetar o caixa — quando o dinheiro entra ou sai de fato pela data combinada.',
  'Boleto com vencimento em 10/10.',
  'Confundir vencimento com competência: são datas diferentes e entram em regimes diferentes.',
  'financeiro', 12),
 ('financeiro.dre_consolidado.data_pagamento', '/dashboard/financeiro/dre-consolidado', 'Drill',
  'Data de pagamento',
  'Não se preenche aqui: é a data em que o título foi efetivamente pago/recebido (usada pelo regime Caixa).',
  'É o que o regime Caixa usa — resultado pelo dinheiro que de fato entrou ou saiu.',
  'A mesma energia, paga em 05/10, tem pagamento em 05/10.',
  'Em aberto ainda não tem pagamento: no regime Caixa ele só aparece quando for pago.',
  'financeiro', 13),
 ('financeiro.dre_consolidado.sem_competencia', '/dashboard/financeiro/dre-consolidado', 'Drill',
  'Sem data de competência',
  'Não se preenche aqui: é um alerta — o título não tem data de competência preenchida.',
  'Marca os títulos que distorcem o resultado do período (como aconteceu na distribuição de lucros da Umuarama).',
  'Um título com vencimento no período mas sem competência aparece destacado para revisão.',
  'Ignorar o destaque: enquanto houver título sem competência, o mês fica torto. Preencha a competência no lançamento.',
  'financeiro', 14)
ON CONFLICT (chave) DO NOTHING;
