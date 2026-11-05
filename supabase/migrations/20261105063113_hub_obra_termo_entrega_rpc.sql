-- Termo de entrega da obra (Encerramento · Hub Gestão de Obras · H8) — backend/dados.
-- A tabela public.erp_obra_termo_entrega JÁ existe em produção (RLS por empresa,
-- UNIQUE(obra_id), status CHECK rascunho|assinado). Esta migration só acrescenta as
-- RPCs ADITIVAS que faltavam para registrar/obter o termo — sem a UI (a aba de
-- Encerramento consome em PR própria; hoje #3912 está aberta na mesma tela).
--
-- IMPORTANTE (fronteira de núcleo): NÃO altera projetos_obras. O "flip" do status da
-- obra para 'entregue' NÃO é feito aqui porque o CHECK de projetos_obras.status só
-- admite em_andamento|pausada|concluida|cancelada — incluir 'entregue' é mudança de
-- modelo em tabela de núcleo (decisão do eng_chefe/gilberto-desenv). O termo tem o
-- próprio ciclo (rascunho -> assinado) e, uma vez assinado, é imutável.
--
-- RD-38: colunas de erp_obra_termo_entrega / audit_log_global / projetos_obras e as
-- guardas get_user_company_ids()/is_admin()/fn__guarda_empresa(uuid) conferidas no dado;
-- a jornada (rascunho, isolamento por empresa=0, assinado, imutabilidade, 2 linhas de
-- auditoria) provada em BEGIN…ROLLBACK (statement_timeout 15s), nada gravado.
-- Aditiva: não cria/altera/apaga dado de cliente.

-- Leitura do termo da obra (escopada por empresa do usuário / admin).
CREATE OR REPLACE FUNCTION public.fn_obra_termo_entrega_obter(p_obra_id uuid)
RETURNS TABLE(
  id uuid, obra_id uuid, status text, data_entrega date, observacoes text,
  assinatura text, assinado_por uuid, assinado_em timestamptz, termo_pdf_path text,
  criado_por uuid, criado_em timestamptz, atualizado_em timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT t.id, t.obra_id, t.status, t.data_entrega, t.observacoes, t.assinatura,
         t.assinado_por, t.assinado_em, t.termo_pdf_path, t.criado_por, t.criado_em, t.atualizado_em
  FROM erp_obra_termo_entrega t
  JOIN projetos_obras o ON o.id = t.obra_id
  WHERE t.obra_id = p_obra_id
    AND (o.company_id IN (SELECT get_user_company_ids()) OR is_admin());
$fn$;

-- Registra/atualiza o termo de entrega de UMA obra (UNIQUE(obra_id) → upsert).
-- p_assinar=true grava status 'assinado' + autoria/carimbo; uma vez assinado é imutável.
CREATE OR REPLACE FUNCTION public.fn_obra_termo_entrega_registrar(
  p_obra_id uuid,
  p_data_entrega date,
  p_observacoes text DEFAULT NULL,
  p_assinatura text DEFAULT NULL,
  p_assinar boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_company uuid;
  v_status text;
  v_id uuid;
  v_antes jsonb;
  v_cur text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF p_obra_id IS NULL THEN RAISE EXCEPTION 'Obra obrigatória'; END IF;
  IF p_data_entrega IS NULL THEN RAISE EXCEPTION 'Data de entrega obrigatória'; END IF;

  SELECT company_id INTO v_company
    FROM projetos_obras
   WHERE id = p_obra_id AND deleted_at IS NULL
   FOR UPDATE;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Obra não encontrada'; END IF;
  PERFORM fn__guarda_empresa(v_company);  -- defesa em profundidade (RLS também cobre)

  v_status := CASE WHEN p_assinar THEN 'assinado' ELSE 'rascunho' END;

  SELECT t.id, t.status, to_jsonb(t) INTO v_id, v_cur, v_antes
    FROM erp_obra_termo_entrega t WHERE t.obra_id = p_obra_id;

  IF v_cur = 'assinado' THEN
    RAISE EXCEPTION 'Termo já assinado; não pode ser alterado';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO erp_obra_termo_entrega(
      company_id, obra_id, status, data_entrega, observacoes, assinatura,
      assinado_por, assinado_em, criado_por, criado_em, atualizado_em)
    VALUES(
      v_company, p_obra_id, v_status, p_data_entrega, p_observacoes, p_assinatura,
      CASE WHEN p_assinar THEN v_uid END,
      CASE WHEN p_assinar THEN now() END,
      v_uid, now(), now())
    RETURNING id INTO v_id;
  ELSE
    UPDATE erp_obra_termo_entrega SET
      data_entrega  = p_data_entrega,
      observacoes   = p_observacoes,
      assinatura    = COALESCE(p_assinatura, assinatura),
      status        = v_status,
      assinado_por  = CASE WHEN p_assinar THEN v_uid ELSE NULL END,
      assinado_em   = CASE WHEN p_assinar THEN now() ELSE NULL END,
      atualizado_em = now()
    WHERE id = v_id;
  END IF;

  INSERT INTO audit_log_global(company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo, created_at)
  VALUES(
    v_company, v_uid, 'erp_obra_termo_entrega', v_id::text,
    CASE WHEN v_antes IS NULL THEN 'criar' ELSE 'atualizar' END,
    v_antes,
    jsonb_build_object('obra_id', p_obra_id, 'status', v_status, 'data_entrega', p_data_entrega, 'assinado', p_assinar),
    now());

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_obra_termo_entrega_obter(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_termo_entrega_registrar(uuid, date, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_termo_entrega_obter(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_termo_entrega_registrar(uuid, date, text, text, boolean) TO authenticated, service_role;
