-- ============================================================
-- Oficina Onda 1 · 3.4 (backend) — mecanico_id = QUEM EXECUTOU (não quem clicou)
-- ============================================================
-- Defeito provado (RD-38): fn_oficina_apontamento_iniciar gravava mecanico_id = auth.uid(),
-- ou seja QUEM CLICOU (o balcão), não quem trabalhou. Nos 41 apontamentos, mecanico_id era
-- idêntico a criado_por (o mesmo clicador: 33× a conta do balcão, 6× a de diagnóstico). O executor
-- de verdade só existia em mecanico_nome (texto: "Gean/Alisson/Jefe", com grafia solta).
--
-- Fix: mecanico_id passa a significar o EXECUTOR (um id de usuário), e nunca mais o clicador.
--   - quem clicou continua honesto em criado_por (já preenchido, default auth.uid()) — nada se perde;
--   - o executor vem do seletor (p_mecanico_id) OU, quando a OS já tem responsável designado COM id
--     em erp_os_mecanico, é puxado dali como default (sem perguntar — mantém os 2 toques da Onda 1);
--   - quando não há como saber, grava mecanico_id NULL (executor não identificado, RD-51) — NUNCA
--     bloqueia o balcão e NUNCA grava executor errado. A exigência de "um toque" fica na tela (3.3),
--     não na RPC, pra não travar o apontamento entre este PR (backend) e o da tela.
--
-- Designação: fn_os_designar_responsavel / fn_os_add_auxiliar JÁ aceitam e gravam p_mecanico_id
-- (e tecnico_id na OS) — não precisam mudar aqui; a tela é que passará o id do seletor.
--
-- RD-61: os 41 apontamentos e os 177 registros de erp_os_mecanico NÃO recebem backfill por nome
-- (mapear nome→pessoa alimentaria comissão errada). Só desfazemos o valor POLUÍDO (clicador) em
-- mecanico_id dos apontamentos onde ele é igual a criado_por. Nenhuma linha some; nenhum outro
-- campo muda (status, tempo_real_h, tempo_cronometro_h, mecanico_nome, criado_por).

-- 1) Desfaz o valor poluído: onde mecanico_id == criado_por, era o clicador (não o executor) → NULL.
UPDATE public.erp_os_apontamento
   SET mecanico_id = NULL
 WHERE mecanico_id IS NOT NULL
   AND mecanico_id = criado_por;

-- 2) iniciar: mecanico_id vira o executor (seletor → default do designado com id → NULL honesto).
CREATE OR REPLACE FUNCTION public.fn_oficina_apontamento_iniciar(p_company_id uuid, p_os_id uuid, p_item_id uuid, p_mecanico_nome text DEFAULT NULL::text, p_mecanico_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_item record; v_id uuid; v_exec_id uuid; v_exec_nome text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  SELECT i.id, i.descricao, i.servico_id, i.tempo_estimado_h, i.aprovado INTO v_item
    FROM erp_os_diagnostico_item i
    WHERE i.id = p_item_id AND i.os_id = p_os_id AND i.company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'item nao encontrado nesta OS'); END IF;
  IF v_item.aprovado IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'item nao foi aprovado pelo cliente');
  END IF;
  SELECT id INTO v_id FROM erp_os_apontamento
    WHERE diagnostico_item_id = p_item_id AND company_id = p_company_id AND status = 'em_andamento'
    ORDER BY created_at DESC LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'apontamento_id', v_id, 'reaberto', true); END IF;

  -- executor: 1) o informado pelo seletor; 2) senão, o responsável designado da OS que tenha id.
  v_exec_id   := p_mecanico_id;
  v_exec_nome := nullif(btrim(coalesce(p_mecanico_nome,'')), '');
  IF v_exec_id IS NULL THEN
    SELECT m.mecanico_id, coalesce(v_exec_nome, m.mecanico_nome)
      INTO v_exec_id, v_exec_nome
      FROM erp_os_mecanico m
      WHERE m.os_id = p_os_id AND m.company_id = p_company_id
        AND coalesce(m.ativo, true) = true AND m.mecanico_id IS NOT NULL
      ORDER BY (m.papel = 'responsavel') DESC, m.entrou_em ASC NULLS LAST
      LIMIT 1;
  END IF;
  -- nome de exibição: o informado, senão o do usuário executor (quando resolvemos o id)
  IF v_exec_nome IS NULL AND v_exec_id IS NOT NULL THEN
    SELECT coalesce(nullif(btrim(u.full_name),''), u.email) INTO v_exec_nome FROM users u WHERE u.id = v_exec_id;
  END IF;

  -- NUNCA grava auth.uid() (clicador) como executor. Sem executor resolvido → mecanico_id NULL (honesto).
  INSERT INTO erp_os_apontamento (company_id, os_id, diagnostico_item_id, servico_id, descricao,
    mecanico_id, mecanico_nome, tempo_estimado_h, iniciado_em, status)
  VALUES (p_company_id, p_os_id, p_item_id, v_item.servico_id, v_item.descricao,
    v_exec_id, v_exec_nome, v_item.tempo_estimado_h, now(), 'em_andamento')
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'apontamento_id', v_id, 'reaberto', false,
    'mecanico_id', v_exec_id, 'mecanico_nome', v_exec_nome,
    'executor_identificado', (v_exec_id IS NOT NULL));
END $function$;
