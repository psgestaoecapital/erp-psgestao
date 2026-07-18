-- OFICINA LOTE 4 · APONTAMENTO DO MECÂNICO 💎 (tempo real por serviço). O de maior valor:
-- captura tempo_real_h vs tempo_previsto_h → margem operacional REAL (em horas) + alimenta o
-- sink dormente erp_oficina_servico_execucao (hoje 0 linhas, sem consumidor — ativação aditiva).
-- Trabalha sobre os SERVIÇOS APROVADOS do laudo (LOTE 3). Iniciar/Concluir (relógio real) ou manual.
-- 🚫 SEM R$/preço/financeiro — margem aqui é em HORAS. O custo-hora/margem em dinheiro é o elo com
--    a GE (usa fn_oficina_custo_hora/preco_*), fica pra lote sob validação do CEO.
-- 🚫 NÃO muda status da OS, NÃO altera fn_os_salvar, NÃO recalcula o tempário (aprendizado = depois).
-- RD-45 escopo company_id. RD-26 reusa erp_oficina_servico_execucao (sink já projetado) e o tempário.

-- 1 · apontamento por item de serviço aprovado (funciona p/ item com ou sem servico_id do tempário).
CREATE TABLE IF NOT EXISTS public.erp_os_apontamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  os_id uuid NOT NULL REFERENCES public.erp_os(id) ON DELETE CASCADE,
  diagnostico_item_id uuid REFERENCES public.erp_os_diagnostico_item(id) ON DELETE SET NULL,
  servico_id uuid,                 -- tempário, quando o item mapeia (alimenta a execucao/aprendizado)
  descricao text NOT NULL,         -- snapshot do serviço
  mecanico_id uuid DEFAULT auth.uid(),
  mecanico_nome text,
  tempo_estimado_h numeric,        -- do laudo (previsto)
  tempo_real_h numeric,            -- medido (relógio) ou manual
  iniciado_em timestamptz,
  finalizado_em timestamptz,
  status text NOT NULL DEFAULT 'em_andamento',  -- 'em_andamento' | 'concluido'
  execucao_id uuid,                -- FK lógica p/ erp_oficina_servico_execucao (quando gravada)
  observacao text,
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_os_apont_os ON public.erp_os_apontamento(company_id, os_id);
CREATE INDEX IF NOT EXISTS ix_os_apont_item ON public.erp_os_apontamento(diagnostico_item_id);

ALTER TABLE public.erp_os_apontamento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_os_apont_all ON public.erp_os_apontamento;
CREATE POLICY erp_os_apont_all ON public.erp_os_apontamento FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- 2 · obter: OS + serviços APROVADOS do laudo com o apontamento vigente (previsto×real). INVOKER.
CREATE OR REPLACE FUNCTION public.fn_oficina_apontamento_obter(p_company_id uuid, p_os_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'os', (SELECT jsonb_build_object('id', o.id, 'numero', o.numero, 'status', o.status,
             'cliente_nome', o.cliente_nome, 'placa', o.placa, 'marca', o.marca, 'modelo', o.modelo)
           FROM erp_os o WHERE o.id = p_os_id AND o.company_id = p_company_id
             AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())),
    'itens', coalesce((SELECT jsonb_agg(jsonb_build_object(
             'item_id', i.id, 'servico_id', i.servico_id, 'descricao', i.descricao,
             'tempo_estimado_h', i.tempo_estimado_h, 'severidade', i.severidade,
             'apontamento', (SELECT jsonb_build_object('id', a.id, 'status', a.status,
                    'tempo_real_h', a.tempo_real_h, 'iniciado_em', a.iniciado_em,
                    'finalizado_em', a.finalizado_em, 'mecanico_nome', a.mecanico_nome)
                  FROM erp_os_apontamento a
                  WHERE a.diagnostico_item_id = i.id AND a.company_id = p_company_id
                  ORDER BY a.created_at DESC LIMIT 1))
             ORDER BY i.ordem, i.created_at)
           FROM erp_os_diagnostico_item i
           WHERE i.os_id = p_os_id AND i.company_id = p_company_id
             AND i.tipo = 'servico' AND i.aprovado IS TRUE), '[]'::jsonb)
  );
$$;

-- 3 · iniciar: abre (ou reabre) o apontamento de um item aprovado. Idempotente (reusa o aberto).
CREATE OR REPLACE FUNCTION public.fn_oficina_apontamento_iniciar(
  p_company_id uuid, p_os_id uuid, p_item_id uuid, p_mecanico_nome text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_item record; v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  SELECT i.id, i.descricao, i.servico_id, i.tempo_estimado_h, i.aprovado INTO v_item
    FROM erp_os_diagnostico_item i
    WHERE i.id = p_item_id AND i.os_id = p_os_id AND i.company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'item nao encontrado nesta OS'); END IF;
  IF v_item.aprovado IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'item nao foi aprovado pelo cliente');
  END IF;
  -- reaproveita apontamento aberto do item, se existir
  SELECT id INTO v_id FROM erp_os_apontamento
    WHERE diagnostico_item_id = p_item_id AND company_id = p_company_id AND status = 'em_andamento'
    ORDER BY created_at DESC LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'apontamento_id', v_id, 'reaberto', true); END IF;
  INSERT INTO erp_os_apontamento (company_id, os_id, diagnostico_item_id, servico_id, descricao,
    mecanico_id, mecanico_nome, tempo_estimado_h, iniciado_em, status)
  VALUES (p_company_id, p_os_id, p_item_id, v_item.servico_id, v_item.descricao,
    auth.uid(), nullif(btrim(coalesce(p_mecanico_nome,'')),''), v_item.tempo_estimado_h, now(), 'em_andamento')
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'apontamento_id', v_id, 'reaberto', false);
END $$;

-- 4 · concluir: fecha o apontamento. tempo_real = override manual OU horas decorridas (iniciado→agora).
--     Se o serviço tem servico_id do tempário, grava a execucao (sink de margem real). Atômico.
CREATE OR REPLACE FUNCTION public.fn_oficina_apontamento_concluir(
  p_company_id uuid, p_apontamento_id uuid, p_tempo_real_h numeric DEFAULT NULL,
  p_mecanico_nome text DEFAULT NULL, p_observacao text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_a record; v_real numeric; v_exec uuid; v_modelo text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  SELECT * INTO v_a FROM erp_os_apontamento
    WHERE id = p_apontamento_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'apontamento nao encontrado'); END IF;

  -- tempo real: manual tem prioridade; senão calcula pelas horas decorridas desde o início
  v_real := coalesce(p_tempo_real_h,
             CASE WHEN v_a.iniciado_em IS NOT NULL
                  THEN round(EXTRACT(EPOCH FROM (now() - v_a.iniciado_em))/3600.0, 2)
                  ELSE v_a.tempo_real_h END);

  UPDATE erp_os_apontamento SET
    tempo_real_h = v_real,
    finalizado_em = now(),
    status = 'concluido',
    mecanico_nome = coalesce(nullif(btrim(coalesce(p_mecanico_nome,'')),''), mecanico_nome),
    observacao = coalesce(nullif(btrim(coalesce(p_observacao,'')),''), observacao)
  WHERE id = p_apontamento_id AND company_id = p_company_id;

  -- alimenta o sink do tempário SÓ quando há serviço de catálogo (servico_id NOT NULL na execucao)
  IF v_a.servico_id IS NOT NULL AND v_a.execucao_id IS NULL THEN
    SELECT (marca || ' ' || coalesce(modelo,''))::text INTO v_modelo FROM erp_os WHERE id = v_a.os_id;
    INSERT INTO erp_oficina_servico_execucao (company_id, servico_id, os_id, mecanico_id,
      tempo_previsto_h, tempo_real_h, veiculo_modelo)
    VALUES (p_company_id, v_a.servico_id, v_a.os_id, v_a.mecanico_id,
      v_a.tempo_estimado_h, v_real, nullif(btrim(coalesce(v_modelo,'')),''))
    RETURNING id INTO v_exec;
    UPDATE erp_os_apontamento SET execucao_id = v_exec WHERE id = p_apontamento_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'apontamento_id', p_apontamento_id,
    'tempo_real_h', v_real, 'execucao_gravada', (v_exec IS NOT NULL));
END $$;

GRANT EXECUTE ON FUNCTION public.fn_oficina_apontamento_obter(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oficina_apontamento_iniciar(uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oficina_apontamento_concluir(uuid, uuid, numeric, text, text) TO authenticated;

-- 5 · catálogo já tem 'oficina_apontamento_mecanico' (RD-26) — só registra a tela ('parcial').
INSERT INTO public.system_screens (id, rota, area, modulo, titulo, estado_real)
SELECT gen_random_uuid(), '/dashboard/oficina/apontamento', 'oficina', 'oficina_apontamento_mecanico', 'Apontamento Mecânico', 'parcial'
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens WHERE rota='/dashboard/oficina/apontamento');
