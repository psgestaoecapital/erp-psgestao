-- #1677 (B) · Fluxo de compras com alçada: solicitação → orçamentos anexados → aprovação → pendência do comprador.
-- Núcleo (todas as empresas). Depende da PR A (erp_compras_alcada_config, fn_compras_alcada_*).
-- Regras (decisão CEO + equipe 06/10): 3 orçamentos por padrão (1 se a empresa configurou); aprovação de QUALQUER valor
-- pelo aprovador geral da empresa (principal ou substituto, vindos do CADASTRO — nada fixo); quem solicita não aprova;
-- recusa exige motivo; mudou itens/fornecedor/valor/orçamentos depois de enviada ou aprovada => volta para aprovação;
-- urgência (dispensa dos orçamentos) só se TODOS os itens estão liberados na configuração.
-- ADITIVA: tabelas novas (RLS por empresa, REVOKE anon, escrita só por função), nenhuma função/view/policy existente alterada.

CREATE TABLE IF NOT EXISTS public.erp_compras_solicitacao (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL,
  numero               bigint GENERATED ALWAYS AS IDENTITY,
  solicitante_id       uuid NOT NULL,
  descricao            text NOT NULL,
  obra_ref             text,
  urgente              boolean NOT NULL DEFAULT false,
  urgencia_motivo      text,
  status               text NOT NULL DEFAULT 'rascunho'
                         CHECK (status IN ('rascunho','aguardando_aprovacao','aprovada','recusada','cancelada','comprada')),
  assinatura           text,            -- hash de itens + orçamentos + escolhido, para detectar mudança (reaprovação)
  aprovado_por         uuid,
  aprovado_em          timestamptz,
  assinatura_aprovada  text,
  recusa_motivo        text,
  compra_id            uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_compras_solic_urgencia_motivo CHECK (NOT urgente OR btrim(COALESCE(urgencia_motivo,'')) <> '')
);
CREATE INDEX IF NOT EXISTS idx_compras_solic_empresa_status ON public.erp_compras_solicitacao (company_id, status);

CREATE TABLE IF NOT EXISTS public.erp_compras_solicitacao_item (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id uuid NOT NULL REFERENCES public.erp_compras_solicitacao(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL,
  produto_id     uuid,
  descricao      text NOT NULL,
  categoria      text,
  unidade        text,
  quantidade     numeric(14,4) NOT NULL CHECK (quantidade > 0)
);
CREATE INDEX IF NOT EXISTS idx_compras_solic_item_solic ON public.erp_compras_solicitacao_item (solicitacao_id);

CREATE TABLE IF NOT EXISTS public.erp_compras_solicitacao_orcamento (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id  uuid NOT NULL REFERENCES public.erp_compras_solicitacao(id) ON DELETE CASCADE,
  company_id      uuid NOT NULL,
  fornecedor_id   uuid,
  fornecedor_nome text NOT NULL,
  valor_total     numeric(14,2) NOT NULL CHECK (valor_total >= 0),
  anexo_url       text NOT NULL,         -- orçamento ANEXADO (arquivo/URL); sem anexo não conta
  escolhido       boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_compras_solic_orc_solic ON public.erp_compras_solicitacao_orcamento (solicitacao_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_compras_solic_orc_escolhido ON public.erp_compras_solicitacao_orcamento (solicitacao_id) WHERE escolhido;

CREATE TABLE IF NOT EXISTS public.erp_compras_solicitacao_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id uuid NOT NULL REFERENCES public.erp_compras_solicitacao(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL,
  evento         text NOT NULL,
  detalhe        text,
  user_id        uuid,
  criado_em      timestamptz NOT NULL DEFAULT now()
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['erp_compras_solicitacao','erp_compras_solicitacao_item','erp_compras_solicitacao_orcamento','erp_compras_solicitacao_log'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())', t || '_select', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, public', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- Normaliza categoria (sem acento, minúscula) — mesma regra de src/lib/compras/alcada.ts.
CREATE OR REPLACE FUNCTION public.fn_compras_norm_texto(t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT lower(btrim(translate(COALESCE(t,''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuuc' || 'AAAAAEEEEIIIIOOOOOUUUUC')))
$$;

-- Assinatura do conteúdo que o aprovador viu: itens + orçamentos + escolhido.
CREATE OR REPLACE FUNCTION public.fn_compras_solic_assinatura(p_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT md5(
    COALESCE((SELECT string_agg(concat_ws('|', produto_id, descricao, categoria, unidade, quantidade), ';' ORDER BY descricao, produto_id, quantidade)
                FROM public.erp_compras_solicitacao_item WHERE solicitacao_id = p_id), '') || '#' ||
    COALESCE((SELECT string_agg(concat_ws('|', fornecedor_id, fornecedor_nome, valor_total, anexo_url, escolhido), ';' ORDER BY fornecedor_nome, valor_total, anexo_url)
                FROM public.erp_compras_solicitacao_orcamento WHERE solicitacao_id = p_id), '')
  )
$$;

-- Cria/edita a solicitação (rascunho ou volta para aprovação se já enviada/aprovada e o conteúdo mudou).
-- p_dados: {id?, descricao, obra_ref?, urgente?, urgencia_motivo?, itens:[{produto_id?,descricao,categoria?,unidade?,quantidade}],
--           orcamentos:[{fornecedor_id?,fornecedor_nome,valor_total,anexo_url,escolhido?}]}
CREATE OR REPLACE FUNCTION public.fn_compras_solic_salvar(p_company_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_id uuid; s record; v_nova text; v_status text; v_reaprov boolean := false; i jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF btrim(COALESCE(p_dados->>'descricao','')) = '' THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Descrição obrigatória'); END IF;
  IF COALESCE((p_dados->>'urgente')::boolean, false) AND btrim(COALESCE(p_dados->>'urgencia_motivo','')) = '' THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'Compra urgente exige o motivo');
  END IF;

  v_id := NULLIF(p_dados->>'id','')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO public.erp_compras_solicitacao (company_id, solicitante_id, descricao, obra_ref, urgente, urgencia_motivo)
    VALUES (p_company_id, auth.uid(), btrim(p_dados->>'descricao'), NULLIF(btrim(p_dados->>'obra_ref'),''),
            COALESCE((p_dados->>'urgente')::boolean, false), NULLIF(btrim(p_dados->>'urgencia_motivo'),''))
    RETURNING id INTO v_id;
    INSERT INTO public.erp_compras_solicitacao_log (solicitacao_id, company_id, evento, user_id) VALUES (v_id, p_company_id, 'criada', auth.uid());
  ELSE
    SELECT * INTO s FROM public.erp_compras_solicitacao WHERE id = v_id AND company_id = p_company_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Solicitação não encontrada'); END IF;
    IF s.solicitante_id <> auth.uid() THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Só quem solicitou pode editar'); END IF;
    IF s.status IN ('cancelada','comprada') THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Solicitação encerrada não pode ser editada'); END IF;
    UPDATE public.erp_compras_solicitacao
       SET descricao = btrim(p_dados->>'descricao'), obra_ref = NULLIF(btrim(p_dados->>'obra_ref'),''),
           urgente = COALESCE((p_dados->>'urgente')::boolean, false), urgencia_motivo = NULLIF(btrim(p_dados->>'urgencia_motivo'),''),
           updated_at = now()
     WHERE id = v_id;
    DELETE FROM public.erp_compras_solicitacao_item WHERE solicitacao_id = v_id;
    DELETE FROM public.erp_compras_solicitacao_orcamento WHERE solicitacao_id = v_id;
  END IF;

  FOR i IN SELECT * FROM jsonb_array_elements(COALESCE(p_dados->'itens','[]'::jsonb)) LOOP
    INSERT INTO public.erp_compras_solicitacao_item (solicitacao_id, company_id, produto_id, descricao, categoria, unidade, quantidade)
    VALUES (v_id, p_company_id, NULLIF(i->>'produto_id','')::uuid, btrim(i->>'descricao'), NULLIF(btrim(i->>'categoria'),''),
            NULLIF(btrim(i->>'unidade'),''), (i->>'quantidade')::numeric);
  END LOOP;
  FOR i IN SELECT * FROM jsonb_array_elements(COALESCE(p_dados->'orcamentos','[]'::jsonb)) LOOP
    IF btrim(COALESCE(i->>'anexo_url','')) = '' THEN
      RAISE EXCEPTION 'Orçamento sem anexo não vale' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.erp_compras_solicitacao_orcamento (solicitacao_id, company_id, fornecedor_id, fornecedor_nome, valor_total, anexo_url, escolhido)
    VALUES (v_id, p_company_id, NULLIF(i->>'fornecedor_id','')::uuid, btrim(i->>'fornecedor_nome'), (i->>'valor_total')::numeric,
            btrim(i->>'anexo_url'), COALESCE((i->>'escolhido')::boolean, false));
  END LOOP;

  v_nova := public.fn_compras_solic_assinatura(v_id);
  SELECT * INTO s FROM public.erp_compras_solicitacao WHERE id = v_id;
  v_status := s.status;
  -- Reaprovação: conteúdo mudou depois de enviada/aprovada/recusada => volta para aguardando aprovação (ou rascunho se nunca enviada).
  IF s.status IN ('aguardando_aprovacao','aprovada') AND s.assinatura IS DISTINCT FROM v_nova THEN
    v_status := 'aguardando_aprovacao'; v_reaprov := (s.status = 'aprovada');
  ELSIF s.status = 'recusada' THEN
    v_status := 'rascunho';
  END IF;
  UPDATE public.erp_compras_solicitacao
     SET assinatura = v_nova, status = v_status,
         aprovado_por = CASE WHEN v_reaprov THEN NULL ELSE aprovado_por END,
         aprovado_em  = CASE WHEN v_reaprov THEN NULL ELSE aprovado_em END,
         assinatura_aprovada = CASE WHEN v_reaprov THEN NULL ELSE assinatura_aprovada END
   WHERE id = v_id;
  IF v_reaprov THEN
    INSERT INTO public.erp_compras_solicitacao_log (solicitacao_id, company_id, evento, detalhe, user_id)
    VALUES (v_id, p_company_id, 'reaprovacao_exigida', 'Conteúdo alterado após a aprovação', auth.uid());
  END IF;
  RETURN jsonb_build_object('sucesso', true, 'id', v_id, 'status', v_status, 'reaprovacao', v_reaprov);
END $$;

-- Envia para aprovação: confere orçamentos (3 padrão / 1 configurado) ou urgência liberada, e um fornecedor escolhido.
CREATE OR REPLACE FUNCTION public.fn_compras_solic_enviar(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s record; cfg record; v_min int; v_orc int; v_esc int; v_nitens int; v_nao_lib int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM public.erp_compras_solicitacao WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Solicitação não encontrada'); END IF;
  PERFORM public.fn__guarda_empresa(s.company_id);
  IF s.solicitante_id <> auth.uid() THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Só quem solicitou pode enviar'); END IF;
  IF s.status <> 'rascunho' THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Só rascunho pode ser enviado'); END IF;
  SELECT * INTO cfg FROM public.erp_compras_alcada_config WHERE company_id = s.company_id;
  IF cfg.aprovador_principal_id IS NULL THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', 'A empresa ainda não definiu o aprovador de compras (Admin → Alçada de compras)');
  END IF;
  v_min := COALESCE(cfg.min_orcamentos, 3);
  SELECT count(*), count(*) FILTER (WHERE escolhido) INTO v_orc, v_esc FROM public.erp_compras_solicitacao_orcamento WHERE solicitacao_id = p_id;
  SELECT count(*) INTO v_nitens FROM public.erp_compras_solicitacao_item WHERE solicitacao_id = p_id;
  IF v_nitens = 0 THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Inclua ao menos um item'); END IF;
  IF s.urgente THEN
    SELECT count(*) INTO v_nao_lib FROM public.erp_compras_solicitacao_item i
     WHERE i.solicitacao_id = p_id
       AND NOT ((i.produto_id IS NOT NULL AND i.produto_id = ANY (COALESCE(cfg.urgencia_produto_ids, '{}')))
             OR (i.categoria IS NOT NULL AND public.fn_compras_norm_texto(i.categoria) = ANY (SELECT public.fn_compras_norm_texto(x) FROM unnest(COALESCE(cfg.urgencia_categorias, '{}')) x)));
    IF v_nao_lib > 0 THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Urgência só vale quando todos os itens estão liberados na configuração'); END IF;
  ELSIF v_orc < v_min THEN
    RETURN jsonb_build_object('sucesso', false, 'erro', format('Anexe ao menos %s orçamento(s) (anexados: %s)', v_min, v_orc));
  END IF;
  IF v_orc > 0 AND v_esc <> 1 THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Escolha exatamente um fornecedor'); END IF;
  UPDATE public.erp_compras_solicitacao SET status = 'aguardando_aprovacao', assinatura = public.fn_compras_solic_assinatura(p_id), updated_at = now() WHERE id = p_id;
  INSERT INTO public.erp_compras_solicitacao_log (solicitacao_id, company_id, evento, user_id) VALUES (p_id, s.company_id, 'enviada', auth.uid());
  RETURN jsonb_build_object('sucesso', true, 'status', 'aguardando_aprovacao');
END $$;

-- Aprova/recusa: só o aprovador geral da empresa (principal ou substituto, do cadastro), nunca o próprio solicitante.
CREATE OR REPLACE FUNCTION public.fn_compras_solic_decidir(p_id uuid, p_aprovar boolean, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s record; cfg record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM public.erp_compras_solicitacao WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Solicitação não encontrada'); END IF;
  PERFORM public.fn__guarda_empresa(s.company_id);
  SELECT * INTO cfg FROM public.erp_compras_alcada_config WHERE company_id = s.company_id;
  IF auth.uid() IS DISTINCT FROM cfg.aprovador_principal_id AND auth.uid() IS DISTINCT FROM cfg.aprovador_substituto_id THEN
    RAISE EXCEPTION 'Somente o aprovador de compras da empresa decide' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() = s.solicitante_id THEN
    RAISE EXCEPTION 'Quem solicita não aprova a própria compra' USING ERRCODE = '42501';
  END IF;
  IF s.status <> 'aguardando_aprovacao' THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Solicitação não está aguardando aprovação'); END IF;
  IF NOT p_aprovar AND btrim(COALESCE(p_motivo,'')) = '' THEN RETURN jsonb_build_object('sucesso', false, 'erro', 'Recusa exige motivo'); END IF;
  IF p_aprovar THEN
    UPDATE public.erp_compras_solicitacao
       SET status = 'aprovada', aprovado_por = auth.uid(), aprovado_em = now(), assinatura_aprovada = s.assinatura, recusa_motivo = NULL, updated_at = now()
     WHERE id = p_id;
  ELSE
    UPDATE public.erp_compras_solicitacao SET status = 'recusada', recusa_motivo = btrim(p_motivo), updated_at = now() WHERE id = p_id;
  END IF;
  INSERT INTO public.erp_compras_solicitacao_log (solicitacao_id, company_id, evento, detalhe, user_id)
  VALUES (p_id, s.company_id, CASE WHEN p_aprovar THEN 'aprovada' ELSE 'recusada' END, NULLIF(btrim(COALESCE(p_motivo,'')),''), auth.uid());
  RETURN jsonb_build_object('sucesso', true, 'status', CASE WHEN p_aprovar THEN 'aprovada' ELSE 'recusada' END);
END $$;

-- Pendência do comprador: solicitações aprovadas ainda sem compra gerada (com o orçamento escolhido).
CREATE OR REPLACE FUNCTION public.fn_compras_solic_pendencias_comprador(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  PERFORM public.fn__guarda_empresa(p_company_id);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', s.id, 'numero', s.numero, 'descricao', s.descricao, 'obra_ref', s.obra_ref, 'urgente', s.urgente,
             'aprovado_em', s.aprovado_em, 'aprovado_por', s.aprovado_por,
             'fornecedor_escolhido', o.fornecedor_nome, 'fornecedor_id', o.fornecedor_id, 'valor_total', o.valor_total)
           ORDER BY s.urgente DESC, s.aprovado_em)
      FROM public.erp_compras_solicitacao s
      LEFT JOIN public.erp_compras_solicitacao_orcamento o ON o.solicitacao_id = s.id AND o.escolhido
     WHERE s.company_id = p_company_id AND s.status = 'aprovada' AND s.compra_id IS NULL), '[]'::jsonb);
END $$;

REVOKE EXECUTE ON FUNCTION public.fn_compras_norm_texto(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_compras_norm_texto(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_compras_solic_assinatura(uuid) FROM anon, public, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_compras_solic_salvar(uuid, jsonb) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_compras_solic_enviar(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_compras_solic_decidir(uuid, boolean, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.fn_compras_solic_pendencias_comprador(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_compras_solic_assinatura(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_compras_solic_salvar(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_compras_solic_enviar(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_compras_solic_decidir(uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_compras_solic_pendencias_comprador(uuid) TO authenticated, service_role;
