-- Hub de Projetos · tela 315 (Orçamento por EAP) — ESSENCIAL do blueprint hub_projetos:
--   "Memorial descritivo e especificação técnica por serviço da EAP (o que, como, material e norma)".
-- Status no blueprint: ausente. Esta migration entrega a BASE (colunas + RPCs); a edição na tela
-- vem em PR de front separada (via rápida), conforme a orientação de separar front × migration.
--
-- RD-26 (reusar, não recriar): o complemento 1:1 do item do Hub já existe
--   (public.projetos_orcamento_item_eap, PK orcamento_item_id -> erp_orcamentos_itens.id, RLS por company_id).
--   NÃO tocamos erp_orcamentos / erp_orcamentos_itens (compartilhadas com o Comércio).
-- ADITIVO: 2 colunas nullable na tabela do Hub + 2 funções NOVAS (sem CREATE OR REPLACE de função
--   compartilhada). RLS da tabela já cobre as colunas novas. Guarda de empresa via get_user_company_ids().
-- RD-38 (provado em produção, somente leitura, antes desta PR):
--   - projetos_orcamento_item_eap existe, RLS ligada; colunas memorial_descritivo/especificacao_tecnica = 0 (ausentes);
--   - get_user_company_ids() existe; padrão de grant das RPCs do item: authenticated + service_role (sem anon).
-- Code: desenvolvedor_4_g

-- 1) Colunas aditivas (idempotente)
ALTER TABLE public.projetos_orcamento_item_eap
  ADD COLUMN IF NOT EXISTS memorial_descritivo   text,
  ADD COLUMN IF NOT EXISTS especificacao_tecnica text;

COMMENT ON COLUMN public.projetos_orcamento_item_eap.memorial_descritivo IS
  'Hub §315: memorial descritivo do serviço da EAP (o que executar e como).';
COMMENT ON COLUMN public.projetos_orcamento_item_eap.especificacao_tecnica IS
  'Hub §315: especificação técnica do serviço da EAP (material, norma, acabamento).';

-- 2) RPC de gravação (NOVA) — guarda de empresa; só atualiza as colunas de texto do item.
CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_item_eap_memorial_salvar(
  p_item_id        uuid,
  p_memorial       text DEFAULT NULL,
  p_especificacao  text DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
BEGIN
  -- Guarda de empresa: o item precisa pertencer a orçamento de uma empresa do usuário.
  SELECT e.company_id INTO v_company
  FROM public.projetos_orcamento_item_eap e
  WHERE e.orcamento_item_id = p_item_id
    AND e.company_id IN (SELECT get_user_company_ids());
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'sem acesso ao item % do orçamento', p_item_id USING ERRCODE = '42501';
  END IF;

  UPDATE public.projetos_orcamento_item_eap
     SET memorial_descritivo   = NULLIF(btrim(p_memorial), ''),
         especificacao_tecnica = NULLIF(btrim(p_especificacao), ''),
         atualizado_em         = now()
   WHERE orcamento_item_id = p_item_id
     AND company_id = v_company;

  RETURN jsonb_build_object('ok', true, 'item_id', p_item_id);
END;
$function$;

-- 3) RPC de leitura (NOVA) — devolve o memorial/especificação de todos os itens de um orçamento,
--    filtrando pela(s) empresa(s) do usuário (guarda de empresa).
CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_item_eap_memorial_listar(
  p_orcamento_id uuid
) RETURNS TABLE(
  orcamento_item_id     uuid,
  memorial_descritivo   text,
  especificacao_tecnica text
)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT e.orcamento_item_id, e.memorial_descritivo, e.especificacao_tecnica
  FROM public.projetos_orcamento_item_eap e
  JOIN public.erp_orcamentos_itens i ON i.id = e.orcamento_item_id
  WHERE i.orcamento_id = p_orcamento_id
    AND e.company_id IN (SELECT get_user_company_ids());
$function$;

-- 4) Grants: mesmo padrão das demais RPCs do item (authenticated + service_role; nunca anon).
REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_item_eap_memorial_salvar(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_item_eap_memorial_salvar(uuid, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_item_eap_memorial_listar(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_item_eap_memorial_listar(uuid) TO authenticated, service_role;
