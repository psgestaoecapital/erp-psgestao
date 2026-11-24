-- Hub · §315 C-2 (Orçamento por EAP) — campo "Observação" por item do orçamento.
-- Blueprint tela 315, requisito "Dados de cada item" (parcial): faltava observação (texto livre).
-- Aditivo e idempotente: coluna NULLable, sem default obrigatório, sem tocar RLS/estrutura de outra tabela
-- nem dado de cliente. As funções já existentes são apenas estendidas (parâmetro opcional ao final e
-- um campo a mais na leitura), preservando a guarda por empresa e o SECURITY DEFINER.

-- 1) Coluna aditiva (texto livre, opcional)
ALTER TABLE public.projetos_orcamento_item_eap
  ADD COLUMN IF NOT EXISTS observacao text;

COMMENT ON COLUMN public.projetos_orcamento_item_eap.observacao IS
  'Observação livre do item do orçamento (especificação, condição de execução, restrição). Opcional.';

-- 2) Salvar: novo parâmetro opcional p_observacao (ao FINAL, para não quebrar chamadas posicionais).
-- Como a assinatura ganha um parâmetro, dropamos a assinatura antiga (9 args) para não deixar
-- um overload obsoleto que ignoraria a observação. O único chamador em runtime é a tela (named params),
-- e o importador (§334) escreve inline — nenhum objeto do banco depende desta função.
DROP FUNCTION IF EXISTS public.fn_projetos_orcamento_item_eap_salvar(
  uuid, uuid, numeric, text, text, text, numeric, numeric, uuid);

CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_item_eap_salvar(
  p_orcamento_id uuid,
  p_servico_id uuid,
  p_quantidade numeric,
  p_local_tipo text DEFAULT NULL::text,
  p_local_nome text DEFAULT NULL::text,
  p_eap_codigo text DEFAULT NULL::text,
  p_custo_material_unit numeric DEFAULT NULL::numeric,
  p_custo_mao_obra_unit numeric DEFAULT NULL::numeric,
  p_item_id uuid DEFAULT NULL::uuid,
  p_observacao text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company   uuid;
  v_servico   record;
  v_eap       text;
  v_mat       numeric;
  v_mo        numeric;
  v_unit      numeric;
  v_qtd       numeric;
  v_item_id   uuid;
  v_obs       text;
BEGIN
  -- Guarda de empresa: o orçamento tem de ser da empresa do usuário
  SELECT o.company_id INTO v_company
  FROM public.erp_orcamentos o
  WHERE o.id = p_orcamento_id
    AND o.company_id IN (SELECT get_user_company_ids());
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'sem acesso ao orçamento %', p_orcamento_id USING ERRCODE = '42501';
  END IF;

  -- Serviço do catálogo da MESMA empresa (satisfaz o CHECK chk_orc_item_ref_compativel)
  SELECT s.id, s.codigo, s.nome, s.unidade, s.eap_codigo, s.ref_padrao_codigo,
         COALESCE(s.custo_material, 0) AS custo_material,
         COALESCE(s.custo_mao_obra, 0) AS custo_mao_obra
  INTO v_servico
  FROM public.projetos_servicos s
  WHERE s.id = p_servico_id
    AND s.company_id = v_company
    AND COALESCE(s.ativo, true) = true
    AND s.deleted_at IS NULL;
  IF v_servico.id IS NULL THEN
    RAISE EXCEPTION 'serviço % não encontrado no catálogo desta empresa', p_servico_id
      USING ERRCODE = 'P0002';
  END IF;

  -- EAP efetiva: override do parâmetro ou a do serviço; obrigatória
  v_eap := COALESCE(NULLIF(btrim(p_eap_codigo), ''), NULLIF(btrim(v_servico.eap_codigo), ''));
  IF v_eap IS NULL THEN
    RAISE EXCEPTION 'código da EAP obrigatório (o serviço não tem EAP; informe p_eap_codigo)'
      USING ERRCODE = '22023';
  END IF;

  -- Custos efetivos: override ou os do serviço; nunca negativos
  v_mat := COALESCE(p_custo_material_unit, v_servico.custo_material);
  v_mo  := COALESCE(p_custo_mao_obra_unit, v_servico.custo_mao_obra);
  v_qtd := COALESCE(p_quantidade, 0);
  IF v_qtd < 0 OR v_mat < 0 OR v_mo < 0 THEN
    RAISE EXCEPTION 'quantidade e custos não podem ser negativos' USING ERRCODE = '22023';
  END IF;
  v_unit := v_mat + v_mo;
  v_obs  := NULLIF(btrim(p_observacao), '');

  -- Item compartilhado (erp_orcamentos_itens): insere novo ou atualiza o existente.
  -- O trigger recalc_orcamento_total recalcula o total do orçamento a partir do subtotal.
  IF p_item_id IS NULL THEN
    INSERT INTO public.erp_orcamentos_itens
      (orcamento_id, company_id, tipo_item, servico_id, servico_codigo, servico_descricao,
       unidade, quantidade, preco_unitario, preco_custo, subtotal)
    VALUES
      (p_orcamento_id, v_company, 'servico', v_servico.id, v_servico.codigo, v_servico.nome,
       v_servico.unidade, v_qtd, v_unit, v_unit, round(v_qtd * v_unit, 2))
    RETURNING id INTO v_item_id;
  ELSE
    UPDATE public.erp_orcamentos_itens
       SET tipo_item = 'servico',
           servico_id = v_servico.id,
           servico_codigo = v_servico.codigo,
           servico_descricao = v_servico.nome,
           unidade = v_servico.unidade,
           quantidade = v_qtd,
           preco_unitario = v_unit,
           preco_custo = v_unit,
           subtotal = round(v_qtd * v_unit, 2)
     WHERE id = p_item_id
       AND orcamento_id = p_orcamento_id
       AND company_id = v_company
       AND excluido_em IS NULL
    RETURNING id INTO v_item_id;
    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'item % não encontrado neste orçamento', p_item_id USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- Complemento EAP 1:1 (upsert por orcamento_item_id)
  INSERT INTO public.projetos_orcamento_item_eap
    (orcamento_item_id, company_id, eap_codigo, ref_padrao_codigo, local_tipo, local_nome,
     quantidade, custo_material_unit, custo_mao_obra_unit, origem, observacao)
  VALUES
    (v_item_id, v_company, v_eap, v_servico.ref_padrao_codigo,
     NULLIF(btrim(p_local_tipo), ''), NULLIF(btrim(p_local_nome), ''),
     v_qtd, v_mat, v_mo, 'empresa', v_obs)
  ON CONFLICT (orcamento_item_id) DO UPDATE
    SET eap_codigo          = EXCLUDED.eap_codigo,
        ref_padrao_codigo   = EXCLUDED.ref_padrao_codigo,
        local_tipo          = EXCLUDED.local_tipo,
        local_nome          = EXCLUDED.local_nome,
        quantidade          = EXCLUDED.quantidade,
        custo_material_unit = EXCLUDED.custo_material_unit,
        custo_mao_obra_unit = EXCLUDED.custo_mao_obra_unit,
        observacao          = EXCLUDED.observacao,
        atualizado_em       = now();

  RETURN jsonb_build_object(
    'ok', true,
    'item_id', v_item_id,
    'eap_codigo', v_eap,
    'subtotal', round(v_qtd * v_unit, 2)
  );
END;
$function$;

-- Guarda da nova assinatura (SECURITY DEFINER): fora do alcance de anon/public, só authenticated.
REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_item_eap_salvar(
  uuid, uuid, numeric, text, text, text, numeric, numeric, uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_item_eap_salvar(
  uuid, uuid, numeric, text, text, text, numeric, numeric, uuid, text) TO authenticated;
COMMENT ON FUNCTION public.fn_projetos_orcamento_item_eap_salvar(
  uuid, uuid, numeric, text, text, text, numeric, numeric, uuid, text) IS
  'Hub §315: cria/edita item do orçamento por EAP (serviço do catálogo da empresa). Guarda por empresa via get_user_company_ids(). p_observacao: texto livre opcional do item.';

-- 3) Listar: devolve também a observação do item.
CREATE OR REPLACE FUNCTION public.fn_projetos_orcamento_item_eap_listar(p_orcamento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid;
  v_itens   jsonb;
BEGIN
  -- Guarda: o orçamento tem de ser de uma empresa do usuário.
  SELECT o.company_id INTO v_company
  FROM public.erp_orcamentos o
  WHERE o.id = p_orcamento_id
    AND o.company_id IN (SELECT get_user_company_ids());
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'sem acesso ao orçamento %', p_orcamento_id USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'item_id',             i.id,
             'servico_id',          i.servico_id,
             'servico_codigo',      i.servico_codigo,
             'servico_descricao',   i.servico_descricao,
             'unidade',             i.unidade,
             'eap_codigo',          e.eap_codigo,
             'local_tipo',          e.local_tipo,
             'local_nome',          e.local_nome,
             'quantidade',          i.quantidade,
             'custo_material_unit', e.custo_material_unit,
             'custo_mao_obra_unit', e.custo_mao_obra_unit,
             'observacao',          e.observacao,
             'subtotal',            i.subtotal
           )
           ORDER BY e.eap_codigo NULLS LAST, e.local_nome NULLS LAST, i.created_at
         ), '[]'::jsonb)
  INTO v_itens
  FROM public.erp_orcamentos_itens i
  JOIN public.projetos_orcamento_item_eap e ON e.orcamento_item_id = i.id
  WHERE i.orcamento_id = p_orcamento_id
    AND i.company_id = v_company
    AND i.excluido_em IS NULL;

  RETURN jsonb_build_object('ok', true, 'itens', v_itens);
END;
$function$;

-- Guarda da leitura (SECURITY DEFINER): o CREATE OR REPLACE acima reseta a ACL, então
-- reaplicamos REVOKE anon/public + GRANT authenticated (check_fn_guards · [revoke_anon]).
REVOKE ALL ON FUNCTION public.fn_projetos_orcamento_item_eap_listar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_projetos_orcamento_item_eap_listar(uuid) TO authenticated;

-- 4) RD-95: "?" do novo campo (idempotente por chave).
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.orcamento_eap.item_observacao',
   '/dashboard/projetos/obras/[id]/orcamento',
   'Orçamento por EAP',
   'Observação',
   'Uma observação livre sobre este item (especificação de marca/modelo, condição de execução, restrição). Opcional.',
   'Registra detalhes que não cabem nos demais campos, para orientar quem executa e quem revisa o orçamento.',
   'Porcelanato acetinado 60×60, assentamento com argamassa AC-III',
   'Colocar aqui o código ou o preço — use os campos próprios; a observação é texto livre.',
   'projetos', 170, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;
