-- #1677 (B2) · Fluxo de compras — SOLICITAÇÃO DE COMPRA com orçamentos anexados e APROVAÇÃO pela alçada (todas as empresas;
-- piloto Gean). Etapa A (#2101) criou a alçada; B1 (#2732) a tela da alçada. Aqui: o funcionário monta a solicitação
-- (itens + orçamentos com arquivo), envia; o aprovador principal ou o substituto aprova ou recusa com motivo.
-- Regras (a mesma lógica pura está em src/lib/compras/alcada.ts e é conferida por gate):
--   • envio exige alçada configurada (aprovador principal), ao menos 1 item e o nº de orçamentos da alçada (3 ou 1);
--   • compra URGENTE dispensa os orçamentos só se TODOS os itens estão na lista liberada da alçada (produto ou categoria);
--     mesmo urgente, passa pelo aprovador;
--   • quem solicita NÃO aprova a própria compra; recusa exige motivo; tudo fica registrado (quem, quando, por quê).
-- ADITIVA: 3 tabelas novas (RLS por empresa, REVOKE anon, escrita só pelas RPCs com guarda), 1 bucket privado novo
-- (pasta 1 = empresa), menu/inventário e "?" (RD-95). Nenhuma função/view/policy existente é alterada.
-- Próximas etapas: (3) tela do comprador (aprovada vira pendência de compra/cotação); (4) Ordem de Fornecimento em PDF.

-- ───────────────────────────── Tabelas ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_compras_solicitacao (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id),
  numero         int  NOT NULL,
  solicitante    uuid NOT NULL REFERENCES auth.users(id),
  titulo         text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 3 AND 200),
  justificativa  text,
  urgente        boolean NOT NULL DEFAULT false,
  status         text NOT NULL DEFAULT 'rascunho'
                 CHECK (status IN ('rascunho','aguardando_aprovacao','aprovada','recusada','cancelada')),
  enviada_em     timestamptz,
  decidido_por   uuid REFERENCES auth.users(id),
  decidido_em    timestamptz,
  decisao_motivo text,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, numero)
);
CREATE INDEX IF NOT EXISTS ix_compras_solic_empresa ON public.erp_compras_solicitacao (company_id, status, criado_em DESC);

CREATE TABLE IF NOT EXISTS public.erp_compras_solicitacao_item (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id uuid NOT NULL REFERENCES public.erp_compras_solicitacao(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL,
  ordem          int  NOT NULL DEFAULT 0,
  produto_id     uuid,
  descricao      text NOT NULL CHECK (length(btrim(descricao)) > 0),
  categoria      text,
  quantidade     numeric(14,4) NOT NULL CHECK (quantidade > 0),
  unidade        text
);
CREATE INDEX IF NOT EXISTS ix_compras_solic_item ON public.erp_compras_solicitacao_item (solicitacao_id, ordem);

CREATE TABLE IF NOT EXISTS public.erp_compras_solicitacao_orcamento (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id   uuid NOT NULL REFERENCES public.erp_compras_solicitacao(id) ON DELETE CASCADE,
  company_id       uuid NOT NULL,
  fornecedor_nome  text NOT NULL CHECK (length(btrim(fornecedor_nome)) > 0),
  valor_total      numeric(14,2) NOT NULL CHECK (valor_total > 0),
  prazo_entrega    text,
  observacao       text,
  arquivo_path     text,          -- storage privado 'compras-orcamentos', 1ª pasta = empresa
  arquivo_nome     text,
  criado_por       uuid NOT NULL REFERENCES auth.users(id),
  criado_em        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_compras_solic_orc ON public.erp_compras_solicitacao_orcamento (solicitacao_id);

-- ───────────────────────────── RLS + grants (leitura por empresa; escrita só via RPC) ─────────────────────────────
ALTER TABLE public.erp_compras_solicitacao           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_compras_solicitacao_item      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_compras_solicitacao_orcamento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS compras_solic_select ON public.erp_compras_solicitacao;
CREATE POLICY compras_solic_select ON public.erp_compras_solicitacao FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
DROP POLICY IF EXISTS compras_solic_item_select ON public.erp_compras_solicitacao_item;
CREATE POLICY compras_solic_item_select ON public.erp_compras_solicitacao_item FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
DROP POLICY IF EXISTS compras_solic_orc_select ON public.erp_compras_solicitacao_orcamento;
CREATE POLICY compras_solic_orc_select ON public.erp_compras_solicitacao_orcamento FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
REVOKE ALL ON public.erp_compras_solicitacao, public.erp_compras_solicitacao_item, public.erp_compras_solicitacao_orcamento
  FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.erp_compras_solicitacao, public.erp_compras_solicitacao_item,
  public.erp_compras_solicitacao_orcamento FROM authenticated;
GRANT SELECT ON public.erp_compras_solicitacao, public.erp_compras_solicitacao_item, public.erp_compras_solicitacao_orcamento
  TO authenticated;
GRANT ALL ON public.erp_compras_solicitacao, public.erp_compras_solicitacao_item, public.erp_compras_solicitacao_orcamento
  TO service_role;

-- ───────────────────────────── Bucket privado dos orçamentos ─────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('compras-orcamentos', 'compras-orcamentos', false, 10485760,
        ARRAY['application/pdf','image/jpeg','image/png','image/webp']::text[])
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS compras_orcamentos_sel ON storage.objects;
CREATE POLICY compras_orcamentos_sel ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'compras-orcamentos' AND (storage.foldername(name))[1] IN (SELECT public.get_user_company_ids()::text));
DROP POLICY IF EXISTS compras_orcamentos_ins ON storage.objects;
CREATE POLICY compras_orcamentos_ins ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'compras-orcamentos' AND (storage.foldername(name))[1] IN (SELECT public.get_user_company_ids()::text));

-- ───────────────────────────── Auxiliar: pode decidir? ─────────────────────────────
-- Aprovador = principal ou substituto da alçada da empresa, e nunca o próprio solicitante.
CREATE OR REPLACE FUNCTION public.fn_compras_solicitacao_pode_decidir(p_company_id uuid, p_solicitante uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_solicitante AND EXISTS (
    SELECT 1 FROM public.erp_compras_alcada_config c
     WHERE c.company_id = p_company_id
       AND auth.uid() IN (c.aprovador_principal_id, c.aprovador_substituto_id))
$$;
REVOKE ALL ON FUNCTION public.fn_compras_solicitacao_pode_decidir(uuid, uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_compras_solicitacao_pode_decidir(uuid, uuid) TO authenticated;

-- ───────────────────────────── Salvar (criar ou editar o próprio rascunho) ─────────────────────────────
-- p_dados: { id?, titulo, justificativa, urgente, itens: [{produto_id?, descricao, categoria?, quantidade, unidade?}] }
CREATE OR REPLACE FUNCTION public.fn_compras_solicitacao_salvar(p_company_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_id uuid := NULLIF(p_dados->>'id','')::uuid;
  v_titulo text := btrim(coalesce(p_dados->>'titulo',''));
  v_itens jsonb := coalesce(p_dados->'itens','[]'::jsonb);
  v_num int; s record; it jsonb; v_ord int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF length(v_titulo) < 3 THEN RETURN jsonb_build_object('sucesso',false,'erro','Descreva a compra (mínimo 3 letras).'); END IF;
  IF jsonb_typeof(v_itens) <> 'array' OR jsonb_array_length(v_itens) > 100 THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Lista de itens inválida (máximo 100).');
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(v_itens) LOOP
    IF btrim(coalesce(it->>'descricao','')) = '' OR coalesce(NULLIF(it->>'quantidade','')::numeric, 0) <= 0 THEN
      RETURN jsonb_build_object('sucesso',false,'erro','Cada item precisa de descrição e quantidade maior que zero.');
    END IF;
  END LOOP;

  IF v_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('compras_solic_num:' || p_company_id::text));
    SELECT coalesce(max(numero),0) + 1 INTO v_num FROM erp_compras_solicitacao WHERE company_id = p_company_id;
    INSERT INTO erp_compras_solicitacao (company_id, numero, solicitante, titulo, justificativa, urgente)
    VALUES (p_company_id, v_num, auth.uid(), left(v_titulo,200), NULLIF(btrim(p_dados->>'justificativa'),''),
            coalesce((p_dados->>'urgente')::boolean, false))
    RETURNING id INTO v_id;
  ELSE
    SELECT * INTO s FROM erp_compras_solicitacao WHERE id = v_id AND company_id = p_company_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('sucesso',false,'erro','Solicitação não encontrada.'); END IF;
    IF s.solicitante <> auth.uid() OR s.status <> 'rascunho' THEN
      RETURN jsonb_build_object('sucesso',false,'erro','Só quem criou altera, e só enquanto é rascunho.');
    END IF;
    UPDATE erp_compras_solicitacao SET titulo = left(v_titulo,200),
           justificativa = NULLIF(btrim(p_dados->>'justificativa'),''),
           urgente = coalesce((p_dados->>'urgente')::boolean, false), atualizado_em = now()
     WHERE id = v_id;
    DELETE FROM erp_compras_solicitacao_item WHERE solicitacao_id = v_id;
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(v_itens) LOOP
    v_ord := v_ord + 1;
    INSERT INTO erp_compras_solicitacao_item (solicitacao_id, company_id, ordem, produto_id, descricao, categoria, quantidade, unidade)
    SELECT v_id, p_company_id, v_ord, p.id, btrim(it->>'descricao'),
           coalesce(NULLIF(btrim(p.categoria),''), NULLIF(btrim(it->>'categoria'),'')),
           (it->>'quantidade')::numeric, NULLIF(btrim(it->>'unidade'),'')
      FROM (SELECT NULLIF(it->>'produto_id','')::uuid AS pid) x
      LEFT JOIN erp_produtos p ON p.id = x.pid AND p.company_id = p_company_id;  -- produto de outra empresa é ignorado
  END LOOP;
  RETURN jsonb_build_object('sucesso',true,'id',v_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_compras_solicitacao_salvar(uuid, jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_compras_solicitacao_salvar(uuid, jsonb) TO authenticated;

-- ───────────────────────────── Orçamentos (no rascunho, pelo solicitante) ─────────────────────────────
-- p_dados: { fornecedor_nome, valor_total, prazo_entrega?, observacao?, arquivo_path?, arquivo_nome? }
CREATE OR REPLACE FUNCTION public.fn_compras_solicitacao_orcamento_adicionar(p_solicitacao_id uuid, p_dados jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s record; v_id uuid; v_path text := NULLIF(btrim(p_dados->>'arquivo_path'),''); v_valor numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM erp_compras_solicitacao WHERE id = p_solicitacao_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso',false,'erro','Solicitação não encontrada.'); END IF;
  PERFORM public.fn__guarda_empresa(s.company_id);
  IF s.solicitante <> auth.uid() OR s.status <> 'rascunho' THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Orçamento só entra no rascunho, por quem criou a solicitação.');
  END IF;
  IF btrim(coalesce(p_dados->>'fornecedor_nome','')) = '' THEN RETURN jsonb_build_object('sucesso',false,'erro','Informe o fornecedor.'); END IF;
  BEGIN v_valor := NULLIF(p_dados->>'valor_total','')::numeric; EXCEPTION WHEN others THEN v_valor := NULL; END;
  IF coalesce(v_valor,0) <= 0 THEN RETURN jsonb_build_object('sucesso',false,'erro','Informe o valor total do orçamento.'); END IF;
  -- o arquivo precisa estar na pasta da própria empresa
  IF v_path IS NOT NULL AND split_part(v_path,'/',1) <> s.company_id::text THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Arquivo fora da pasta da empresa.');
  END IF;
  IF (SELECT count(*) FROM erp_compras_solicitacao_orcamento WHERE solicitacao_id = p_solicitacao_id) >= 10 THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Máximo de 10 orçamentos por solicitação.');
  END IF;
  INSERT INTO erp_compras_solicitacao_orcamento (solicitacao_id, company_id, fornecedor_nome, valor_total, prazo_entrega,
         observacao, arquivo_path, arquivo_nome, criado_por)
  VALUES (p_solicitacao_id, s.company_id, left(btrim(p_dados->>'fornecedor_nome'),200), round(v_valor,2),
          NULLIF(btrim(p_dados->>'prazo_entrega'),''), NULLIF(btrim(p_dados->>'observacao'),''),
          v_path, NULLIF(btrim(p_dados->>'arquivo_nome'),''), auth.uid())
  RETURNING id INTO v_id;
  UPDATE erp_compras_solicitacao SET atualizado_em = now() WHERE id = p_solicitacao_id;
  RETURN jsonb_build_object('sucesso',true,'id',v_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_compras_solicitacao_orcamento_adicionar(uuid, jsonb) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_compras_solicitacao_orcamento_adicionar(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_compras_solicitacao_orcamento_remover(p_orcamento_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT o2.id, s.company_id, s.solicitante, s.status INTO o
    FROM erp_compras_solicitacao_orcamento o2 JOIN erp_compras_solicitacao s ON s.id = o2.solicitacao_id
   WHERE o2.id = p_orcamento_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso',false,'erro','Orçamento não encontrado.'); END IF;
  PERFORM public.fn__guarda_empresa(o.company_id);
  IF o.solicitante <> auth.uid() OR o.status <> 'rascunho' THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Só quem criou remove, e só enquanto é rascunho.');
  END IF;
  DELETE FROM erp_compras_solicitacao_orcamento WHERE id = p_orcamento_id;
  RETURN jsonb_build_object('sucesso',true);
END $$;
REVOKE ALL ON FUNCTION public.fn_compras_solicitacao_orcamento_remover(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_compras_solicitacao_orcamento_remover(uuid) TO authenticated;

-- ───────────────────────────── Enviar para aprovação ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_compras_solicitacao_enviar(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s record; c record; v_itens int; v_orc int; v_fora int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM erp_compras_solicitacao WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso',false,'erro','Solicitação não encontrada.'); END IF;
  PERFORM public.fn__guarda_empresa(s.company_id);
  IF s.solicitante <> auth.uid() OR s.status <> 'rascunho' THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Só quem criou envia, e só o rascunho.');
  END IF;
  SELECT * INTO c FROM erp_compras_alcada_config WHERE company_id = s.company_id;
  IF NOT FOUND OR c.aprovador_principal_id IS NULL THEN
    RETURN jsonb_build_object('sucesso',false,'erro','A empresa ainda não definiu o aprovador (Compras > Alçada de compras).');
  END IF;
  IF auth.uid() = c.aprovador_principal_id AND c.aprovador_substituto_id IS NULL THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Você é o único aprovador: defina um substituto na alçada para aprovar a sua própria solicitação.');
  END IF;
  SELECT count(*) INTO v_itens FROM erp_compras_solicitacao_item WHERE solicitacao_id = p_id;
  IF v_itens = 0 THEN RETURN jsonb_build_object('sucesso',false,'erro','Inclua ao menos um item.'); END IF;

  IF s.urgente THEN
    -- urgente só vale se TODOS os itens estão liberados na alçada (por produto ou por categoria, sem acento/caixa)
    SELECT count(*) INTO v_fora FROM erp_compras_solicitacao_item i
     WHERE i.solicitacao_id = p_id
       AND NOT (i.produto_id IS NOT NULL AND i.produto_id = ANY (c.urgencia_produto_ids))
       AND NOT (i.categoria IS NOT NULL AND translate(lower(btrim(i.categoria)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') IN
                (SELECT translate(lower(btrim(x)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') FROM unnest(c.urgencia_categorias) x));
    IF v_fora > 0 THEN
      RETURN jsonb_build_object('sucesso',false,'erro',
        format('Compra urgente não liberada: %s item(ns) fora das categorias de urgência da alçada. Desmarque "urgente" e anexe os orçamentos.', v_fora));
    END IF;
  ELSE
    SELECT count(*) INTO v_orc FROM erp_compras_solicitacao_orcamento WHERE solicitacao_id = p_id;
    IF v_orc < c.min_orcamentos THEN
      RETURN jsonb_build_object('sucesso',false,'erro',
        format('Anexe %s orçamento(s) antes de enviar (faltam %s).', c.min_orcamentos, c.min_orcamentos - v_orc));
    END IF;
  END IF;

  UPDATE erp_compras_solicitacao SET status = 'aguardando_aprovacao', enviada_em = now(), atualizado_em = now() WHERE id = p_id;
  RETURN jsonb_build_object('sucesso',true);
END $$;
REVOKE ALL ON FUNCTION public.fn_compras_solicitacao_enviar(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_compras_solicitacao_enviar(uuid) TO authenticated;

-- ───────────────────────────── Aprovar / recusar ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_compras_solicitacao_decidir(p_id uuid, p_aprovar boolean, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s record; v_motivo text := NULLIF(btrim(coalesce(p_motivo,'')),'');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM erp_compras_solicitacao WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso',false,'erro','Solicitação não encontrada.'); END IF;
  PERFORM public.fn__guarda_empresa(s.company_id);
  IF s.status <> 'aguardando_aprovacao' THEN RETURN jsonb_build_object('sucesso',false,'erro','Esta solicitação não está aguardando aprovação.'); END IF;
  IF s.solicitante = auth.uid() THEN RETURN jsonb_build_object('sucesso',false,'erro','Quem solicita não aprova a própria compra.'); END IF;
  IF NOT public.fn_compras_solicitacao_pode_decidir(s.company_id, s.solicitante) THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Só o aprovador principal ou o substituto da alçada decide.');
  END IF;
  IF p_aprovar IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Escolha aprovar ou recusar.'); END IF;
  IF NOT p_aprovar AND v_motivo IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','Informe o motivo da recusa.'); END IF;
  UPDATE erp_compras_solicitacao SET status = CASE WHEN p_aprovar THEN 'aprovada' ELSE 'recusada' END,
         decidido_por = auth.uid(), decidido_em = now(), decisao_motivo = left(v_motivo, 1000), atualizado_em = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('sucesso',true,'status', CASE WHEN p_aprovar THEN 'aprovada' ELSE 'recusada' END);
END $$;
REVOKE ALL ON FUNCTION public.fn_compras_solicitacao_decidir(uuid, boolean, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_compras_solicitacao_decidir(uuid, boolean, text) TO authenticated;

-- ───────────────────────────── Cancelar (o solicitante, antes da decisão) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_compras_solicitacao_cancelar(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM erp_compras_solicitacao WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('sucesso',false,'erro','Solicitação não encontrada.'); END IF;
  PERFORM public.fn__guarda_empresa(s.company_id);
  IF s.solicitante <> auth.uid() OR s.status NOT IN ('rascunho','aguardando_aprovacao') THEN
    RETURN jsonb_build_object('sucesso',false,'erro','Só quem criou cancela, e só antes da decisão.');
  END IF;
  UPDATE erp_compras_solicitacao SET status = 'cancelada', atualizado_em = now() WHERE id = p_id;
  RETURN jsonb_build_object('sucesso',true);
END $$;
REVOKE ALL ON FUNCTION public.fn_compras_solicitacao_cancelar(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_compras_solicitacao_cancelar(uuid) TO authenticated;

-- ───────────────────────────── Listar (tela) ─────────────────────────────
-- Todas as solicitações da empresa (as 200 mais recentes) com itens, orçamentos e se a pessoa logada pode decidir.
CREATE OR REPLACE FUNCTION public.fn_compras_solicitacao_listar(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('sucesso', true,
    'sou_aprovador', EXISTS (SELECT 1 FROM erp_compras_alcada_config c WHERE c.company_id = p_company_id
                               AND auth.uid() IN (c.aprovador_principal_id, c.aprovador_substituto_id)),
    'alcada', public.fn_compras_alcada_obter(p_company_id) - 'pode_configurar',
    'solicitacoes', coalesce((
      SELECT jsonb_agg(x ORDER BY x.criado_em DESC) FROM (
        SELECT s.id, s.numero, s.titulo, s.justificativa, s.urgente, s.status, s.criado_em, s.enviada_em,
               s.decidido_em, s.decisao_motivo,
               s.solicitante = auth.uid() AS minha,
               s.status = 'aguardando_aprovacao' AND public.fn_compras_solicitacao_pode_decidir(s.company_id, s.solicitante) AS posso_decidir,
               coalesce(us.full_name, us.email) AS solicitante_nome,
               coalesce(ud.full_name, ud.email) AS decidido_por_nome,
               coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'produto_id',i.produto_id,'descricao',i.descricao,
                         'categoria',i.categoria,'quantidade',i.quantidade,'unidade',i.unidade) ORDER BY i.ordem)
                           FROM erp_compras_solicitacao_item i WHERE i.solicitacao_id = s.id), '[]'::jsonb) AS itens,
               coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'fornecedor_nome',o.fornecedor_nome,'valor_total',o.valor_total,
                         'prazo_entrega',o.prazo_entrega,'observacao',o.observacao,'arquivo_path',o.arquivo_path,
                         'arquivo_nome',o.arquivo_nome) ORDER BY o.valor_total)
                           FROM erp_compras_solicitacao_orcamento o WHERE o.solicitacao_id = s.id), '[]'::jsonb) AS orcamentos
          FROM erp_compras_solicitacao s
          LEFT JOIN public.users us ON us.id = s.solicitante
          LEFT JOIN public.users ud ON ud.id = s.decidido_por
         WHERE s.company_id = p_company_id
         ORDER BY s.criado_em DESC
         LIMIT 200) x), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.fn_compras_solicitacao_listar(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_compras_solicitacao_listar(uuid) TO authenticated;

-- ───────────────────────────── Menu / inventário ─────────────────────────────
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, layer, icone, rota, ordem, ativo, is_shared, descricao)
VALUES ('commerce_compras_solicitacoes', 'Solicitações de compra', 'commerce', 'compras', NULL, '📝',
        '/dashboard/compras/solicitacoes', 188, true, true,
        'Pedir uma compra com os orçamentos anexados e aprovar ou recusar pela alçada da empresa.')
ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, subgrupo = EXCLUDED.subgrupo,
  icone = EXCLUDED.icone, rota = EXCLUDED.rota, ordem = EXCLUDED.ordem, ativo = true,
  is_shared = EXCLUDED.is_shared, descricao = EXCLUDED.descricao;

-- Mesmos planos da tela irmã "Alçada de compras".
INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'commerce_compras_solicitacoes' FROM public.plan_modules pm
WHERE pm.module_id = 'commerce_compras_alcada'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'commerce_compras_solicitacoes');

INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto)
VALUES ('F.commerce.compras_solicitacoes', 'commerce_compras_solicitacoes', 'commerce', 'Solicitações de compra',
        'Solicitação de compra com itens e orçamentos anexados; aprovação/recusa (com motivo) pelo aprovador da alçada; compra urgente pelas categorias liberadas.',
        'pronto', 100)
ON CONFLICT (id) DO UPDATE SET titulo = EXCLUDED.titulo, descricao_executiva = EXCLUDED.descricao_executiva;

INSERT INTO public.system_screens (id, rota, area, modulo, titulo, descricao_funcional, estado_real, prioridade_monitoramento,
  rpcs_chamadas, componentes_principais, features_relacionadas)
VALUES ('commerce_compras_solicitacoes', '/dashboard/compras/solicitacoes', 'commerce', 'commerce_compras_solicitacoes',
  'Solicitações de compra',
  'Solicitações de compra da empresa (#1677 etapa 2): criar com itens, anexar orçamentos (3 ou 1, pela alçada), enviar; o aprovador principal/substituto aprova ou recusa com motivo; urgente dispensa orçamentos só nas categorias liberadas.',
  'pronto', 'media',
  ARRAY['fn_compras_solicitacao_listar','fn_compras_solicitacao_salvar','fn_compras_solicitacao_orcamento_adicionar',
        'fn_compras_solicitacao_orcamento_remover','fn_compras_solicitacao_enviar','fn_compras_solicitacao_decidir',
        'fn_compras_solicitacao_cancelar']::text[],
  ARRAY['SolicitacoesCompraPage']::text[], ARRAY['F.commerce.compras_solicitacoes']::text[])
ON CONFLICT (id) DO UPDATE SET titulo = EXCLUDED.titulo, descricao_funcional = EXCLUDED.descricao_funcional,
  rpcs_chamadas = EXCLUDED.rpcs_chamadas, features_relacionadas = EXCLUDED.features_relacionadas, atualizado_em = now();

INSERT INTO public.screen_route_features (screen_id, feature_id, peso, visibilidade)
SELECT 'commerce_compras_solicitacoes', 'F.commerce.compras_solicitacoes', 1, 'primary'
WHERE NOT EXISTS (SELECT 1 FROM public.screen_route_features WHERE screen_id = 'commerce_compras_solicitacoes' AND feature_id = 'F.commerce.compras_solicitacoes');

-- ───────────────────────────── "?" da tela (RD-95) ─────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Solicitações de compra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/compras/solicitacoes', 'gestao_empresarial', 'publicado'
FROM (VALUES
 ('compras.solic.filtro_status','Situação','Escolha quais solicitações ver: aguardando aprovação, rascunhos, aprovadas, recusadas ou todas.','Separa o que ainda depende de alguém do que já foi decidido.','Aguardando aprovação.','Procurar uma solicitação recusada no filtro "Aguardando".',1),
 ('compras.solic.nova','Nova solicitação','Toque para pedir uma compra.','Abre o formulário com a descrição, os itens e os orçamentos.','—','Comprar direto sem solicitar: a compra fica sem aprovação registrada.',2),
 ('compras.solic.titulo','O que comprar','Descreva em poucas palavras o que precisa ser comprado.','É o nome da solicitação na lista do aprovador.','Pastilhas de freio para estoque.','Escrever só "compra": o aprovador não sabe do que se trata.',3),
 ('compras.solic.justificativa','Justificativa','Explique por que a compra é necessária (opcional).','Ajuda o aprovador a decidir sem precisar perguntar.','Estoque zerado; 3 OS aguardando a peça.','Deixar em branco numa compra fora do comum.',4),
 ('compras.solic.urgente','Compra urgente','Marque só quando a compra não pode esperar os orçamentos.','Dispensa os orçamentos se TODOS os itens forem das categorias de urgência da alçada; o aprovador ainda decide.','Combustível para o guincho.','Marcar urgente com itens fora das categorias liberadas: o envio é recusado.',5),
 ('compras.solic.item_produto','Produto do cadastro','Escolha o produto do seu cadastro, se existir (opcional).','Traz a descrição e a categoria do produto, usada na regra de compra urgente.','Pastilha de freio dianteira.','Digitar o nome à mão quando o produto existe: a categoria não vem.',6),
 ('compras.solic.item_descricao','Descrição do item','O que será comprado.','Aparece para o aprovador e, depois, para o comprador.','Pastilha de freio dianteira — Gol G5.','Descrição genérica demais ("peças").',7),
 ('compras.solic.item_quantidade','Quantidade','Quantas unidades comprar.','Base para comparar os orçamentos.','4','Deixar 0: o item não é aceito.',8),
 ('compras.solic.item_unidade','Unidade','Unidade de compra (opcional).','Evita confusão entre caixa, peça e litro.','UN','Pedir 1 "CX" quando o orçamento é por peça.',9),
 ('compras.solic.item_categoria','Categoria','Categoria do item; vem do produto quando ele é escolhido.','Decide se a compra pode ser urgente (categorias liberadas na alçada).','Lubrificantes.','Escrever uma categoria diferente da usada na alçada.',10),
 ('compras.solic.adicionar_item','Adicionar item','Toque para incluir mais uma linha de item.','Uma solicitação pode ter vários itens.','—','Criar uma solicitação para cada item do mesmo fornecedor.',11),
 ('compras.solic.salvar','Salvar rascunho','Toque para gravar a solicitação como rascunho.','Depois de salvar, você anexa os orçamentos e envia.','—','Fechar a tela sem salvar.',12),
 ('compras.solic.orc_fornecedor','Fornecedor do orçamento','Nome do fornecedor que mandou o orçamento.','Identifica cada orçamento na comparação do aprovador.','Auto Peças Central.','Repetir o mesmo fornecedor para completar a quantidade exigida.',13),
 ('compras.solic.orc_valor','Valor total','Valor total do orçamento, com frete se houver.','O aprovador vê os orçamentos do menor para o maior valor.','R$ 480,00','Informar o preço unitário em vez do total.',14),
 ('compras.solic.orc_prazo','Prazo de entrega','Prazo informado pelo fornecedor (opcional).','Ajuda a escolher quando o preço é parecido.','2 dias úteis.','—',15),
 ('compras.solic.orc_arquivo','Arquivo do orçamento','Anexe o PDF ou a foto do orçamento (até 10 MB).','Fica guardado na solicitação para o aprovador conferir.','orcamento-central.pdf','Anexar foto ilegível.',16),
 ('compras.solic.orc_adicionar','Anexar orçamento','Toque para gravar o orçamento na solicitação.','A solicitação só é enviada com a quantidade de orçamentos da alçada (3 ou 1).','—','Enviar sem os orçamentos: o sistema avisa quantos faltam.',17),
 ('compras.solic.enviar','Enviar para aprovação','Toque quando os itens e os orçamentos estiverem completos.','A solicitação vai para o aprovador principal ou o substituto; depois de enviada não se altera.','—','Enviar antes de conferir os itens.',18),
 ('compras.solic.cancelar','Cancelar solicitação','Toque para desistir da compra (só quem criou, antes da decisão).','Tira a solicitação da fila do aprovador.','—','Cancelar em vez de corrigir um rascunho.',19),
 ('compras.solic.aprovar','Aprovar','Toque para aprovar a compra (aprovador principal ou substituto).','Libera a compra; fica registrado quem aprovou e quando.','—','Aprovar sem abrir os orçamentos.',20),
 ('compras.solic.recusar','Recusar','Escreva o motivo e toque em Recusar.','Devolve a decisão ao solicitante com a explicação.','Pedir um 3º orçamento de fornecedor local.','Recusar sem motivo: o sistema não aceita.',21),
 ('compras.solic.motivo','Motivo da decisão','Explique a recusa (obrigatório) ou deixe uma observação na aprovação.','Fica registrado na solicitação.','Valor acima do orçado para o mês.','—',22)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, status = EXCLUDED.status;
