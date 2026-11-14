-- RD-98 p3 (ORIGEM DE ESCRITA) · tela /dashboard/commerce/fichas (Fichas Técnicas, Comércio).
-- Code: desenvolvedor_4_g
--
-- Gap do auditor (aud8): system_screens.rpcs_chamadas estava VAZIO apesar de a tela gravar
-- ("Nova ficha técnica", itens, exclusão). A origem da ESCRITA não era rastreável porque a
-- página gravava direto nas tabelas (supabase.from('fichas_tecnicas').insert/update/delete e
-- idem ficha_itens), confiando só na RLS do cliente.
--
-- Esta migration cria o caminho de escrita GUARDADO (defense-in-depth, igual ao padrão
-- fn_cliente_criar_inline já usado na OTC): toda gravação passa a ser por RPC SECURITY DEFINER
-- que confere o acesso à empresa no servidor (get_user_company_ids()/is_admin()), e a tela
-- (PR de front) passa a chamar essas RPCs — tornando a origem da escrita rastreável no catálogo.
--
-- ADITIVA e idempotente: só CRIA funções novas (CREATE OR REPLACE) + 1 UPDATE de metadado em
-- system_screens. NÃO altera schema das tabelas, NÃO mexe em RLS/policies, NÃO toca dado de
-- cliente. A RLS das tabelas continua valendo para a leitura direta (.from) que a tela mantém.
--
-- RD-38 (provado no dado antes desta migration):
--   * fichas_tecnicas: RLS company-scoped (company_id IN get_user_company_ids() OR is_admin()).
--   * ficha_itens: RLS via ficha_id -> fichas_tecnicas.company_id.
--   * ficha_itens_ficha_id_fkey = ON DELETE CASCADE (excluir a ficha já apaga os itens).
--   * system_screens['/dashboard/commerce/fichas'].rpcs_chamadas = {} (vazio) antes daqui.

-- 1) Salvar ficha (INSERT quando p_id IS NULL; UPDATE parcial por COALESCE quando p_id informado)
CREATE OR REPLACE FUNCTION public.fn_ficha_tecnica_salvar(
  p_id                   uuid    DEFAULT NULL,
  p_company_id           uuid    DEFAULT NULL,
  p_nome                 text    DEFAULT NULL,
  p_categoria            text    DEFAULT NULL,
  p_descricao            text    DEFAULT NULL,
  p_unidade              text    DEFAULT NULL,
  p_codigo               text    DEFAULT NULL,
  p_mao_obra_direta      numeric DEFAULT NULL,
  p_custos_indiretos_pct numeric DEFAULT NULL,
  p_impostos_pct         numeric DEFAULT NULL,
  p_markup_pct           numeric DEFAULT NULL,
  p_ativo                boolean DEFAULT NULL
)
RETURNS public.fichas_tecnicas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_row     public.fichas_tecnicas;
  v_company uuid;
BEGIN
  IF p_id IS NULL THEN
    -- INSERT: empresa obrigatória e com acesso do usuário logado
    IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
      RAISE EXCEPTION 'Sem acesso a esta empresa';
    END IF;
    IF COALESCE(btrim(p_nome), '') = '' THEN
      RAISE EXCEPTION 'Nome da ficha obrigatorio';
    END IF;
    INSERT INTO public.fichas_tecnicas (
      company_id, nome, categoria, descricao, unidade, codigo,
      mao_obra_direta, custos_indiretos_pct, impostos_pct, markup_pct, ativo
    ) VALUES (
      p_company_id, btrim(p_nome),
      COALESCE(p_categoria, 'parede'),
      COALESCE(p_descricao, ''),
      COALESCE(p_unidade, 'm²'),
      COALESCE(p_codigo, ''),
      COALESCE(p_mao_obra_direta, 0),
      COALESCE(p_custos_indiretos_pct, 0),
      COALESCE(p_impostos_pct, 0),
      COALESCE(p_markup_pct, 30),
      COALESCE(p_ativo, true)
    )
    RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  -- UPDATE parcial: confere o acesso à empresa da ficha existente
  SELECT company_id INTO v_company FROM public.fichas_tecnicas WHERE id = p_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Ficha nao encontrada';
  END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;
  UPDATE public.fichas_tecnicas SET
    nome                 = COALESCE(p_nome, nome),
    categoria            = COALESCE(p_categoria, categoria),
    descricao            = COALESCE(p_descricao, descricao),
    unidade              = COALESCE(p_unidade, unidade),
    codigo               = COALESCE(p_codigo, codigo),
    mao_obra_direta      = COALESCE(p_mao_obra_direta, mao_obra_direta),
    custos_indiretos_pct = COALESCE(p_custos_indiretos_pct, custos_indiretos_pct),
    impostos_pct         = COALESCE(p_impostos_pct, impostos_pct),
    markup_pct           = COALESCE(p_markup_pct, markup_pct),
    ativo                = COALESCE(p_ativo, ativo),
    updated_at           = now()
  WHERE id = p_id
  RETURNING * INTO v_row;
  RETURN v_row;
END
$fn$;

-- 2) Excluir ficha (idempotente; cascade já apaga os itens)
CREATE OR REPLACE FUNCTION public.fn_ficha_tecnica_excluir(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM public.fichas_tecnicas WHERE id = p_id;
  IF v_company IS NULL THEN
    RETURN; -- já não existe: idempotente
  END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;
  DELETE FROM public.fichas_tecnicas WHERE id = p_id;
END
$fn$;

-- 3) Salvar item (INSERT quando p_id IS NULL; UPDATE parcial por COALESCE quando p_id informado)
CREATE OR REPLACE FUNCTION public.fn_ficha_item_salvar(
  p_id             uuid    DEFAULT NULL,
  p_ficha_id       uuid    DEFAULT NULL,
  p_ordem          integer DEFAULT NULL,
  p_codigo         text    DEFAULT NULL,
  p_nome           text    DEFAULT NULL,
  p_unidade        text    DEFAULT NULL,
  p_quantidade     numeric DEFAULT NULL,
  p_preco_unitario numeric DEFAULT NULL,
  p_fornecedor     text    DEFAULT NULL,
  p_obs            text    DEFAULT NULL
)
RETURNS public.ficha_itens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_row     public.ficha_itens;
  v_ficha   uuid;
  v_company uuid;
BEGIN
  -- resolve a ficha alvo (no update vem do próprio item; no insert, do parâmetro)
  IF p_id IS NOT NULL THEN
    SELECT ficha_id INTO v_ficha FROM public.ficha_itens WHERE id = p_id;
    IF v_ficha IS NULL THEN
      RAISE EXCEPTION 'Item nao encontrado';
    END IF;
  ELSE
    v_ficha := p_ficha_id;
  END IF;
  IF v_ficha IS NULL THEN
    RAISE EXCEPTION 'Ficha obrigatoria';
  END IF;

  SELECT company_id INTO v_company FROM public.fichas_tecnicas WHERE id = v_ficha;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.ficha_itens (
      ficha_id, ordem, codigo, nome, unidade, quantidade, preco_unitario, fornecedor, obs
    ) VALUES (
      v_ficha,
      COALESCE(p_ordem, 0),
      COALESCE(p_codigo, ''),
      COALESCE(NULLIF(btrim(p_nome), ''), 'Novo item'),
      COALESCE(p_unidade, 'un'),
      COALESCE(p_quantidade, 0),
      COALESCE(p_preco_unitario, 0),
      COALESCE(p_fornecedor, ''),
      COALESCE(p_obs, '')
    )
    RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  UPDATE public.ficha_itens SET
    ordem          = COALESCE(p_ordem, ordem),
    codigo         = COALESCE(p_codigo, codigo),
    nome           = COALESCE(p_nome, nome),
    unidade        = COALESCE(p_unidade, unidade),
    quantidade     = COALESCE(p_quantidade, quantidade),
    preco_unitario = COALESCE(p_preco_unitario, preco_unitario),
    fornecedor     = COALESCE(p_fornecedor, fornecedor),
    obs            = COALESCE(p_obs, obs)
  WHERE id = p_id
  RETURNING * INTO v_row;
  RETURN v_row;
END
$fn$;

-- 4) Excluir item (idempotente)
CREATE OR REPLACE FUNCTION public.fn_ficha_item_excluir(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_company uuid;
BEGIN
  SELECT ft.company_id INTO v_company
  FROM public.ficha_itens fi
  JOIN public.fichas_tecnicas ft ON ft.id = fi.ficha_id
  WHERE fi.id = p_id;
  IF v_company IS NULL THEN
    RETURN; -- já não existe: idempotente
  END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;
  DELETE FROM public.ficha_itens WHERE id = p_id;
END
$fn$;

-- Grants: fechado ao anon/PUBLIC (SECURITY DEFINER), aberto só a usuário logado.
REVOKE ALL ON FUNCTION public.fn_ficha_tecnica_salvar(uuid,uuid,text,text,text,text,text,numeric,numeric,numeric,numeric,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ficha_tecnica_salvar(uuid,uuid,text,text,text,text,text,numeric,numeric,numeric,numeric,boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_ficha_tecnica_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ficha_tecnica_excluir(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_ficha_item_salvar(uuid,uuid,integer,text,text,text,numeric,numeric,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ficha_item_salvar(uuid,uuid,integer,text,text,text,numeric,numeric,text,text) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_ficha_item_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ficha_item_excluir(uuid) TO authenticated;

-- 5) RD-98 p3: registrar a origem da ESCRITA no catálogo (views de leitura mantidas).
UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY[
         'fn_ficha_tecnica_salvar','fn_ficha_tecnica_excluir',
         'fn_ficha_item_salvar','fn_ficha_item_excluir'
       ]::text[]
 WHERE rota = '/dashboard/commerce/fichas';
