-- Oficina · #108 (banco) — desconto na OS antes de faturar, com alçada por teto e autoria.
-- Jordana: aplicar desconto NA OS (não depois, na Gestão Empresarial) e poder consultar depois o valor
-- real da OS e o valor cobrado. Ponto ÚNICO de entrada: a OS. O faturamento (avulso e lote) já usa o
-- total da OS, então o título nasce com o total COM desconto.
--
-- Regras (decisão do CEO):
--   • desconto GRAVADO em valor (desconto_valor); % é conveniência da tela (converte → valor).
--   • bifurcação no recálculo do total:
--       - OS COM itens aprovados  → total = (serviço+materiais derivados dos itens) + hora + desloc − desconto;
--       - OS SEM itens aprovados  → total foi digitado À MÃO (pode não bater com a soma dos componentes —
--         ex.: 3 OS legadas da KGF). NÃO re-derivar: o total gravado é o BRUTO. O desconto subtrai do total
--         gravado (gross = total + desconto anterior). Prova: OS-2026-0004 (total 340) com desconto R$10 = 330,
--         nunca 265−10=255. Re-derivar dos itens (=0) destruiria o legado — proibido.
--   • alçada por TETO percentual configurável por empresa (default 10%): até o teto quem fatura concede;
--     acima do teto exige aprovação de quem tem alçada (p_aprovado_por).
--   • desconto nunca > total nem negativo. Bloqueado após faturado (exige estorno).
--   • autoria sempre por auth.uid(): quem concedeu, quando, valor, % equivalente, e se passou por aprovação.
--
-- RD-52 (arquivo=ledger) · RD-38 (provado em rollback). SECURITY DEFINER → REVOKE anon + autoria auth.uid().

-- 1) Colunas de desconto/autoria na OS + teto por empresa.
ALTER TABLE public.erp_os
  ADD COLUMN IF NOT EXISTS desconto_percentual   numeric,
  ADD COLUMN IF NOT EXISTS desconto_concedido_por uuid,
  ADD COLUMN IF NOT EXISTS desconto_concedido_em  timestamptz,
  ADD COLUMN IF NOT EXISTS desconto_aprovado_por  uuid;

ALTER TABLE public.erp_oficina_parametros
  ADD COLUMN IF NOT EXISTS desconto_os_teto_pct numeric NOT NULL DEFAULT 10;

-- 2) Recálculo do total com a bifurcação (documentada acima). OS sem itens aprovados NÃO é re-derivada.
CREATE OR REPLACE FUNCTION public.fn_os_recalcular_total_interno(p_os_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_serv numeric := 0; v_mat numeric := 0; v_tem_itens boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM erp_os_diagnostico_item WHERE os_id = p_os_id AND aprovado IS TRUE)
    INTO v_tem_itens;

  -- #108 · BIFURCAÇÃO INTENCIONAL: sem itens aprovados o serviço/hora foram lançados À MÃO e o total pode
  -- não bater com a soma dos componentes (legado). Re-derivar (itens=0) zeraria o serviço e destruiria o
  -- total. Então preservamos: o total gravado é o bruto; o desconto é aplicado por fn_os_aplicar_desconto.
  IF NOT v_tem_itens THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(preco * COALESCE(quantidade,1)) FILTER (WHERE tipo IN ('servico','mao_obra','mão de obra')),0),
    COALESCE(SUM(preco * COALESCE(quantidade,1)) FILTER (WHERE tipo IS NULL OR tipo NOT IN ('servico','mao_obra','mão de obra')),0)
  INTO v_serv, v_mat
  FROM erp_os_diagnostico_item WHERE os_id = p_os_id AND aprovado IS TRUE;

  UPDATE erp_os SET
    valor_servico   = v_serv,
    valor_materiais = v_mat,
    total = GREATEST(v_serv + v_mat + COALESCE(valor_hora,0) + COALESCE(valor_deslocamento,0) - COALESCE(desconto_valor,0), 0),
    updated_at = now()
  WHERE id = p_os_id;
END $function$;

REVOKE ALL ON FUNCTION public.fn_os_recalcular_total_interno(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_recalcular_total_interno(uuid) TO authenticated, service_role;

-- 3) Aplicar desconto na OS (ponto único). Grava em valor; deriva o %; alçada por teto; autoria auth.uid().
CREATE OR REPLACE FUNCTION public.fn_os_aplicar_desconto(p_os_id uuid, p_desconto_valor numeric, p_aprovado_por uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_os record; v_tem_itens boolean; v_serv numeric := 0; v_mat numeric := 0;
  v_gross numeric; v_desc numeric; v_teto_pct numeric; v_teto_valor numeric; v_total_novo numeric;
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id = p_os_id;
  IF v_os IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS não encontrada'); END IF;
  IF NOT (v_os.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa'); END IF;

  -- bloqueado após faturado (exige estorno; senão OS e título divergem)
  IF COALESCE(v_os.titulos_gerados, false) OR v_os.lancamento_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'ja_faturada', true,
      'erro', 'OS já faturada — alterar o desconto exige estornar o faturamento primeiro.'); END IF;

  v_desc := round(COALESCE(p_desconto_valor, 0), 2);
  IF v_desc < 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Desconto não pode ser negativo.'); END IF;

  -- BRUTO (gross) antes do desconto — a bifurcação do #108
  SELECT EXISTS (SELECT 1 FROM erp_os_diagnostico_item WHERE os_id = p_os_id AND aprovado IS TRUE) INTO v_tem_itens;
  IF v_tem_itens THEN
    SELECT
      COALESCE(SUM(preco * COALESCE(quantidade,1)) FILTER (WHERE tipo IN ('servico','mao_obra','mão de obra')),0),
      COALESCE(SUM(preco * COALESCE(quantidade,1)) FILTER (WHERE tipo IS NULL OR tipo NOT IN ('servico','mao_obra','mão de obra')),0)
    INTO v_serv, v_mat FROM erp_os_diagnostico_item WHERE os_id = p_os_id AND aprovado IS TRUE;
    v_gross := round(v_serv + v_mat + COALESCE(v_os.valor_hora,0) + COALESCE(v_os.valor_deslocamento,0), 2);
  ELSE
    -- sem itens: o total GRAVADO (à mão) é o bruto; recupera somando o desconto anterior.
    v_gross := round(COALESCE(v_os.total,0) + COALESCE(v_os.desconto_valor,0), 2);
  END IF;

  IF v_desc > v_gross THEN
    RETURN jsonb_build_object('ok', false, 'erro',
      'Desconto (R$ '||to_char(v_desc,'FM999999990.00')||') não pode ultrapassar o total da OS (R$ '||to_char(v_gross,'FM999999990.00')||').'); END IF;

  -- alçada: teto percentual por empresa (default 10%). Acima do teto exige aprovação.
  SELECT COALESCE(desconto_os_teto_pct, 10) INTO v_teto_pct FROM erp_oficina_parametros WHERE company_id = v_os.company_id;
  v_teto_pct := COALESCE(v_teto_pct, 10);
  v_teto_valor := round(v_gross * v_teto_pct / 100, 2);
  IF v_desc > v_teto_valor AND p_aprovado_por IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'precisa_aprovacao', true, 'teto_pct', v_teto_pct, 'teto_valor', v_teto_valor,
      'erro', 'Desconto acima do teto de '||to_char(v_teto_pct,'FM990.00')||'% (R$ '||to_char(v_teto_valor,'FM999999990.00')||') — precisa de aprovação de quem tem alçada.'); END IF;

  v_total_novo := GREATEST(round(v_gross - v_desc, 2), 0);
  UPDATE public.erp_os SET
    desconto_valor         = v_desc,
    desconto_percentual    = CASE WHEN v_gross > 0 THEN round(v_desc * 100 / v_gross, 4) ELSE 0 END,
    valor_servico          = CASE WHEN v_tem_itens THEN v_serv ELSE valor_servico END,
    valor_materiais        = CASE WHEN v_tem_itens THEN v_mat  ELSE valor_materiais END,
    total                  = v_total_novo,
    desconto_concedido_por = auth.uid(),
    desconto_concedido_em  = now(),
    desconto_aprovado_por  = p_aprovado_por,
    updated_at             = now()
  WHERE id = p_os_id;

  RETURN jsonb_build_object('ok', true, 'gross', v_gross, 'desconto', v_desc, 'total', v_total_novo,
    'percentual', CASE WHEN v_gross > 0 THEN round(v_desc * 100 / v_gross, 4) ELSE 0 END,
    'teto_pct', v_teto_pct, 'teto_valor', v_teto_valor, 'aprovado_por', p_aprovado_por);
END $function$;

REVOKE ALL ON FUNCTION public.fn_os_aplicar_desconto(uuid,numeric,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_os_aplicar_desconto(uuid,numeric,uuid) TO authenticated, service_role;

-- 4) FaturarOsView (lote) passa a EXIBIR o desconto (somente leitura): a linha carrega o desconto, e a
-- tela mostra bruto · desconto · a faturar. Sem campo de edição no lote — o desconto entra só na OS.
CREATE OR REPLACE FUNCTION public.fn_oficina_a_faturar(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_res jsonb; v_ve boolean;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  v_ve := is_admin() OR COALESCE(public.fn_oficina_papel(p_company_id) ~* '(OWNER|DONO|ADMIN)', false);
  WITH af AS (
    SELECT o.id AS os_id, o.numero, o.cliente_nome, o.cliente_id, o.placa, o.entregue_em,
           COALESCE(o.total, 0) AS total, COALESCE(o.desconto_valor, 0) AS desconto,
           (CURRENT_DATE - COALESCE(o.entregue_em::date, o.data_conclusao, o.created_at::date)) AS dias,
           CASE WHEN COALESCE(o.total,0) <= 0 THEN 'sem_valor'
                WHEN o.cliente_id IS NULL THEN 'sem_cliente' ELSE 'pronta' END AS situacao
    FROM erp_os o
    WHERE o.company_id = p_company_id AND o.status = 'entregue' AND o.excluida_em IS NULL
      AND NOT COALESCE(o.titulos_gerados, false) AND o.lancamento_id IS NULL
  )
  SELECT jsonb_build_object(
    'ok', true, 'restrito', NOT v_ve,
    'linhas', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'os_id', os_id, 'numero', numero, 'cliente_nome', cliente_nome, 'cliente_id', cliente_id,
        'placa', placa, 'entregue_em', entregue_em, 'dias', dias, 'situacao', situacao,
        'total', CASE WHEN v_ve THEN total ELSE NULL END,
        'desconto', CASE WHEN v_ve THEN desconto ELSE NULL END
      ) ORDER BY dias DESC NULLS LAST, total DESC) FROM af), '[]'::jsonb),
    'totais', (SELECT jsonb_build_object(
        'qtd', COUNT(*),
        'soma_total', CASE WHEN v_ve THEN COALESCE(SUM(total), 0) ELSE NULL END,
        'mais_antiga_dias', COALESCE(MAX(dias), 0),
        'prontas', COUNT(*) FILTER (WHERE situacao = 'pronta'),
        'soma_prontas', CASE WHEN v_ve THEN COALESCE(SUM(total) FILTER (WHERE situacao = 'pronta'), 0) ELSE NULL END,
        'sem_cliente', COUNT(*) FILTER (WHERE situacao = 'sem_cliente'),
        'sem_valor', COUNT(*) FILTER (WHERE situacao = 'sem_valor')
      ) FROM af)
  ) INTO v_res;
  RETURN v_res;
END $function$;

REVOKE ALL ON FUNCTION public.fn_oficina_a_faturar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_oficina_a_faturar(uuid) TO authenticated, service_role;
