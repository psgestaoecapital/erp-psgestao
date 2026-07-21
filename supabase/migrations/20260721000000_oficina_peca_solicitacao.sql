-- R5+R6 · Solicitação de peça pelo mecânico (foto) + alerta pro dono. Aditivo (RD-55). Reuso (RD-26):
-- erp_alerta_proativo (motor de alertas), bucket privado oficina-recepcao ({company_id}/pecas/... p/ passar na RLS),
-- fn_oficina_pecas_buscar (busca sem preço). Provado (autenticado, abortado): solicitar→alerta(1)→listar(1)→decidir(aprovado).
-- Reverter: DROP das 3 funções + DROP TABLE erp_os_peca_solicitacao.

CREATE TABLE IF NOT EXISTS public.erp_os_peca_solicitacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  os_id uuid NOT NULL REFERENCES public.erp_os(id) ON DELETE CASCADE,
  produto_id uuid NULL,
  descricao text NOT NULL,
  quantidade numeric NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  foto_path text NULL,
  observacao text NULL,
  status text NOT NULL DEFAULT 'solicitado' CHECK (status IN ('solicitado','aprovado','comprado','recusado')),
  solicitado_por uuid NULL,
  solicitado_por_nome text NULL,
  solicitado_em timestamptz NOT NULL DEFAULT now(),
  decidido_por uuid NULL,
  decidido_em timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_peca_solic_os ON public.erp_os_peca_solicitacao (company_id, os_id);
CREATE INDEX IF NOT EXISTS ix_peca_solic_status ON public.erp_os_peca_solicitacao (company_id, status);
ALTER TABLE public.erp_os_peca_solicitacao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_peca_solic_rls ON public.erp_os_peca_solicitacao;
CREATE POLICY p_peca_solic_rls ON public.erp_os_peca_solicitacao
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));

-- 3.1 · mecânico CRIA solicitação + dispara alerta pro dono (sem R$).
CREATE OR REPLACE FUNCTION public.fn_oficina_peca_solicitar(
  p_company_id uuid, p_os_id uuid, p_descricao text, p_quantidade numeric DEFAULT 1,
  p_produto_id uuid DEFAULT NULL, p_foto_path text DEFAULT NULL, p_observacao text DEFAULT NULL,
  p_solicitado_por_nome text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_os erp_os; v_id uuid; v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_os FROM erp_os WHERE id=p_os_id;
  IF v_os IS NULL OR NOT (v_os.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta OS');
  END IF;
  IF coalesce(btrim(p_descricao),'')='' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe a peça.'); END IF;
  IF coalesce(p_quantidade,0) <= 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Quantidade deve ser maior que zero.'); END IF;

  INSERT INTO erp_os_peca_solicitacao (company_id, os_id, produto_id, descricao, quantidade, foto_path,
    observacao, solicitado_por, solicitado_por_nome)
  VALUES (v_os.company_id, p_os_id, p_produto_id, btrim(p_descricao), p_quantidade, p_foto_path,
    nullif(btrim(p_observacao),''), v_uid, nullif(btrim(p_solicitado_por_nome),''))
  RETURNING id INTO v_id;

  INSERT INTO erp_alerta_proativo (company_id, tipo, severidade, titulo, mensagem, contexto, link_acao)
  VALUES (v_os.company_id, 'oficina_solicitacao_peca', 'media',
    'Mecânico solicitou peça — OS '||coalesce(v_os.numero,'?'),
    coalesce(nullif(btrim(p_solicitado_por_nome),'')||' pediu: ','')||p_quantidade||'x '||btrim(p_descricao)
      ||coalesce(' · '||nullif(btrim(p_observacao),''),''),
    jsonb_build_object('os_id', p_os_id, 'os_numero', v_os.numero, 'solicitacao_id', v_id,
      'quantidade', p_quantidade, 'peca', btrim(p_descricao), 'foto_path', p_foto_path),
    '/dashboard/oficina/solicitacoes');

  RETURN jsonb_build_object('ok', true, 'solicitacao_id', v_id, 'os_numero', v_os.numero);
END $$;
GRANT EXECUTE ON FUNCTION public.fn_oficina_peca_solicitar(uuid, uuid, text, numeric, uuid, text, text, text) TO authenticated;

-- 3.2 · listar (por OS ou todas da empresa p/ o admin) — preço só aqui (lado admin).
CREATE OR REPLACE FUNCTION public.fn_oficina_peca_solicitacoes_listar(p_company_id uuid, p_os_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, os_id uuid, os_numero text, produto_id uuid, descricao text, quantidade numeric,
             foto_path text, observacao text, status text, solicitado_por_nome text, solicitado_em timestamptz,
             preco_venda numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;
  RETURN QUERY
  SELECT s.id, s.os_id, (SELECT o.numero::text FROM erp_os o WHERE o.id=s.os_id), s.produto_id, s.descricao, s.quantidade,
         s.foto_path, s.observacao, s.status, s.solicitado_por_nome, s.solicitado_em,
         (SELECT pr.preco_venda FROM erp_produtos pr WHERE pr.id=s.produto_id) AS preco_venda
  FROM erp_os_peca_solicitacao s
  WHERE s.company_id=p_company_id AND (p_os_id IS NULL OR s.os_id=p_os_id)
  ORDER BY (s.status='solicitado') DESC, s.solicitado_em DESC;
END $$;
GRANT EXECUTE ON FUNCTION public.fn_oficina_peca_solicitacoes_listar(uuid, uuid) TO authenticated;

-- 3.3 · dono/admin DECIDE (aprovar/comprar/recusar).
CREATE OR REPLACE FUNCTION public.fn_oficina_peca_decidir(
  p_company_id uuid, p_solicitacao_id uuid, p_status text, p_decidido_por uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows int;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem acesso a esta empresa');
  END IF;
  IF p_status NOT IN ('aprovado','comprado','recusado') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Status inválido.');
  END IF;
  UPDATE erp_os_peca_solicitacao
  SET status=p_status, decidido_por=coalesce(p_decidido_por, auth.uid()), decidido_em=now()
  WHERE id=p_solicitacao_id AND company_id=p_company_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows=0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Solicitação não encontrada.'); END IF;
  RETURN jsonb_build_object('ok', true, 'status', p_status);
END $$;
GRANT EXECUTE ON FUNCTION public.fn_oficina_peca_decidir(uuid, uuid, text, uuid) TO authenticated;
