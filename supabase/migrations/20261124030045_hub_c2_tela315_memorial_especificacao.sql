-- Hub · Onda C-2 · tela 315 (Orçamento por EAP) — Memorial descritivo e especificação técnica por item.
-- Blueprint hub_projetos §315 (essencial): "Memorial descritivo e especificação técnica por serviço da EAP
--  (o que, como, material e norma), impresso junto do orçamento e reaproveitado na entrega."
-- Fatia de BANCO (aditiva): duas colunas de texto no complemento EAP (tabela do Hub, NÃO nas compartilhadas
--  erp_orcamentos/erp_orcamentos_itens) + duas RPCs novas guardadas por empresa. A UI consome depois.
-- Idempotente: ADD COLUMN IF NOT EXISTS; CREATE OR REPLACE só de funções NOVAS.

-- ───────────────────── colunas aditivas (complemento Hub, RLS já ligada na tabela) ─────────────────────
ALTER TABLE public.projetos_orcamento_item_eap
  ADD COLUMN IF NOT EXISTS memorial_descritivo  text,
  ADD COLUMN IF NOT EXISTS especificacao_tecnica text;

COMMENT ON COLUMN public.projetos_orcamento_item_eap.memorial_descritivo  IS 'Memorial descritivo do serviço (o que e como executar). Hub §315.';
COMMENT ON COLUMN public.projetos_orcamento_item_eap.especificacao_tecnica IS 'Especificação técnica do serviço (material, norma, acabamento). Hub §315.';

-- ───────────────────────────── SALVAR (memorial + especificação do item) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_item_eap_memorial_salvar(
  p_item_id uuid, p_memorial text, p_especificacao text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_upd     uuid;
BEGIN
  -- Guarda de empresa: o item tem de pertencer a um orçamento da empresa do usuário.
  SELECT o.company_id INTO v_company
  FROM public.erp_orcamentos_itens i
  JOIN public.erp_orcamentos o ON o.id = i.orcamento_id
  WHERE i.id = p_item_id
    AND o.company_id IN (SELECT get_user_company_ids());
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'sem acesso ao item %', p_item_id USING ERRCODE = '42501';
  END IF;

  UPDATE public.projetos_orcamento_item_eap
     SET memorial_descritivo   = NULLIF(btrim(COALESCE(p_memorial, '')), ''),
         especificacao_tecnica = NULLIF(btrim(COALESCE(p_especificacao, '')), ''),
         atualizado_em         = now()
   WHERE orcamento_item_id = p_item_id
     AND company_id = v_company
  RETURNING orcamento_item_id INTO v_upd;
  IF v_upd IS NULL THEN
    RAISE EXCEPTION 'item % não tem complemento EAP neste orçamento', p_item_id USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('ok', true, 'item_id', p_item_id);
END;
$function$;

-- ───────────────────────────── LER (memorial + especificação por orçamento) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_item_eap_memorial_ler(p_orcamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_itens   jsonb;
BEGIN
  SELECT o.company_id INTO v_company
  FROM public.erp_orcamentos o
  WHERE o.id = p_orcamento_id
    AND o.company_id IN (SELECT get_user_company_ids());
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'sem acesso ao orçamento %', p_orcamento_id USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'item_id',               e.orcamento_item_id,
           'eap_codigo',            e.eap_codigo,
           'memorial_descritivo',   e.memorial_descritivo,
           'especificacao_tecnica', e.especificacao_tecnica
         ) ORDER BY e.eap_codigo), '[]'::jsonb)
    INTO v_itens
  FROM public.projetos_orcamento_item_eap e
  JOIN public.erp_orcamentos_itens i
    ON i.id = e.orcamento_item_id
   AND i.orcamento_id = p_orcamento_id
   AND i.excluido_em IS NULL
  WHERE e.company_id = v_company;

  RETURN jsonb_build_object('orcamento_id', p_orcamento_id, 'itens', COALESCE(v_itens, '[]'::jsonb));
END;
$function$;

-- Guarda: nunca anônimo; só usuário autenticado.
REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_item_eap_memorial_salvar(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_item_eap_memorial_ler(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_item_eap_memorial_salvar(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_item_eap_memorial_ler(uuid) TO authenticated;

-- ───────────────────────────── Ajuda (RD-95) das 2 chaves novas ─────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
 ('projetos.orcamento_eap.memorial','/dashboard/projetos/obras/[id]/orcamento','Orçamento · Item','Memorial descritivo','Descreva o que será executado neste serviço e como.','Vai impresso junto do orçamento e é reaproveitado na entrega, para o cliente e a equipe saberem o escopo do serviço.','Assentamento de porcelanato 60×60 com argamassa AC-III, juntas de 2 mm e rejunte flexível.','Deixar em branco e descobrir o escopo só na obra — o memorial é o combinado do serviço.','projetos',330,'publicado'),
 ('projetos.orcamento_eap.especificacao','/dashboard/projetos/obras/[id]/orcamento','Orçamento · Item','Especificação técnica','Informe material, norma e acabamento exigidos no serviço.','Padroniza o que o fornecedor/empreiteiro deve atender e serve de base para a vistoria de recebimento.','Porcelanato PEI-5, absorção ≤ 0,5% (ABNT NBR 15463), acabamento acetinado.','Confundir com o memorial — aqui vão os requisitos técnicos (material/norma), não o passo a passo.','projetos',331,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota            = EXCLUDED.rota,
  grupo           = EXCLUDED.grupo,
  rotulo          = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve  = EXCLUDED.para_que_serve,
  exemplo         = EXCLUDED.exemplo,
  erro_comum      = EXCLUDED.erro_comum,
  status          = 'publicado',
  atualizado_em   = now();
