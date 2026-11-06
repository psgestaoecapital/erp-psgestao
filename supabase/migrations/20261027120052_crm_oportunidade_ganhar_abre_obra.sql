-- Hub · Oportunidades: ganhar a oportunidade ABRE a obra automaticamente (blueprint — defeito mais
-- grave: "ganhos sem obra"). Delta FC (aud8/auditor_pdca_g 27/10) no /dashboard/projetos/oportunidades.
--
-- Hoje a tela move para 'ganho' por fn_crm_mover_etapa, que só carimba etapa/data_fechamento — a obra
-- nunca nascia. Esta função nova envolve as duas coisas numa transação: marca 'ganho' E cria a obra já
-- vinculada (projetos_obras.oportunidade_id = a oportunidade), reaproveitando EXATAMENTE o padrão de
-- numeração/nome/insert do fn_hub_criar_obra_rapida (OBR-AAAA-NNNN; nome pelo endereço quando houver).
--
-- ADITIVA: função NOVA (não altera fn_crm_mover_etapa, que segue servindo as demais transições), nenhuma
-- coluna/RLS/grant de tabela alterada; o INSERT em projetos_obras é o mesmo shape já em produção. É
-- IDEMPOTENTE: se a oportunidade já tem obra vinculada, não cria uma segunda — devolve a existente
-- (ja_existia=true) e apenas garante etapa='ganho'. Guarda de empresa idêntica às demais fn_crm_*.
CREATE OR REPLACE FUNCTION public.fn_crm_oportunidade_ganhar(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp      uuid;
  v_op        record;
  v_obra_id   uuid;
  v_numero    text;
  v_cli_nome  text;
  v_ano       text := to_char(current_date, 'YYYY');
  v_prefix    text;
  v_max       int;
  v_nome_end  text;
BEGIN
  SELECT company_id, cliente_id, titulo, valor_estimado, obra_endereco, obra_bairro, obra_cidade
    INTO v_op
    FROM public.erp_crm_oportunidade
   WHERE id = p_id AND deleted_at IS NULL;
  v_comp := v_op.company_id;

  -- Mesma guarda das demais fn_crm_* (CEO 28/09): a empresa tem de ser do usuário (serviço/cron passa).
  IF v_comp IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Oportunidade não encontrada');
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() AND v_comp NOT IN (SELECT public.get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Sem permissao');
  END IF;

  -- Sempre deixa a oportunidade em 'ganho' (idempotente: re-ganhar não muda nada além do carimbo).
  UPDATE public.erp_crm_oportunidade
     SET etapa = 'ganho',
         data_fechamento = COALESCE(data_fechamento, now()::date),
         updated_at = now()
   WHERE id = p_id;

  -- Já existe obra vinculada? Não cria segunda (idempotência) — devolve a que há.
  SELECT id, numero INTO v_obra_id, v_numero
    FROM public.projetos_obras
   WHERE company_id = v_comp AND oportunidade_id = p_id
   ORDER BY created_at
   LIMIT 1;
  IF v_obra_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'etapa', 'ganho', 'obra_id', v_obra_id,
                              'numero', v_numero, 'ja_existia', true);
  END IF;

  -- Nome do cliente para a obra (quando a oportunidade tem cliente cadastrado).
  SELECT COALESCE(NULLIF(btrim(c.nome_fantasia), ''), NULLIF(btrim(c.razao_social), ''))
    INTO v_cli_nome
    FROM public.erp_clientes c
   WHERE c.id = v_op.cliente_id;

  -- Numeração OBR-AAAA-NNNN por empresa (mesma regra do fn_hub_criar_obra_rapida).
  v_prefix := 'OBR-' || v_ano || '-';
  SELECT COALESCE(MAX(CAST(SUBSTRING(numero FROM '\d+$') AS int)), 0) INTO v_max
    FROM public.projetos_obras
   WHERE company_id = v_comp AND numero LIKE v_prefix || '%';

  -- Nome pelo endereço quando há endereço (distingue obras do mesmo cliente) — padrão #53. Sem endereço,
  -- fica NULL para cair no nome do cliente/título (evita nome começando com "— Cidade", sem logradouro).
  v_nome_end := CASE
    WHEN NULLIF(btrim(v_op.obra_endereco), '') IS NOT NULL
      THEN btrim(v_op.obra_endereco) || COALESCE(' — ' || NULLIF(btrim(v_op.obra_cidade), ''), '')
    ELSE NULL END;

  INSERT INTO public.projetos_obras(
    company_id, numero, nome, cliente_id, cliente_nome,
    endereco, bairro, cidade, valor_previsto, oportunidade_id, status
  ) VALUES (
    v_comp,
    v_prefix || LPAD((v_max + 1)::text, 4, '0'),
    COALESCE(v_nome_end, NULLIF(btrim(v_cli_nome), ''), NULLIF(btrim(v_op.titulo), ''), 'Obra'),
    v_op.cliente_id,
    v_cli_nome,
    NULLIF(btrim(v_op.obra_endereco), ''),
    NULLIF(btrim(v_op.obra_bairro), ''),
    NULLIF(btrim(v_op.obra_cidade), ''),
    COALESCE(v_op.valor_estimado, 0),
    p_id,
    'em_andamento'
  ) RETURNING id, numero INTO v_obra_id, v_numero;

  RETURN jsonb_build_object('ok', true, 'etapa', 'ganho', 'obra_id', v_obra_id,
                            'numero', v_numero, 'ja_existia', false);
END $function$;

REVOKE ALL ON FUNCTION public.fn_crm_oportunidade_ganhar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_crm_oportunidade_ganhar(uuid) TO authenticated, service_role;
