-- OFICINA LOTE 3 · APROVAÇÃO DO CLIENTE (go/no-go do laudo). Operacional — SEM preço/financeiro.
-- O cliente autoriza QUAIS itens do laudo (LOTE 2) serão feitos. Vira a lista de trabalho do
-- Apontamento (LOTE 4). O orçamento MONETÁRIO (elo com a GE) é deliberadamente adiado p/ lote
-- sob validação do CEO — aqui é só a decisão de ESCOPO (o que fazer / não fazer).
-- ADITIVO PURO: novas colunas de decisão nos itens do laudo + tabela de evento de aprovação.
-- 🚫 NÃO muda status da OS (Pátio faz isso), NÃO toca fn_os_salvar/estoque/financeiro/preço.
-- RD-26: reusa o catálogo existente oficina_aprovacao_cliente. RD-45: escopo company_id.

-- 1 · decisão por item (null=pendente · true=aprovado · false=recusado) — colunas aditivas.
ALTER TABLE public.erp_os_diagnostico_item ADD COLUMN IF NOT EXISTS aprovado boolean;
ALTER TABLE public.erp_os_diagnostico_item ADD COLUMN IF NOT EXISTS aprovado_em timestamptz;

-- 2 · evento de aprovação (quem autorizou, por qual canal, quando). Sem valores monetários.
CREATE TABLE IF NOT EXISTS public.erp_os_aprovacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  os_id uuid NOT NULL REFERENCES public.erp_os(id) ON DELETE CASCADE,
  decisao text NOT NULL DEFAULT 'aprovado',   -- 'aprovado' | 'parcial' | 'recusado'
  aprovador_nome text,
  canal text,                                  -- 'presencial' | 'whatsapp' | 'telefone' | 'email'
  assinatura text,                             -- base64 opcional (não colide c/ assinatura de conclusão da OS)
  observacao text,
  itens_aprovados integer NOT NULL DEFAULT 0,
  itens_total integer NOT NULL DEFAULT 0,
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_os_aprovacao_os ON public.erp_os_aprovacao(company_id, os_id);

ALTER TABLE public.erp_os_aprovacao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_os_aprovacao_all ON public.erp_os_aprovacao;
CREATE POLICY erp_os_aprovacao_all ON public.erp_os_aprovacao FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

-- 3 · obter: header da OS + itens do laudo (com decisão) + última aprovação. SECURITY INVOKER.
CREATE OR REPLACE FUNCTION public.fn_oficina_aprovacao_obter(p_company_id uuid, p_os_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'os', (SELECT jsonb_build_object('id', o.id, 'numero', o.numero, 'status', o.status,
             'cliente_nome', o.cliente_nome, 'placa', o.placa, 'marca', o.marca, 'modelo', o.modelo,
             'diagnostico', o.diagnostico)
           FROM erp_os o WHERE o.id = p_os_id AND o.company_id = p_company_id
             AND (p_company_id IN (SELECT get_user_company_ids()) OR is_admin())),
    'itens', coalesce((SELECT jsonb_agg(jsonb_build_object(
             'id', i.id, 'tipo', i.tipo, 'descricao', i.descricao, 'quantidade', i.quantidade,
             'tempo_estimado_h', i.tempo_estimado_h, 'severidade', i.severidade, 'aprovado', i.aprovado)
             ORDER BY i.ordem, i.created_at)
           FROM erp_os_diagnostico_item i WHERE i.os_id = p_os_id AND i.company_id = p_company_id), '[]'::jsonb),
    'ultima_aprovacao', (SELECT jsonb_build_object('decisao', a.decisao, 'aprovador_nome', a.aprovador_nome,
             'canal', a.canal, 'itens_aprovados', a.itens_aprovados, 'itens_total', a.itens_total,
             'created_at', a.created_at)
           FROM erp_os_aprovacao a WHERE a.os_id = p_os_id AND a.company_id = p_company_id
           ORDER BY a.created_at DESC LIMIT 1)
  );
$$;

-- 4 · registrar: grava decisão por item + evento de aprovação. Atômico. Sem status/financeiro.
CREATE OR REPLACE FUNCTION public.fn_oficina_aprovacao_registrar(p_company_id uuid, p_os_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_dec jsonb; v_aprov int := 0; v_total int := 0; v_geral text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_os WHERE id = p_os_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada nesta empresa');
  END IF;

  -- aplica a decisão item a item (só itens da própria OS/empresa)
  FOR v_dec IN SELECT * FROM jsonb_array_elements(coalesce(p_dados->'decisoes', '[]'::jsonb))
  LOOP
    UPDATE erp_os_diagnostico_item
      SET aprovado = (v_dec->>'aprovado')::boolean, aprovado_em = now()
      WHERE id = (v_dec->>'item_id')::uuid AND os_id = p_os_id AND company_id = p_company_id;
  END LOOP;

  SELECT count(*) FILTER (WHERE aprovado IS TRUE), count(*)
    INTO v_aprov, v_total
    FROM erp_os_diagnostico_item WHERE os_id = p_os_id AND company_id = p_company_id;

  v_geral := CASE WHEN v_aprov = 0 THEN 'recusado'
                  WHEN v_aprov = v_total THEN 'aprovado'
                  ELSE 'parcial' END;

  INSERT INTO erp_os_aprovacao (company_id, os_id, decisao, aprovador_nome, canal, assinatura,
    observacao, itens_aprovados, itens_total, criado_por)
  VALUES (p_company_id, p_os_id, v_geral, nullif(p_dados->>'aprovador_nome',''),
    nullif(p_dados->>'canal',''), nullif(p_dados->>'assinatura',''), nullif(p_dados->>'observacao',''),
    v_aprov, v_total, auth.uid());

  RETURN jsonb_build_object('ok', true, 'decisao', v_geral, 'itens_aprovados', v_aprov, 'itens_total', v_total);
END $$;

GRANT EXECUTE ON FUNCTION public.fn_oficina_aprovacao_obter(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oficina_aprovacao_registrar(uuid, uuid, jsonb) TO authenticated;

-- 5 · catálogo já tem 'oficina_aprovacao_cliente' (RD-26) — só registra a tela ('parcial' até uso real).
INSERT INTO public.system_screens (id, rota, area, modulo, titulo, estado_real)
SELECT gen_random_uuid(), '/dashboard/oficina/aprovacao', 'oficina', 'oficina_aprovacao_cliente', 'Aprovação do Cliente', 'parcial'
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens WHERE rota='/dashboard/oficina/aprovacao');
