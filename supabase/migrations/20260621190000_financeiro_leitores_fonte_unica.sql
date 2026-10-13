-- FIX RD-34 V5 BLOCO 🔴: 4 RPCs de leitura financeira ainda apontavam pra
-- erp_lancamentos (vazia). Reaponta pra erp_pagar (saidas) / erp_receber
-- (entradas), fonte unica de verdade pos #411 / #414.
--
-- Pre-req auditado:
--   - erp_receber/pagar: company_id, descricao, valor, data_*, status,
--     categoria · todas as colunas necessarias existem.
--   - erp_receber: cliente_id, cliente_nome.
--   - erp_clientes: razao_social, nome_fantasia, score_inadimplencia.
--     (NAO tem coluna 'nome' · spec apontou e foi corrigido pra nome_fantasia)
--   - data_vencimento/data_emissao sao DATE nativo · sem regex.
--
-- AVISO sobre buscar_matches_extrato:
--   A funcao continua referenciando 'erp_extrato' (singular) que NAO existe
--   no schema atual (auditado · 0 tabelas matching). Este PR remove o
--   acoplamento com erp_lancamentos · o gap com erp_extrato e PRE-EXISTENTE
--   e fora do escopo desta migration. Quando criar a tabela (ou apontar pra
--   outra equivalente), a funcao volta a rodar end-to-end.

-- ===================================================================
-- 1) fn_bpo_fechamento_validar
-- Mantem 5 checks intocados · so Check 4 (count lancamentos do mes)
-- passa a contar erp_pagar UNION erp_receber por data_emissao.
-- datas sao DATE -> aritmetica direta, sem regex.
-- ===================================================================
CREATE OR REPLACE FUNCTION public.fn_bpo_fechamento_validar(
  p_company_id uuid,
  p_mes_ref    date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
AS $function$
DECLARE
  v_gaps                 jsonb := '[]'::jsonb;
  v_proximo_dia          date := p_mes_ref + interval '1 month';
  v_inbox_pendente       int;
  v_inbox_vencido        int;
  v_classif_pendente     int;
  v_concil_pendente      int;
  v_lancamentos_mes      int;
  v_obrigacoes_atrasadas int;
  v_pronto               boolean;
BEGIN
  -- Check 1: Inbox limpo do mes
  SELECT count(*) FILTER (WHERE status='pendente'),
         count(*) FILTER (WHERE status='pendente' AND sla_vence_em < now())
  INTO v_inbox_pendente, v_inbox_vencido
  FROM bpo_inbox_items
  WHERE company_id = p_company_id
    AND created_at < v_proximo_dia;

  IF v_inbox_vencido > 5 THEN
    v_gaps := v_gaps || jsonb_build_object(
      'check', 'inbox_vencido',
      'descricao', v_inbox_vencido || ' itens com SLA vencido (max permitido: 5)',
      'severidade', 'bloqueante',
      'acao', 'Resolver itens em /dashboard/bpo/meu-dia'
    );
  ELSIF v_inbox_pendente > 30 THEN
    v_gaps := v_gaps || jsonb_build_object(
      'check', 'inbox_alto',
      'descricao', v_inbox_pendente || ' itens pendentes (recomendado: <30)',
      'severidade', 'aviso',
      'acao', 'Reduzir backlog antes de fechar'
    );
  END IF;

  -- Check 2: Classificacoes IA aprovadas
  SELECT count(*) INTO v_classif_pendente
  FROM bpo_classificacoes
  WHERE company_id = p_company_id AND status = 'pendente';

  IF v_classif_pendente > 10 THEN
    v_gaps := v_gaps || jsonb_build_object(
      'check', 'classificacao_pendente',
      'descricao', v_classif_pendente || ' classificacoes IA aguardando aprovacao',
      'severidade', 'bloqueante',
      'acao', 'Revisar em /dashboard/classificacao'
    );
  ELSIF v_classif_pendente > 0 THEN
    v_gaps := v_gaps || jsonb_build_object(
      'check', 'classificacao_alguns',
      'descricao', v_classif_pendente || ' classificacoes IA pendentes',
      'severidade', 'aviso',
      'acao', 'Revisar antes de fechar'
    );
  END IF;

  -- Check 3: Conciliacao bancaria
  SELECT COALESCE(sum(total_pendentes), 0) INTO v_concil_pendente
  FROM conciliacao_lote
  WHERE company_id = p_company_id
    AND status IN ('aberto','em_andamento')
    AND created_at < v_proximo_dia;

  IF v_concil_pendente > 50 THEN
    v_gaps := v_gaps || jsonb_build_object(
      'check', 'conciliacao_alta',
      'descricao', v_concil_pendente || ' movimentos bancarios sem conciliar',
      'severidade', 'bloqueante',
      'acao', 'Conciliar em /dashboard/conciliacao'
    );
  ELSIF v_concil_pendente > 0 THEN
    v_gaps := v_gaps || jsonb_build_object(
      'check', 'conciliacao_alguns',
      'descricao', v_concil_pendente || ' movimentos bancarios pendentes',
      'severidade', 'aviso',
      'acao', 'Conciliar antes de fechar'
    );
  END IF;

  -- Check 4: Tem lancamentos no mes (DRE possivel?) · ERA erp_lancamentos
  -- Agora UNION erp_pagar + erp_receber por data_emissao (DATE nativo).
  SELECT (
    (SELECT count(*) FROM erp_pagar
       WHERE company_id = p_company_id
         AND data_emissao >= p_mes_ref
         AND data_emissao <  v_proximo_dia)
   +
    (SELECT count(*) FROM erp_receber
       WHERE company_id = p_company_id
         AND data_emissao >= p_mes_ref
         AND data_emissao <  v_proximo_dia)
  ) INTO v_lancamentos_mes;

  IF v_lancamentos_mes < 5 THEN
    v_gaps := v_gaps || jsonb_build_object(
      'check', 'sem_lancamentos',
      'descricao', 'Apenas ' || v_lancamentos_mes || ' lancamentos no mes (DRE precisa de dados)',
      'severidade', 'bloqueante',
      'acao', 'Importar dados via Omie ou manual'
    );
  END IF;

  -- Check 5: Obrigacoes fiscais em dia
  SELECT count(*) INTO v_obrigacoes_atrasadas
  FROM bpo_inbox_items
  WHERE company_id = p_company_id
    AND status = 'pendente'
    AND categoria IN ('obrigacoes','compliance','fiscal')
    AND sla_vence_em < now();

  IF v_obrigacoes_atrasadas > 0 THEN
    v_gaps := v_gaps || jsonb_build_object(
      'check', 'obrigacoes_atrasadas',
      'descricao', v_obrigacoes_atrasadas || ' obrigacoes fiscais atrasadas',
      'severidade', 'aviso',
      'acao', 'Resolver em /dashboard/compliance'
    );
  END IF;

  -- Check 6: Empresa tem 3 papeis
  IF NOT (SELECT (fn_bpo_validar_assignment_completo(p_company_id)).completo) THEN
    v_gaps := v_gaps || jsonb_build_object(
      'check', 'sem_3_papeis',
      'descricao', 'Empresa nao tem titular+backup+supervisor ativos',
      'severidade', 'bloqueante',
      'acao', 'Atribuir em /dashboard/bpo/admin/empresas'
    );
  END IF;

  v_pronto := NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_gaps) AS g
    WHERE g->>'severidade' = 'bloqueante'
  );

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'mes_referencia', p_mes_ref,
    'pronto', v_pronto,
    'qtd_gaps', jsonb_array_length(v_gaps),
    'qtd_bloqueantes', (
      SELECT count(*) FROM jsonb_array_elements(v_gaps) AS g
      WHERE g->>'severidade' = 'bloqueante'
    ),
    'gaps', v_gaps,
    'metricas', jsonb_build_object(
      'inbox_pendente', v_inbox_pendente,
      'inbox_vencido', v_inbox_vencido,
      'classificacao_pendente', v_classif_pendente,
      'conciliacao_pendente', v_concil_pendente,
      'lancamentos_mes', v_lancamentos_mes,
      'obrigacoes_atrasadas', v_obrigacoes_atrasadas
    )
  );
END;
$function$;

-- ===================================================================
-- 2) buscar_matches_extrato
-- Fonte por UNION (erp_receber = receita, erp_pagar = despesa) · status
-- canonico {aberto, vencido, parcial}. Removido filtro de tipo legado.
--
-- NOTA: continua referenciando 'erp_extrato' (singular) que nao existe
-- no schema atual · gap pre-existente, fora do escopo desta PR.
-- ===================================================================
CREATE OR REPLACE FUNCTION public.buscar_matches_extrato(
  p_extrato_id      uuid,
  p_dias_tolerancia integer DEFAULT 5
)
RETURNS TABLE(lancamento_id uuid, descricao text, valor numeric, data_vencimento date, score numeric)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_extrato RECORD;
BEGIN
  SELECT * INTO v_extrato FROM erp_extrato WHERE id = p_extrato_id;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    l.id,
    l.descricao::TEXT,
    l.valor,
    COALESCE(l.data_vencimento, l.data_emissao) AS data_vencimento,
    (
      -- Match por valor exato (peso 50)
      CASE WHEN ABS(l.valor - ABS(v_extrato.valor)) < 0.01 THEN 50 ELSE 0 END +
      -- Match por data proxima (peso 30)
      CASE
        WHEN COALESCE(l.data_vencimento, l.data_emissao) = v_extrato.data_transacao THEN 30
        WHEN ABS(COALESCE(l.data_vencimento, l.data_emissao) - v_extrato.data_transacao) <= 2 THEN 25
        WHEN ABS(COALESCE(l.data_vencimento, l.data_emissao) - v_extrato.data_transacao) <= p_dias_tolerancia THEN 15
        ELSE 0
      END +
      -- Similaridade de texto (peso 20)
      CASE
        WHEN UPPER(l.descricao) LIKE '%' || UPPER(SPLIT_PART(v_extrato.descricao_limpa, ' ', 1)) || '%' THEN 20
        WHEN UPPER(l.descricao) LIKE '%' || UPPER(SPLIT_PART(v_extrato.descricao_limpa, ' ', 2)) || '%' THEN 10
        ELSE 0
      END
    )::DECIMAL AS score
  FROM (
    SELECT id, descricao, valor, data_vencimento, data_emissao, company_id, status, 'receita'::text AS tipo
      FROM erp_receber
    UNION ALL
    SELECT id, descricao, valor, data_vencimento, data_emissao, company_id, status, 'despesa'::text AS tipo
      FROM erp_pagar
  ) l
  WHERE l.company_id = v_extrato.company_id
    AND l.status IN ('aberto','vencido','parcial')
    AND ABS(l.valor - ABS(v_extrato.valor)) < 0.01
    AND ABS(COALESCE(l.data_vencimento, l.data_emissao) - v_extrato.data_transacao) <= p_dias_tolerancia
    AND (
      (v_extrato.valor > 0 AND l.tipo = 'receita')
      OR (v_extrato.valor < 0 AND l.tipo = 'despesa')
    )
  ORDER BY score DESC
  LIMIT 5;
END;
$function$;

-- ===================================================================
-- 3) detectar_recorrencias
-- UNION das bases · status='pago' · EXTRACT direto da DATE (sem regex).
-- ===================================================================
CREATE OR REPLACE FUNCTION public.detectar_recorrencias(p_company_id uuid)
RETURNS TABLE(descricao_padrao character varying, dia_mes integer, valor_medio numeric,
              tipo character varying, ocorrencias integer, ultima_ocorrencia date,
              categoria character varying)
LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  WITH historico AS (
    SELECT
      UPPER(TRIM(REGEXP_REPLACE(
        SUBSTRING(e.descricao FROM 1 FOR 50),
        '\d+[/-]\d+[/-]?\d*', '', 'g'
      ))) AS desc_norm,
      EXTRACT(DAY FROM e.data_vencimento)::int AS dia,
      e.valor          AS vl,
      e.tipo           AS tp,
      e.data_vencimento AS dt_venc,
      e.categoria      AS cat
    FROM (
      SELECT descricao, data_vencimento, valor, 'despesa'::varchar AS tipo, categoria
        FROM erp_pagar
        WHERE company_id = p_company_id
          AND status = 'pago'
          AND data_vencimento IS NOT NULL
      UNION ALL
      SELECT descricao, data_vencimento, valor, 'receita'::varchar AS tipo, categoria
        FROM erp_receber
        WHERE company_id = p_company_id
          AND status = 'pago'
          AND data_vencimento IS NOT NULL
    ) e
  )
  SELECT
    h.desc_norm::varchar,
    h.dia,
    AVG(h.vl)::decimal(14,2),
    MODE() WITHIN GROUP (ORDER BY h.tp)::varchar,
    count(*)::int,
    MAX(h.dt_venc),
    MODE() WITHIN GROUP (ORDER BY h.cat)::varchar
  FROM historico h
  WHERE h.dt_venc IS NOT NULL
    AND h.dt_venc >= CURRENT_DATE - interval '12 months'
    AND h.dt_venc <  CURRENT_DATE
  GROUP BY h.desc_norm, h.dia
  HAVING count(*) >= 3
     AND MAX(h.dt_venc) >= CURRENT_DATE - interval '60 days'
  ORDER BY count(*) DESC;
END;
$function$;

-- ===================================================================
-- 4) gerar_previsao_fluxo_caixa
-- ENTRADAS: erp_receber (cliente_id join · cliente_cnpj REMOVIDO).
--   nome cascade: cliente_nome > razao_social > nome_fantasia > 'Sem cliente'.
--   (c.nome NAO existe em erp_clientes · trocado por nome_fantasia)
-- SAIDAS:   erp_pagar (sem JOIN · valor por data_vencimento).
-- DEDUP recorrencia: NOT EXISTS em erp_pagar (era erp_lancamentos).
-- ===================================================================
CREATE OR REPLACE FUNCTION public.gerar_previsao_fluxo_caixa(
  p_company_id uuid,
  p_dias       integer DEFAULT 90,
  p_cenario    character varying DEFAULT 'realista'::character varying
)
RETURNS TABLE(data date, entrada_certa numeric, entrada_provavel numeric,
              saida_certa numeric, saida_recorrente numeric, saldo_dia numeric,
              saldo_acumulado numeric, eventos jsonb)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_dia              DATE;
  v_saldo_inicial    DECIMAL := 0;
  v_saldo_atual      DECIMAL := 0;
  v_entrada_certa    DECIMAL;
  v_entrada_provavel DECIMAL;
  v_saida_certa      DECIMAL;
  v_saida_recorrente DECIMAL;
  v_eventos          JSONB;
  v_saldo_dia        DECIMAL;
  v_mult_receita     DECIMAL := 1.0;
  v_mult_despesa     DECIMAL := 1.0;
BEGIN
  IF p_cenario = 'pessimista' THEN
    v_mult_receita := 0.80;
    v_mult_despesa := 1.05;
  ELSIF p_cenario = 'otimista' THEN
    v_mult_receita := 1.10;
    v_mult_despesa := 0.95;
  END IF;

  SELECT COALESCE(SUM(saldo_atual), 0) INTO v_saldo_inicial
  FROM erp_banco_contas
  WHERE company_id = p_company_id AND ativo = true;

  v_saldo_atual := v_saldo_inicial;

  FOR v_dia IN
    SELECT generate_series(CURRENT_DATE, CURRENT_DATE + (p_dias || ' days')::INTERVAL, '1 day')::DATE
  LOOP
    v_entrada_certa    := 0;
    v_entrada_provavel := 0;
    v_saida_certa      := 0;
    v_saida_recorrente := 0;
    v_eventos          := '[]'::JSONB;

    -- ENTRADAS: titulos a receber vencendo neste dia, ponderados pelo
    -- score do cliente. cliente_cnpj REMOVIDO (coluna fantasma) · join
    -- so por cliente_id.
    SELECT
      COALESCE(SUM(CASE
        WHEN c.score_inadimplencia IS NULL OR c.score_inadimplencia <= 30 THEN l.valor * 0.95
        WHEN c.score_inadimplencia <= 60 THEN l.valor * 0.70
        ELSE l.valor * 0.40
      END), 0),
      COALESCE(
        jsonb_agg(jsonb_build_object(
          'tipo', 'receita',
          'descricao', l.descricao,
          'valor', l.valor,
          'cliente', COALESCE(l.cliente_nome, c.razao_social, c.nome_fantasia, 'Sem cliente'),
          'score', c.score_inadimplencia,
          'probabilidade', CASE
            WHEN c.score_inadimplencia IS NULL OR c.score_inadimplencia <= 30 THEN 95
            WHEN c.score_inadimplencia <= 60 THEN 70
            ELSE 40
          END
        )) FILTER (WHERE l.id IS NOT NULL),
        '[]'::JSONB
      )
    INTO v_entrada_provavel, v_eventos
    FROM erp_receber l
    LEFT JOIN erp_clientes c
      ON c.id = l.cliente_id
     AND c.company_id = l.company_id
    WHERE l.company_id = p_company_id
      AND l.status IN ('aberto','vencido','parcial')
      AND l.data_vencimento = v_dia;

    v_entrada_provavel := v_entrada_provavel * v_mult_receita;

    -- SAIDAS: titulos a pagar vencendo neste dia (100% certo)
    SELECT COALESCE(SUM(valor), 0)
    INTO v_saida_certa
    FROM erp_pagar
    WHERE company_id = p_company_id
      AND status IN ('aberto','vencido','parcial')
      AND data_vencimento = v_dia;

    v_saida_certa := v_saida_certa * v_mult_despesa;

    -- SAIDAS RECORRENTES: detecta despesas que se repetem no mesmo dia
    -- do mes. Dedup: nao soma se ja ha titulo similar vencendo hoje.
    SELECT COALESCE(SUM(valor_medio), 0)
    INTO v_saida_recorrente
    FROM detectar_recorrencias(p_company_id) r
    WHERE r.dia_mes = EXTRACT(DAY FROM v_dia)::INT
      AND r.tipo IN ('despesa', 'saida', 'pagar')
      AND NOT EXISTS (
        SELECT 1 FROM erp_pagar l
        WHERE l.company_id = p_company_id
          AND l.data_vencimento = v_dia
          AND l.status IN ('aberto','vencido','parcial')
          AND UPPER(l.descricao) LIKE '%' || SPLIT_PART(r.descricao_padrao, ' ', 1) || '%'
      );

    v_saida_recorrente := v_saida_recorrente * v_mult_despesa;

    v_saldo_dia   := v_entrada_provavel - v_saida_certa - v_saida_recorrente;
    v_saldo_atual := v_saldo_atual + v_saldo_dia;

    RETURN QUERY SELECT
      v_dia,
      v_entrada_certa,
      v_entrada_provavel,
      v_saida_certa,
      v_saida_recorrente,
      v_saldo_dia,
      v_saldo_atual,
      v_eventos;
  END LOOP;
END;
$function$;
