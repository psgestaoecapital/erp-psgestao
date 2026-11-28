-- P&M · Núcleo (CEO 23/11: "apoio de núcleo para o P&M") — blueprint vivo vertical 'pm', tela 17 (Configurações),
-- requisito "ref. mercado mundial · 23/11": Campos adicionais, datas personalizadas e grupos/segmentação no
-- cadastro de pessoa (o cliente da agência = agency_clientes).
--
-- Grupos/segmentação JÁ EXISTEM (agency_grupos_clientes + agency_clientes.grupo_id/segmento) — não são duplicados.
-- O que falta e esta migration entrega: CAMPOS PERSONALIZADOS (inclusive do tipo data) definíveis por empresa e
-- preenchidos por cliente. A UI (P&M › Configurações para definir os campos; ficha do cliente para preencher) é a
-- próxima fatia (consumida pela vertical); aqui fica a estrutura de núcleo que o P&M consome.
--
-- Disciplina: ADITIVO e idempotente; RLS por empresa (is_admin() OR company_id IN get_user_company_ids());
-- REVOKE anon; funções SECURITY DEFINER com guarda de empresa; NUNCA UPDATE/DELETE em dado de cliente
-- (agency_clientes não é tocada). RD-100: nenhum nome de terceiro.

-- ── 1) Definição dos campos personalizados, por empresa ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agency_cliente_campo_def (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  chave         text NOT NULL CHECK (chave ~ '^[a-z][a-z0-9_]{0,39}$'),
  rotulo        text NOT NULL CHECK (length(btrim(rotulo)) > 0),
  tipo          text NOT NULL DEFAULT 'texto' CHECK (tipo IN ('texto','numero','data','lista','booleano')),
  opcoes        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- rótulos da lista quando tipo = 'lista'
  obrigatorio   boolean NOT NULL DEFAULT false,
  ordem         integer NOT NULL DEFAULT 0,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.agency_cliente_campo_def IS
  'P&M núcleo: definição de campos personalizados (inclui tipo data) do cadastro de cliente da agência, por empresa.';
COMMENT ON COLUMN public.agency_cliente_campo_def.chave IS 'Identificador técnico do campo (minúsculas, único por empresa).';
COMMENT ON COLUMN public.agency_cliente_campo_def.opcoes IS 'Rótulos da lista (array JSON de strings) quando tipo = lista.';
CREATE UNIQUE INDEX IF NOT EXISTS agency_cliente_campo_def_chave_uk
  ON public.agency_cliente_campo_def (company_id, chave);
CREATE INDEX IF NOT EXISTS agency_cliente_campo_def_empresa_idx
  ON public.agency_cliente_campo_def (company_id, ordem) WHERE ativo;

-- ── 2) Valor de cada campo por cliente (tipado) ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agency_cliente_campo_valor (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cliente_id    uuid NOT NULL REFERENCES public.agency_clientes(id) ON DELETE CASCADE,
  campo_id      uuid NOT NULL REFERENCES public.agency_cliente_campo_def(id) ON DELETE CASCADE,
  valor_texto   text,
  valor_num     numeric,
  valor_data    date,
  valor_bool    boolean,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.agency_cliente_campo_valor IS
  'P&M núcleo: valor de um campo personalizado para um cliente da agência (um registro por cliente+campo).';
CREATE UNIQUE INDEX IF NOT EXISTS agency_cliente_campo_valor_uk
  ON public.agency_cliente_campo_valor (cliente_id, campo_id);
CREATE INDEX IF NOT EXISTS agency_cliente_campo_valor_cliente_idx
  ON public.agency_cliente_campo_valor (company_id, cliente_id);

-- ── 3) RLS por empresa + grants (nada para anônimo) ─────────────────────────────────────────────────────────────
ALTER TABLE public.agency_cliente_campo_def   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_cliente_campo_valor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agency_cliente_campo_def, public.agency_cliente_campo_valor FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS agency_cliente_campo_def_empresa ON public.agency_cliente_campo_def;
CREATE POLICY agency_cliente_campo_def_empresa ON public.agency_cliente_campo_def FOR ALL TO authenticated
  USING (is_admin() OR company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (is_admin() OR company_id IN (SELECT get_user_company_ids()));

DROP POLICY IF EXISTS agency_cliente_campo_valor_empresa ON public.agency_cliente_campo_valor;
CREATE POLICY agency_cliente_campo_valor_empresa ON public.agency_cliente_campo_valor FOR ALL TO authenticated
  USING (is_admin() OR company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (is_admin() OR company_id IN (SELECT get_user_company_ids()));

GRANT SELECT, INSERT, UPDATE ON public.agency_cliente_campo_def TO authenticated;             -- exclusão é lógica (ativo=false)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_cliente_campo_valor TO authenticated;    -- limpar um valor remove a linha
GRANT ALL ON public.agency_cliente_campo_def, public.agency_cliente_campo_valor TO service_role;

-- ── 4) Funções (SECURITY DEFINER, guarda de empresa, sem acesso a dado de outra empresa) ────────────────────────

-- Lista as definições de campos da empresa (ativas por padrão), em ordem.
CREATE OR REPLACE FUNCTION public.fn_agency_cliente_campo_def_listar(p_company_id uuid, p_incluir_inativos boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_itens jsonb;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'company_id é obrigatório');
  END IF;
  IF NOT is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.ordem, d.rotulo), '[]'::jsonb) INTO v_itens
  FROM public.agency_cliente_campo_def d
  WHERE d.company_id = p_company_id AND (p_incluir_inativos OR d.ativo);
  RETURN jsonb_build_object('ok', true, 'itens', v_itens);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agency_cliente_campo_def_listar(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_cliente_campo_def_listar(uuid, boolean) TO authenticated, service_role;

-- Cria/atualiza a definição de um campo. Valida tipo e chave única por empresa.
CREATE OR REPLACE FUNCTION public.fn_agency_cliente_campo_def_salvar(
  p_company_id uuid, p_id uuid, p_chave text, p_rotulo text, p_tipo text,
  p_opcoes jsonb DEFAULT '[]'::jsonb, p_obrigatorio boolean DEFAULT false,
  p_ordem integer DEFAULT 0, p_ativo boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_chave text := lower(NULLIF(btrim(p_chave), ''));
  v_rotulo text := NULLIF(btrim(p_rotulo), '');
  v_tipo text := NULLIF(btrim(p_tipo), '');
  v_id uuid;
BEGIN
  IF p_company_id IS NULL OR v_rotulo IS NULL OR v_tipo IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'empresa, rótulo e tipo são obrigatórios');
  END IF;
  IF NOT is_admin() AND p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;
  IF v_tipo NOT IN ('texto','numero','data','lista','booleano') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tipo inválido');
  END IF;
  IF v_chave IS NULL OR v_chave !~ '^[a-z][a-z0-9_]{0,39}$' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'chave inválida (minúsculas, letras/números/_; começa por letra)');
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.agency_cliente_campo_def (company_id, chave, rotulo, tipo, opcoes, obrigatorio, ordem, ativo)
    VALUES (p_company_id, v_chave, v_rotulo, v_tipo, COALESCE(p_opcoes, '[]'::jsonb), COALESCE(p_obrigatorio,false),
            COALESCE(p_ordem,0), COALESCE(p_ativo,true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.agency_cliente_campo_def
       SET chave = v_chave, rotulo = v_rotulo, tipo = v_tipo, opcoes = COALESCE(p_opcoes,'[]'::jsonb),
           obrigatorio = COALESCE(p_obrigatorio,false), ordem = COALESCE(p_ordem,0),
           ativo = COALESCE(p_ativo,true), atualizado_em = now()
     WHERE id = p_id AND company_id = p_company_id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'campo não encontrado nesta empresa');
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'erro', 'já existe um campo com esta chave nesta empresa');
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agency_cliente_campo_def_salvar(uuid, uuid, text, text, text, jsonb, boolean, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_cliente_campo_def_salvar(uuid, uuid, text, text, text, jsonb, boolean, integer, boolean) TO authenticated, service_role;

-- Exclusão lógica da definição (preserva valores históricos).
CREATE OR REPLACE FUNCTION public.fn_agency_cliente_campo_def_excluir(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.agency_cliente_campo_def WHERE id = p_id;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'campo não encontrado');
  END IF;
  IF NOT is_admin() AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;
  UPDATE public.agency_cliente_campo_def SET ativo = false, atualizado_em = now() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agency_cliente_campo_def_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_cliente_campo_def_excluir(uuid) TO authenticated, service_role;

-- Campos (ativos) da empresa do cliente + o valor preenchido de cada um, para montar a ficha.
CREATE OR REPLACE FUNCTION public.fn_agency_cliente_campos(p_cliente_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_itens jsonb;
BEGIN
  SELECT company_id INTO v_company FROM public.agency_clientes WHERE id = p_cliente_id;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'cliente não encontrado');
  END IF;
  IF NOT is_admin() AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'campo_id', d.id, 'chave', d.chave, 'rotulo', d.rotulo, 'tipo', d.tipo,
           'opcoes', d.opcoes, 'obrigatorio', d.obrigatorio, 'ordem', d.ordem,
           'valor_texto', v.valor_texto, 'valor_num', v.valor_num,
           'valor_data', v.valor_data, 'valor_bool', v.valor_bool
         ) ORDER BY d.ordem, d.rotulo), '[]'::jsonb) INTO v_itens
  FROM public.agency_cliente_campo_def d
  LEFT JOIN public.agency_cliente_campo_valor v ON v.campo_id = d.id AND v.cliente_id = p_cliente_id
  WHERE d.company_id = v_company AND d.ativo;
  RETURN jsonb_build_object('ok', true, 'itens', v_itens);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agency_cliente_campos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_cliente_campos(uuid) TO authenticated, service_role;

-- Grava (ou limpa) o valor de um campo para um cliente, tipado pela definição. Valor vazio remove a linha.
CREATE OR REPLACE FUNCTION public.fn_agency_cliente_campo_valor_salvar(p_cliente_id uuid, p_campo_id uuid, p_valor text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid; v_tipo text; v_opcoes jsonb; v_in text := NULLIF(btrim(p_valor), '');
  v_texto text; v_num numeric; v_data date; v_bool boolean;
BEGIN
  SELECT d.company_id, d.tipo, d.opcoes INTO v_company, v_tipo, v_opcoes
    FROM public.agency_cliente_campo_def d WHERE d.id = p_campo_id AND d.ativo;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'campo não encontrado ou inativo');
  END IF;
  IF NOT is_admin() AND v_company NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agency_clientes c WHERE c.id = p_cliente_id AND c.company_id = v_company) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'cliente não pertence à empresa do campo');
  END IF;

  -- valor vazio: remove a linha (limpa o campo)
  IF v_in IS NULL THEN
    DELETE FROM public.agency_cliente_campo_valor WHERE cliente_id = p_cliente_id AND campo_id = p_campo_id;
    RETURN jsonb_build_object('ok', true, 'limpo', true);
  END IF;

  BEGIN
    IF v_tipo = 'numero' THEN
      v_num := v_in::numeric;
    ELSIF v_tipo = 'data' THEN
      v_data := v_in::date;
    ELSIF v_tipo = 'booleano' THEN
      v_bool := (lower(v_in) IN ('true','t','1','sim','s'));
    ELSIF v_tipo = 'lista' THEN
      IF NOT (v_opcoes ? v_in) THEN
        RETURN jsonb_build_object('ok', false, 'erro', 'valor fora das opções da lista');
      END IF;
      v_texto := v_in;
    ELSE
      v_texto := v_in;
    END IF;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'valor inválido para o tipo ' || v_tipo);
  END;

  INSERT INTO public.agency_cliente_campo_valor
    (company_id, cliente_id, campo_id, valor_texto, valor_num, valor_data, valor_bool, atualizado_em)
  VALUES (v_company, p_cliente_id, p_campo_id, v_texto, v_num, v_data, v_bool, now())
  ON CONFLICT (cliente_id, campo_id) DO UPDATE
    SET valor_texto = EXCLUDED.valor_texto, valor_num = EXCLUDED.valor_num,
        valor_data = EXCLUDED.valor_data, valor_bool = EXCLUDED.valor_bool, atualizado_em = now();
  RETURN jsonb_build_object('ok', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agency_cliente_campo_valor_salvar(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_cliente_campo_valor_salvar(uuid, uuid, text) TO authenticated, service_role;
