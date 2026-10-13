-- OFICINA LOTE 2 · DIAGNÓSTICO TÉCNICO (laudo do mecânico). Operacional/técnico — SEM financeiro.
-- A partir da OS 'aberta' (que a Recepção criou), o mecânico registra o LAUDO estruturado:
-- causa provável + itens (serviços recomendados do tempário + peças necessárias) + severidade.
-- ADITIVO PURO: tabela nova de itens + grava resumo no erp_os.diagnostico (texto já existente).
-- 🚫 NÃO muda status (isso é do Pátio/LOTE 3), NÃO altera fn_os_salvar, NÃO mexe em estoque/financeiro.
-- RD-26: reusa erp_oficina_servicos (tempário) e o catálogo já existente (oficina_diagnostico).
-- RD-45: escopo company_id explícito.

-- 1 · itens do laudo (1 OS → N itens). Snapshot descritivo; sem preço (preço é da GE/LOTE 3+).
CREATE TABLE IF NOT EXISTS public.erp_os_diagnostico_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  os_id uuid NOT NULL REFERENCES public.erp_os(id) ON DELETE CASCADE,
  tipo text NOT NULL DEFAULT 'servico',          -- 'servico' | 'peca'
  servico_id uuid REFERENCES public.erp_oficina_servicos(id),  -- tempário (RD-26), opcional
  produto_id uuid,                               -- peça de catálogo, opcional (LOTE 6 estrutura)
  descricao text NOT NULL,                        -- o que fazer / o que trocar
  quantidade numeric NOT NULL DEFAULT 1,
  tempo_estimado_h numeric,                       -- para serviços (prefill do tempário)
  severidade text NOT NULL DEFAULT 'recomendado', -- 'critico' | 'recomendado' | 'futuro'
  observacao text,
  ordem integer NOT NULL DEFAULT 0,
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_os_diag_item_os ON public.erp_os_diagnostico_item(company_id, os_id);

ALTER TABLE public.erp_os_diagnostico_item ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_os_diag_item_all ON public.erp_os_diagnostico_item;
CREATE POLICY erp_os_diag_item_all ON public.erp_os_diagnostico_item FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- 2 · obter o laudo de uma OS (header do veículo/queixa + itens). SECURITY INVOKER (respeita RLS).
CREATE OR REPLACE FUNCTION public.fn_oficina_diagnostico_obter(p_company_id uuid, p_os_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'os', (SELECT jsonb_build_object(
             'id', o.id, 'numero', o.numero, 'status', o.status,
             'cliente_nome', o.cliente_nome, 'placa', o.placa, 'marca', o.marca,
             'modelo', o.modelo, 'ano', o.ano, 'km', o.km,
             'defeito_relatado', o.defeito_relatado, 'diagnostico', o.diagnostico)
           FROM erp_os o
           WHERE o.id = p_os_id AND o.company_id = p_company_id
             AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())),
    'itens', coalesce((SELECT jsonb_agg(jsonb_build_object(
             'id', i.id, 'tipo', i.tipo, 'servico_id', i.servico_id, 'produto_id', i.produto_id,
             'descricao', i.descricao, 'quantidade', i.quantidade, 'tempo_estimado_h', i.tempo_estimado_h,
             'severidade', i.severidade, 'observacao', i.observacao) ORDER BY i.ordem, i.created_at)
           FROM erp_os_diagnostico_item i
           WHERE i.os_id = p_os_id AND i.company_id = p_company_id), '[]'::jsonb)
  );
$$;

-- 3 · salvar o laudo: substitui os itens da OS + grava resumo no erp_os.diagnostico. Atômico.
--     NÃO altera status nem qualquer campo financeiro/estoque.
CREATE OR REPLACE FUNCTION public.fn_oficina_diagnostico_salvar(p_company_id uuid, p_os_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_item jsonb; v_n int := 0;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_os WHERE id = p_os_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS não encontrada nesta empresa');
  END IF;

  -- resumo/causa provável no campo de texto já existente (não muda status)
  UPDATE erp_os SET
    diagnostico = nullif(btrim(coalesce(p_dados->>'diagnostico','')), ''),
    km = coalesce(nullif(p_dados->>'km','')::int, km),
    updated_at = now()
  WHERE id = p_os_id AND company_id = p_company_id;

  -- estratégia replace: apaga os itens anteriores e regrava (edição do laudo)
  DELETE FROM erp_os_diagnostico_item WHERE os_id = p_os_id AND company_id = p_company_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_dados->'itens', '[]'::jsonb))
  LOOP
    IF length(btrim(coalesce(v_item->>'descricao',''))) = 0 THEN CONTINUE; END IF;  -- ignora linha vazia
    INSERT INTO erp_os_diagnostico_item (company_id, os_id, tipo, servico_id, produto_id, descricao,
      quantidade, tempo_estimado_h, severidade, observacao, ordem, criado_por)
    VALUES (p_company_id, p_os_id,
      coalesce(nullif(v_item->>'tipo',''), 'servico'),
      nullif(v_item->>'servico_id','')::uuid, nullif(v_item->>'produto_id','')::uuid,
      btrim(v_item->>'descricao'),
      coalesce(nullif(v_item->>'quantidade','')::numeric, 1),
      nullif(v_item->>'tempo_estimado_h','')::numeric,
      coalesce(nullif(v_item->>'severidade',''), 'recomendado'),
      nullif(v_item->>'observacao',''), v_n, auth.uid());
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'os_id', p_os_id, 'itens', v_n);
END $$;

GRANT EXECUTE ON FUNCTION public.fn_oficina_diagnostico_obter(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oficina_diagnostico_salvar(uuid, uuid, jsonb) TO authenticated;

-- 4 · catálogo já tem 'oficina_diagnostico' (RD-26) — só registra a tela (Screen Watcher, 'parcial' até uso real).
INSERT INTO public.system_screens (id, rota, area, modulo, titulo, estado_real)
SELECT gen_random_uuid(), '/dashboard/oficina/diagnostico', 'oficina', 'oficina_diagnostico', 'Diagnóstico Técnico', 'parcial'
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens WHERE rota='/dashboard/oficina/diagnostico');
