-- Hub · /dashboard/projetos/tabelas-preco — RD-98 pilar 4 (exclusão rastreável) para a FAIXA/serviço do contrato.
-- CEO 27/10 (DELTA aud8 tabela-preço nota 68, item 4). Code: desenvolvedor_4_g
--
-- A exclusão de MEDIÇÃO já virou soft-delete (20261028110052). Faltava a FAIXA (erp_tabela_preco_item), que ainda
-- era DELETE físico — some do banco sem autor nem trilha. Esta PR fecha o pilar 4 da tela: excluir uma faixa passa
-- a ser soft-delete (deleted_at + deleted_by) com registro em audit_log_global, e TODOS os leitores de precificação
-- e viagem passam a ignorar faixas excluídas.
--
-- Segurança/regressão (RD-38): o filtro `deleted_at IS NULL` é NO-OP sobre os dados atuais — logo após o ALTER toda
-- linha tem deleted_at = NULL, então cálculo, orçamento, saldo e indicadores de viagem continuam IDÊNTICOS. A única
-- mudança de comportamento é que exclusões futuras preservam o registro (reversível/auditável) em vez de apagá-lo.
-- Leitores tocados (6): fn_tabela_preco_calcular, fn_tabela_preco_faixa_salvar (checagem de sobreposição),
-- fn_orcamento_contrato_servicos, fn_tabela_preco_vinculo_gravar, fn_tabela_preco_codigo_salvar, fn_viagem_indicadores.
-- Cada corpo abaixo é a definição VIVA (pg_get_functiondef em 27/10) com a ÚNICA diferença sendo o filtro de exclusão.

-- 1) Colunas de soft-delete na faixa/serviço do contrato
ALTER TABLE public.erp_tabela_preco_item
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- 2) Exclusão rastreável da FAIXA (soft-delete + audit). Nunca DELETE físico. Idempotente.
CREATE OR REPLACE FUNCTION public.fn_tabela_preco_faixa_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_ref text; v_nome text; v_de numeric; v_ate numeric; v_preco numeric;
BEGIN
  SELECT company_id, servico_ref, servico_nome, faixa_de, faixa_ate, preco_base
    INTO v_company, v_ref, v_nome, v_de, v_ate, v_preco
    FROM public.erp_tabela_preco_item WHERE id = p_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN
    -- já excluída (idempotente) ou inexistente: não é erro para o fluxo da tela
    IF EXISTS (SELECT 1 FROM public.erp_tabela_preco_item WHERE id = p_id) THEN
      RETURN jsonb_build_object('ok', true);
    END IF;
    RAISE EXCEPTION 'Faixa não encontrada';
  END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  UPDATE public.erp_tabela_preco_item
     SET deleted_at = now(), deleted_by = auth.uid()
   WHERE id = p_id AND company_id = v_company;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), 'erp_tabela_preco_item', p_id, 'excluir',
            jsonb_build_object('servico_ref', v_ref, 'servico_nome', v_nome, 'faixa_de', v_de, 'faixa_ate', v_ate, 'preco_base', v_preco, 'deleted_at', NULL),
            jsonb_build_object('servico_ref', v_ref, 'servico_nome', v_nome, 'faixa_de', v_de, 'faixa_ate', v_ate, 'preco_base', v_preco, 'deleted_at', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_tabela_preco_faixa_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_faixa_excluir(uuid) TO authenticated, service_role;

-- 3) Cálculo do preço ignora faixa excluída (resto do corpo IDÊNTICO à definição viva)
CREATE OR REPLACE FUNCTION public.fn_tabela_preco_calcular(p_tabela uuid, p_servico_ref text, p_quantidade numeric, p_condicao text DEFAULT 'normal'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item record; v_pct numeric; v_fixo numeric; v_cod text; v_exato numeric; v_preco numeric;
  v_cond text := coalesce(nullif(btrim(p_condicao),''),'normal');
BEGIN
  IF p_quantidade IS NULL OR p_quantidade < 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'quantidade inválida');
  END IF;
  SELECT i.* INTO v_item FROM erp_tabela_preco_item i
   WHERE i.tabela_id = p_tabela AND i.servico_ref = p_servico_ref AND NOT i.adicional
     AND i.deleted_at IS NULL
     AND p_quantidade >= i.faixa_de AND (i.faixa_ate IS NULL OR p_quantidade < i.faixa_ate)
   ORDER BY i.faixa_de LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'serviço sem faixa para a quantidade ou tabela não encontrada');
  END IF;
  SELECT c.percentual INTO v_pct FROM erp_tabela_preco_condicao c WHERE c.tabela_id = p_tabela AND c.condicao = v_cond;
  SELECT k.preco_fixo, k.codigo_externo INTO v_fixo, v_cod FROM erp_tabela_preco_codigo k
   WHERE k.tabela_id = p_tabela AND k.servico_ref = p_servico_ref AND k.condicao = v_cond;
  -- (a) 'normal' é o preço base; qualquer outra condição precisa existir na tabela (percentual ou código/preço fixo)
  IF v_cond <> 'normal' AND v_pct IS NULL AND v_fixo IS NULL AND v_cod IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'condição "' || v_cond || '" não existe nesta tabela de preço');
  END IF;
  v_exato := CASE WHEN v_fixo IS NOT NULL THEN v_fixo ELSE v_item.preco_base * (1 + coalesce(v_pct, 0) / 100) END;
  v_preco := round(v_exato, 2);
  RETURN jsonb_build_object('ok', true, 'servico_ref', p_servico_ref, 'unidade', v_item.unidade,
    'faixa_de', v_item.faixa_de, 'faixa_ate', v_item.faixa_ate, 'preco_base', v_item.preco_base,
    'condicao', v_cond, 'percentual', v_pct, 'preco_fixo', v_fixo, 'preco_unitario', v_preco,
    'total', round(v_exato * p_quantidade, 2), 'codigo_externo', v_cod);
END $function$;

-- 4) Salvar faixa: a checagem de sobreposição ignora faixas excluídas (permite recriar o range de uma excluída)
CREATE OR REPLACE FUNCTION public.fn_tabela_preco_faixa_salvar(p_tabela_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_ref text := btrim(coalesce(p_dados->>'servico_ref',''));
  v_de numeric := COALESCE((p_dados->>'faixa_de')::numeric, 0); v_ate numeric := NULLIF(p_dados->>'faixa_ate','')::numeric;
  v_preco numeric := (p_dados->>'preco_base')::numeric; v_id uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.erp_tabela_preco_cliente WHERE id = p_tabela_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Tabela não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF v_ref = '' OR btrim(coalesce(p_dados->>'servico_nome','')) = '' OR btrim(coalesce(p_dados->>'unidade','')) = '' THEN
    RAISE EXCEPTION 'Informe serviço, nome e unidade'; END IF;
  IF v_preco IS NULL OR v_preco < 0 THEN RAISE EXCEPTION 'Preço inválido'; END IF;
  IF v_de < 0 OR (v_ate IS NOT NULL AND v_ate <= v_de) THEN RAISE EXCEPTION 'Faixa inválida: o fim deve ser maior que o início'; END IF;
  -- faixas do mesmo serviço não podem se sobrepor ([de, ate) como no cálculo); faixa excluída não conta
  IF EXISTS (SELECT 1 FROM public.erp_tabela_preco_item i
              WHERE i.tabela_id = p_tabela_id AND i.servico_ref = v_ref AND NOT i.adicional
                AND i.deleted_at IS NULL
                AND i.id IS DISTINCT FROM NULLIF(p_dados->>'id','')::uuid
                AND v_de < COALESCE(i.faixa_ate, 'Infinity'::numeric) AND i.faixa_de < COALESCE(v_ate, 'Infinity'::numeric)) THEN
    RAISE EXCEPTION 'Esta faixa se sobrepõe a outra do mesmo serviço'; END IF;
  v_id := NULLIF(p_dados->>'id','')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO public.erp_tabela_preco_item (company_id, tabela_id, servico_ref, servico_nome, unidade, faixa_de, faixa_ate, preco_base)
    VALUES (v_company, p_tabela_id, v_ref, btrim(p_dados->>'servico_nome'), btrim(p_dados->>'unidade'), v_de, v_ate, v_preco) RETURNING id INTO v_id;
  ELSE
    UPDATE public.erp_tabela_preco_item SET servico_nome = btrim(p_dados->>'servico_nome'), unidade = btrim(p_dados->>'unidade'),
      faixa_de = v_de, faixa_ate = v_ate, preco_base = v_preco
     WHERE id = v_id AND tabela_id = p_tabela_id AND company_id = v_company AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Faixa não encontrada'; END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

REVOKE ALL ON FUNCTION public.fn_tabela_preco_faixa_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_faixa_salvar(uuid, jsonb) TO authenticated, service_role;

-- 5) Serviços do contrato para o orçamento ignoram faixas excluídas
CREATE OR REPLACE FUNCTION public.fn_orcamento_contrato_servicos(p_orcamento uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_co uuid; v_cli uuid; v_tab record; v_out jsonb; v_cond jsonb;
BEGIN
  SELECT company_id, cliente_id INTO v_co, v_cli FROM erp_orcamentos WHERE id = p_orcamento;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Orçamento não encontrado'; END IF;
  PERFORM public.fn__guarda_empresa(v_co);
  IF v_cli IS NULL THEN RETURN jsonb_build_object('ok', true, 'tabela_id', NULL, 'servicos', '[]'::jsonb); END IF;
  SELECT t.id, t.nome INTO v_tab FROM erp_tabela_preco_cliente t
   WHERE t.company_id = v_co AND t.cliente_id = v_cli AND t.ativo
     AND t.vigencia_inicio <= current_date AND (t.vigencia_fim IS NULL OR t.vigencia_fim >= current_date)
   ORDER BY t.vigencia_inicio DESC LIMIT 1;
  IF v_tab.id IS NULL THEN RETURN jsonb_build_object('ok', true, 'tabela_id', NULL, 'servicos', '[]'::jsonb); END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'servico_ref'), '[]'::jsonb) INTO v_out FROM (
    SELECT DISTINCT ON (i.servico_ref) jsonb_build_object('servico_ref', i.servico_ref, 'nome', i.servico_nome, 'unidade', i.unidade) AS x
      FROM erp_tabela_preco_item i WHERE i.tabela_id = v_tab.id AND NOT i.adicional AND i.deleted_at IS NULL ORDER BY i.servico_ref, i.faixa_de) s;
  SELECT coalesce(jsonb_agg(c ORDER BY c), '[]'::jsonb) INTO v_cond FROM (
    SELECT condicao AS c FROM erp_tabela_preco_condicao WHERE tabela_id = v_tab.id
    UNION SELECT condicao FROM erp_tabela_preco_codigo WHERE tabela_id = v_tab.id AND condicao <> 'normal') q;
  RETURN jsonb_build_object('ok', true, 'tabela_id', v_tab.id, 'tabela_nome', v_tab.nome, 'servicos', v_out, 'condicoes', v_cond);
END $function$;

REVOKE ALL ON FUNCTION public.fn_orcamento_contrato_servicos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_orcamento_contrato_servicos(uuid) TO authenticated, service_role;

-- 6) Vínculo com o catálogo: o serviço precisa existir e não estar excluído
CREATE OR REPLACE FUNCTION public.fn_tabela_preco_vinculo_gravar(p_tabela uuid, p_servico_ref text, p_catalogo uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_co uuid;
BEGIN
  SELECT company_id INTO v_co FROM erp_tabela_preco_cliente WHERE id = p_tabela;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;
  PERFORM public.fn__guarda_empresa(v_co);
  IF btrim(coalesce(p_servico_ref,'')) = '' THEN RAISE EXCEPTION 'Informe o serviço'; END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_tabela_preco_item WHERE tabela_id = p_tabela AND servico_ref = p_servico_ref AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Serviço não existe neste contrato';
  END IF;
  IF p_catalogo IS NULL THEN
    DELETE FROM erp_tabela_preco_vinculo WHERE tabela_id = p_tabela AND servico_ref = p_servico_ref;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM projetos_servicos WHERE id = p_catalogo AND ativo AND (company_id = v_co OR is_publico)) THEN
      RAISE EXCEPTION 'Serviço do catálogo não encontrado';
    END IF;
    INSERT INTO erp_tabela_preco_vinculo (company_id, tabela_id, servico_ref, catalogo_servico_id)
    VALUES (v_co, p_tabela, p_servico_ref, p_catalogo)
    ON CONFLICT (tabela_id, servico_ref) DO UPDATE SET catalogo_servico_id = EXCLUDED.catalogo_servico_id, atualizado_em = now();
  END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_tabela_preco_vinculo_gravar(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_vinculo_gravar(uuid, text, uuid) TO authenticated, service_role;

-- 7) Código no cliente (de-para): o serviço precisa existir e não estar excluído
CREATE OR REPLACE FUNCTION public.fn_tabela_preco_codigo_salvar(p_tabela_id uuid, p_servico_ref text, p_condicao text, p_codigo text, p_preco_fixo numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_c text := COALESCE(NULLIF(btrim(p_condicao),''),'normal');
BEGIN
  SELECT company_id INTO v_company FROM public.erp_tabela_preco_cliente WHERE id = p_tabela_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Tabela não encontrada'; END IF;
  PERFORM public.fn__guarda_empresa(v_company);
  IF NOT EXISTS (SELECT 1 FROM public.erp_tabela_preco_item WHERE tabela_id = p_tabela_id AND servico_ref = p_servico_ref AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Serviço não está na tabela'; END IF;
  IF btrim(coalesce(p_codigo,'')) = '' THEN
    DELETE FROM public.erp_tabela_preco_codigo WHERE tabela_id = p_tabela_id AND servico_ref = p_servico_ref AND condicao = v_c;
  ELSE
    UPDATE public.erp_tabela_preco_codigo SET codigo_externo = btrim(p_codigo), preco_fixo = p_preco_fixo
     WHERE tabela_id = p_tabela_id AND servico_ref = p_servico_ref AND condicao = v_c;
    IF NOT FOUND THEN
      INSERT INTO public.erp_tabela_preco_codigo (company_id, tabela_id, servico_ref, condicao, codigo_externo, preco_fixo)
      VALUES (v_company, p_tabela_id, p_servico_ref, v_c, btrim(p_codigo), p_preco_fixo);
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_tabela_preco_codigo_salvar(uuid, text, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_codigo_salvar(uuid, text, text, text, numeric) TO authenticated, service_role;

-- 8) Indicadores de viagem (GE): o preço de mobilização do contrato ignora faixa excluída
--    (corpo IDÊNTICO à definição viva; única diferença = `AND mi.deleted_at IS NULL` no LATERAL de mobilização)
CREATE OR REPLACE FUNCTION public.fn_viagem_indicadores(p_company_id uuid, p_obra_id uuid DEFAULT NULL::uuid, p_limite_pct numeric DEFAULT 5)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH vg AS (
    SELECT v.id, v.company_id, v.status, v.periodo_inicio,
           btrim(COALESCE(v.origem, '')) AS origem, btrim(COALESCE(v.destino, '')) AS destino,
           (v.periodo_fim - v.periodo_inicio + 1) AS dias,
           CASE WHEN v.km_inicial IS NOT NULL AND v.km_final IS NOT NULL AND v.km_final >= v.km_inicial
                THEN v.km_final - v.km_inicial END AS km
      FROM public.erp_viagem v
     WHERE v.company_id = p_company_id AND v.excluido_em IS NULL AND v.status <> 'cancelada'
  ),
  co AS (
    SELECT c.viagem_id, c.obra_id, c.custo_total,
           sum(c.custo_total) OVER (PARTITION BY c.viagem_id) AS custo_viagem
      FROM public.v_viagem_custo_obra c JOIN vg ON vg.id = c.viagem_id
  ),
  parte AS (
    SELECT co.obra_id, co.viagem_id, co.custo_total, vg.km, vg.dias,
           CASE WHEN co.custo_viagem > 0 THEN co.custo_total / co.custo_viagem ELSE 0 END AS fator
      FROM co JOIN vg ON vg.id = co.viagem_id
  ),
  obra AS (
    SELECT p.obra_id,
           count(DISTINCT p.viagem_id) AS viagens,
           round(sum(p.custo_total), 2) AS custo_viagens,
           round(sum(p.km * p.fator), 1) AS km_atribuido,
           round(sum(p.custo_total) FILTER (WHERE p.km IS NOT NULL), 2) AS custo_com_km,
           round(sum(p.dias * p.fator), 2) AS dias_atribuidos
      FROM parte p
     GROUP BY p.obra_id
  ),
  m2 AS (
    SELECT i.obra_id, sum(i.quantidade_medida) AS m2_executado
      FROM public.projetos_obra_item i
     WHERE i.company_id = p_company_id AND i.excluido_em IS NULL AND lower(btrim(COALESCE(i.unidade, ''))) IN ('m2', 'm²')
     GROUP BY i.obra_id
  ),
  ind AS (
    SELECT o.id AS obra_id, o.numero, o.nome,
           ob.viagens, ob.custo_viagens, ob.km_atribuido, ob.dias_atribuidos,
           COALESCE(m2.m2_executado, 0) AS m2_executado,
           COALESCE(r.custo_previsto, 0) AS custo_orcado,
           COALESCE(r.custo_viagens, 0) AS custo_no_resultado,
           CASE WHEN m2.m2_executado > 0 THEN round(ob.custo_viagens / m2.m2_executado, 2) END AS custo_m2,
           CASE WHEN ob.km_atribuido > 0 THEN round(ob.custo_com_km / ob.km_atribuido, 2) END AS custo_km,
           CASE WHEN ob.dias_atribuidos > 0 THEN round(ob.custo_viagens / ob.dias_atribuidos, 2) END AS custo_dia,
           CASE WHEN r.custo_previsto > 0 THEN round(ob.custo_viagens * 100 / r.custo_previsto, 2) END AS pct_orcado,
           mob.preco AS preco_mobilizacao, mob.tabela_nome AS mobilizacao_tabela,
           CASE WHEN mob.preco > 0 THEN round(ob.custo_viagens * 100 / mob.preco, 1) END AS mobilizacao_pct,
           CASE WHEN mob.preco IS NOT NULL THEN COALESCE(ob.custo_viagens > mob.preco, false) END AS mobilizacao_alerta
      FROM obra ob
      JOIN public.projetos_obras o ON o.id = ob.obra_id AND o.company_id = p_company_id
      LEFT JOIN m2 ON m2.obra_id = ob.obra_id
      LEFT JOIN public.v_obra_resultado r ON r.obra_id = ob.obra_id
      -- preço de mobilização do contrato ATIVO e VIGENTE do cliente da obra (verba; a linha cujo serviço fala em
      -- "mobiliza…"). Band base (menor faixa) quando houver faixas. Não inventa quando o cliente não tem a linha.
      LEFT JOIN LATERAL (
        SELECT round(mi.preco_base, 2) AS preco, t.nome AS tabela_nome
          FROM public.erp_tabela_preco_cliente t
          JOIN public.erp_tabela_preco_item mi ON mi.tabela_id = t.id
         WHERE t.company_id = p_company_id AND o.cliente_id IS NOT NULL AND t.cliente_id = o.cliente_id
           AND t.ativo
           AND (t.vigencia_inicio IS NULL OR t.vigencia_inicio <= CURRENT_DATE)
           AND (t.vigencia_fim IS NULL OR t.vigencia_fim >= CURRENT_DATE)
           AND mi.deleted_at IS NULL
           AND (mi.servico_nome ILIKE '%mobiliza%' OR mi.servico_ref ILIKE '%mobiliza%')
         ORDER BY t.vigencia_inicio DESC NULLS LAST, mi.faixa_de ASC NULLS FIRST, mi.preco_base ASC
         LIMIT 1
      ) mob ON true
     WHERE p_obra_id IS NULL OR ob.obra_id = p_obra_id
  ),
  rota AS (
    SELECT vg.origem, vg.destino,
           count(*) AS viagens,
           round(avg(t.custo), 2) AS custo_medio,
           round(avg(vg.km), 1) AS km_medio,
           round(avg(vg.dias), 1) AS dias_medio,
           CASE WHEN sum(vg.km) > 0 THEN round(sum(t.custo) FILTER (WHERE vg.km IS NOT NULL) / sum(vg.km), 2) END AS custo_km,
           round(sum(t.custo) / sum(vg.dias), 2) AS custo_dia,
           max(vg.periodo_inicio) AS ultima
      FROM vg
      JOIN (SELECT viagem_id, sum(custo_total) AS custo FROM co GROUP BY viagem_id) t ON t.viagem_id = vg.id
     WHERE vg.status = 'fechada' AND vg.origem <> '' AND vg.destino <> ''
       AND (p_obra_id IS NULL OR EXISTS (SELECT 1 FROM co WHERE co.viagem_id = vg.id AND co.obra_id = p_obra_id))
     GROUP BY vg.origem, vg.destino
  )
  SELECT jsonb_build_object(
    'company_id', p_company_id, 'obra_id', p_obra_id, 'limite_pct', COALESCE(p_limite_pct, 5),
    'obras', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'obra_id', i.obra_id, 'numero', i.numero, 'nome', i.nome, 'viagens', i.viagens,
        'custo_viagens', i.custo_viagens, 'custo_no_resultado', i.custo_no_resultado,
        'confere', i.custo_viagens = i.custo_no_resultado,
        'm2_executado', i.m2_executado, 'custo_m2', i.custo_m2,
        'km_atribuido', i.km_atribuido, 'custo_km', i.custo_km,
        'dias_equipe', i.dias_atribuidos, 'custo_dia', i.custo_dia,
        'custo_orcado', i.custo_orcado, 'pct_orcado', i.pct_orcado,
        'preco_mobilizacao', i.preco_mobilizacao, 'mobilizacao_tabela', i.mobilizacao_tabela,
        'mobilizacao_pct', i.mobilizacao_pct, 'mobilizacao_alerta', i.mobilizacao_alerta,
        'alerta', COALESCE(i.pct_orcado > COALESCE(p_limite_pct, 5), false))
      ORDER BY i.pct_orcado DESC NULLS LAST, i.custo_viagens DESC) FROM ind i), '[]'::jsonb),
    'rotas', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'origem', r.origem, 'destino', r.destino, 'viagens', r.viagens, 'custo_medio', r.custo_medio,
        'km_medio', r.km_medio, 'dias_medio', r.dias_medio, 'custo_km', r.custo_km, 'custo_dia', r.custo_dia,
        'ultima', r.ultima) ORDER BY r.viagens DESC, r.ultima DESC) FROM rota r), '[]'::jsonb),
    'alertas', COALESCE((SELECT count(*) FROM ind i WHERE i.pct_orcado > COALESCE(p_limite_pct, 5)), 0),
    'mobilizacao_alertas', COALESCE((SELECT count(*) FROM ind i WHERE i.mobilizacao_alerta), 0),
    'confere', COALESCE((SELECT bool_and(i.custo_viagens = i.custo_no_resultado) FROM ind i), true)
  )
$function$;

-- 9) RD-95: "?" da ação de excluir faixa (texto no banco; reversível/rastreável)
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, status)
VALUES (
  'hub.tabela_preco.faixa_excluir', '/dashboard/projetos/tabelas-preco', 'Contrato de preços', 'hub_projetos', 337,
  'Excluir faixa',
  'Nada a preencher: é a ação de remover esta faixa de preço do contrato.',
  'Tira a faixa do contrato e do cálculo. A exclusão é rastreável: o registro não é apagado do banco — fica guardado com quem excluiu e quando (trilha de auditoria), e some das listas, do cálculo, do orçamento e do saldo. Serve para corrigir uma faixa cadastrada por engano sem perder o histórico.',
  'Cadastrou "0 a 100 m²" com o preço errado e já criou a faixa certa: exclua a errada — ela sai do cálculo na hora.',
  'Confundir com editar: para só mudar o preço ou os limites, use Editar; Excluir remove a faixa inteira do contrato.',
  'publicado')
ON CONFLICT (chave) DO NOTHING;
