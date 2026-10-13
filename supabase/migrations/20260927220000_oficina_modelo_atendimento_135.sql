-- #135 (Triches) · modelo de atendimento da Oficina por empresa.
--
-- Hoje o fluxo é um só: o mecânico lança itens/quantidades no Diagnóstico e os valores só entram depois, na
-- Aprovação do Cliente — faz sentido com tablet no box. Na oficina SEM tablet, o mecânico anota no papel e a
-- atendente já sabe itens, quantidades e valores: digitar em duas telas é trabalho dobrado.
--
-- (1) erp_oficina_parametros.modelo_atendimento: 'tablet' (padrão — nada muda para quem já usa) ou
--     'centralizado' (Diagnóstico já recebe o preço; a Aprovação só mostra o valor e registra a decisão).
-- (2) fn_oficina_modelo_atendimento(company): o modelo + se ESTE usuário pode lançar preço no Diagnóstico.
--     Mesma trava de valor das telas: OFICINA_MECANICO não vê preço (fn_oficina_diagnostico_obter) e
--     CLIENT_OPERATOR não registra valor (fn_oficina_orcamento_registrar).
-- (3) fn_oficina_diagnostico_salvar: corpo idêntico ao vigente + no modo centralizado (e só p/ quem pode) grava
--     o preço UNITÁRIO do item. Item já aprovado pelo cliente NÃO tem o preço alterado aqui (o valor aprovado não
--     se move — RD-55); preço vazio mantém o atual. No modo tablet nada muda. Ganha o REVOKE anon da régua.

-- (1)
ALTER TABLE public.erp_oficina_parametros
  ADD COLUMN IF NOT EXISTS modelo_atendimento text NOT NULL DEFAULT 'tablet';
ALTER TABLE public.erp_oficina_parametros DROP CONSTRAINT IF EXISTS erp_oficina_parametros_modelo_atendimento_chk;
ALTER TABLE public.erp_oficina_parametros ADD CONSTRAINT erp_oficina_parametros_modelo_atendimento_chk
  CHECK (modelo_atendimento IN ('tablet', 'centralizado'));

-- (2)
CREATE OR REPLACE FUNCTION public.fn_oficina_modelo_atendimento(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_modelo text; v_papel text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('modelo', 'tablet', 'pode_preco', false);
  END IF;
  SELECT modelo_atendimento INTO v_modelo FROM erp_oficina_parametros WHERE company_id = p_company_id;
  v_papel := public.fn_oficina_papel(p_company_id);
  RETURN jsonb_build_object(
    'modelo', COALESCE(v_modelo, 'tablet'),
    'pode_preco', COALESCE(v_modelo, 'tablet') = 'centralizado'
                  AND COALESCE(v_papel, '') NOT IN ('OFICINA_MECANICO', 'CLIENT_OPERATOR'));
END $function$;

REVOKE ALL ON FUNCTION public.fn_oficina_modelo_atendimento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_oficina_modelo_atendimento(uuid) TO authenticated, service_role;

-- (3)
CREATE OR REPLACE FUNCTION public.fn_oficina_diagnostico_salvar(p_company_id uuid, p_os_id uuid, p_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_item jsonb; v_n int := 0; v_id uuid; v_ids uuid[] := ARRAY[]::uuid[]; v_bloqueados int := 0;
        v_prod uuid; v_custo numeric; v_pode_preco boolean; v_preco numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_os WHERE id = p_os_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada nesta empresa');
  END IF;

  -- #135 · atendimento centralizado: o Diagnóstico já recebe o preço (só p/ quem pode ver/lançar valor)
  v_pode_preco := COALESCE((public.fn_oficina_modelo_atendimento(p_company_id)->>'pode_preco')::boolean, false);

  UPDATE erp_os SET
    diagnostico = nullif(btrim(coalesce(p_dados->>'diagnostico','')), ''),
    km = coalesce(nullif(p_dados->>'km','')::int, km),
    updated_at = now()
  WHERE id = p_os_id AND company_id = p_company_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_dados->'itens', '[]'::jsonb))
  LOOP
    IF length(btrim(coalesce(v_item->>'descricao',''))) = 0 THEN CONTINUE; END IF;
    v_id := nullif(v_item->>'id','')::uuid;
    v_preco := CASE WHEN v_pode_preco THEN nullif(v_item->>'preco','')::numeric ELSE NULL END;

    -- custo do momento: só p/ peça de catálogo (tem produto_id). Lido no servidor.
    v_prod := nullif(v_item->>'produto_id','')::uuid;
    v_custo := CASE WHEN v_prod IS NOT NULL THEN (
        SELECT coalesce(ve.preco_custo_medio, ve.preco_custo)
        FROM v_erp_produtos_estoque ve
        WHERE ve.id = v_prod AND ve.company_id = p_company_id LIMIT 1
      ) ELSE NULL END;

    IF v_id IS NOT NULL THEN
      -- item existente: atualiza SÓ os campos do laudo. aprovado / aprovado_em INTOCADOS (RD-55).
      -- preco: intocado, exceto no atendimento centralizado (#135) em item ainda não aprovado com preço informado.
      -- custo_unitario capturado UMA vez (COALESCE) — snapshot não se move em re-salvar.
      UPDATE erp_os_diagnostico_item SET
        tipo             = coalesce(nullif(v_item->>'tipo',''), tipo),
        servico_id       = nullif(v_item->>'servico_id','')::uuid,
        produto_id       = v_prod,
        descricao        = btrim(v_item->>'descricao'),
        quantidade       = coalesce(nullif(v_item->>'quantidade','')::numeric, 1),
        tempo_estimado_h = nullif(v_item->>'tempo_estimado_h','')::numeric,
        severidade       = coalesce(nullif(v_item->>'severidade',''), severidade),
        observacao       = nullif(v_item->>'observacao',''),
        custo_unitario   = COALESCE(custo_unitario, v_custo),
        preco            = CASE WHEN v_preco IS NOT NULL AND aprovado IS DISTINCT FROM true THEN v_preco ELSE preco END
      WHERE id = v_id AND os_id = p_os_id AND company_id = p_company_id;
      IF FOUND THEN v_ids := array_append(v_ids, v_id); ELSE v_id := NULL; END IF;
    END IF;
    IF v_id IS NULL THEN
      -- item novo: entra pendente (aprovado nulo) — precisa de nova aprovação só dele (FIX 3).
      -- preco nulo, exceto no atendimento centralizado (#135), onde já vem do Diagnóstico.
      INSERT INTO erp_os_diagnostico_item (company_id, os_id, tipo, servico_id, produto_id, descricao,
        quantidade, tempo_estimado_h, severidade, observacao, custo_unitario, ordem, criado_por, preco)
      VALUES (p_company_id, p_os_id, coalesce(nullif(v_item->>'tipo',''), 'servico'),
        nullif(v_item->>'servico_id','')::uuid, v_prod, btrim(v_item->>'descricao'),
        coalesce(nullif(v_item->>'quantidade','')::numeric, 1), nullif(v_item->>'tempo_estimado_h','')::numeric,
        coalesce(nullif(v_item->>'severidade',''), 'recomendado'), nullif(v_item->>'observacao',''), v_custo, v_n, auth.uid(), v_preco)
      RETURNING id INTO v_id;
      v_ids := array_append(v_ids, v_id);
    END IF;
    v_n := v_n + 1;
  END LOOP;

  -- Itens removidos da lista que JÁ foram pra cotação/apontamento: não deletar, contar p/ avisar.
  SELECT count(*) INTO v_bloqueados
  FROM erp_os_diagnostico_item d
  WHERE d.os_id = p_os_id AND d.company_id = p_company_id AND NOT (d.id = ANY(v_ids))
    AND ( EXISTS (SELECT 1 FROM erp_cotacoes_itens ci WHERE ci.origem_diag_item_id = d.id)
       OR EXISTS (SELECT 1 FROM erp_os_apontamento ap WHERE ap.diagnostico_item_id = d.id) );

  -- Deleta os removidos que NÃO têm referência a jusante (inclusive aprovados — é só laudo).
  DELETE FROM erp_os_diagnostico_item d
  WHERE d.os_id = p_os_id AND d.company_id = p_company_id AND NOT (d.id = ANY(v_ids))
    AND NOT ( EXISTS (SELECT 1 FROM erp_cotacoes_itens ci WHERE ci.origem_diag_item_id = d.id)
           OR EXISTS (SELECT 1 FROM erp_os_apontamento ap WHERE ap.diagnostico_item_id = d.id) );

  RETURN jsonb_build_object('ok', true, 'os_id', p_os_id, 'itens', v_n, 'nao_removidos', v_bloqueados);
END $function$;

REVOKE ALL ON FUNCTION public.fn_oficina_diagnostico_salvar(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_oficina_diagnostico_salvar(uuid, uuid, jsonb) TO authenticated, service_role;
