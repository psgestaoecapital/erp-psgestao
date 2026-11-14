-- PDCA Hub · /dashboard/projetos/obras/[id]/medicoes (Medições ao cliente)
-- Gaps do auditor_pdca_1 (08/11):
--   1) RD-98 p3: rota ausente em system_screens -> registra views/rpcs (origem do dado).
--   2) RD-98 p2: medição em RASCUNHO não tinha Editar -> fn_obra_medicao_editar (só rascunho).
--   3) RD-95: "?" na ação Editar nova.
-- Tudo ADITIVO e idempotente. Não altera/apaga dado de cliente aprovado. Aprovada é imutável.
-- RD-38 provado no PR (BEGIN/ROLLBACK).

-- 1) EDITAR uma medição em RASCUNHO (RD-98 p2) --------------------------------------
-- Reescreve as linhas do rascunho (soft-delete das antigas + insere as novas, mesma trava de
-- acumulado×contratado de fn_obra_medicao_criar). SÓ status='rascunho': aprovada é imutável aqui.
-- As linhas de rascunho NÃO entram no acumulado aprovado (acum só conta medição aprovada), então
-- reescrevê-las não mexe em dado financeiro. Preserva o id/numero/histórico da medição.
CREATE OR REPLACE FUNCTION public.fn_obra_medicao_editar(
  p_medicao_id uuid,
  p_tipo text DEFAULT 'percentual',
  p_competencia date DEFAULT CURRENT_DATE,
  p_itens jsonb DEFAULT '[]'::jsonb,
  p_observacoes text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_med    public.projetos_obra_medicao%ROWTYPE;
  v_obra   public.projetos_obras%ROWTYPE;
  v_total  numeric := 0;
  v_ln     jsonb;
  v_item   public.projetos_obra_item%ROWTYPE;
  v_valor  numeric;
  v_acum   numeric;
  v_contr  numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  IF p_tipo NOT IN ('percentual','quantidade') THEN RETURN jsonb_build_object('ok', false, 'erro', 'Tipo inválido.'); END IF;

  SELECT * INTO v_med FROM public.projetos_obra_medicao WHERE id = p_medicao_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Medição não encontrada.'); END IF;
  IF v_med.status <> 'rascunho' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Só é possível editar uma medição em rascunho. Medição aprovada é imutável.');
  END IF;

  SELECT * INTO v_obra FROM public.projetos_obras WHERE id = v_med.obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada.'); END IF;
  PERFORM public.fn__guarda_empresa(v_obra.company_id);

  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe ao menos uma linha de medição.');
  END IF;

  -- zera as linhas atuais do rascunho (soft-delete rastreável)
  UPDATE public.projetos_obra_medicao_item
     SET excluido_em = now()
   WHERE medicao_id = p_medicao_id AND excluido_em IS NULL;

  FOR v_ln IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    SELECT * INTO v_item FROM public.projetos_obra_item
     WHERE id = (v_ln->>'obra_item_id')::uuid AND obra_id = v_med.obra_id AND company_id = v_obra.company_id AND excluido_em IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item de escopo % não encontrado nesta obra.', v_ln->>'obra_item_id'; END IF;

    v_contr := COALESCE(v_item.valor_contratado, COALESCE(v_item.preco_unitario,0) * COALESCE(v_item.quantidade_contratada,0));

    IF p_tipo = 'percentual' THEN
      v_valor := round(COALESCE((v_ln->>'percentual')::numeric, 0) / 100.0 * v_contr, 2);
    ELSE
      v_valor := round(COALESCE((v_ln->>'quantidade')::numeric, 0) * COALESCE(v_item.preco_unitario, 0), 2);
    END IF;

    -- Acumulado já APROVADO deste item (este rascunho não conta) — mesma trava do criar.
    SELECT COALESCE(sum(mi.valor), 0) INTO v_acum
      FROM public.projetos_obra_medicao_item mi
      JOIN public.projetos_obra_medicao m ON m.id = mi.medicao_id
     WHERE mi.obra_item_id = v_item.id AND mi.excluido_em IS NULL
       AND m.status = 'aprovada' AND m.excluido_em IS NULL;

    IF v_acum + v_valor < -0.005 THEN
      RAISE EXCEPTION 'Linha negativa demais no item "%": o acumulado ficaria abaixo de zero.', COALESCE(v_item.descricao, v_item.id::text);
    END IF;
    IF v_contr > 0 AND v_acum + v_valor > v_contr + 0.005 THEN
      RAISE EXCEPTION 'Item "%": o acumulado (R$ %) passaria do contratado (R$ %).',
        COALESCE(v_item.descricao, v_item.id::text), round(v_acum + v_valor, 2), round(v_contr, 2);
    END IF;

    INSERT INTO public.projetos_obra_medicao_item (company_id, medicao_id, obra_item_id, percentual, quantidade, valor)
    VALUES (v_obra.company_id, p_medicao_id, v_item.id,
            CASE WHEN p_tipo = 'percentual' THEN COALESCE((v_ln->>'percentual')::numeric, 0) END,
            CASE WHEN p_tipo = 'quantidade' THEN COALESCE((v_ln->>'quantidade')::numeric, 0) END,
            v_valor);
    v_total := v_total + v_valor;
  END LOOP;

  UPDATE public.projetos_obra_medicao
     SET tipo = p_tipo, competencia = COALESCE(p_competencia, competencia),
         observacoes = NULLIF(btrim(p_observacoes), ''), valor_total = v_total, atualizado_em = now()
   WHERE id = p_medicao_id;

  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_obra.company_id, auth.uid(), 'projetos_obra_medicao', p_medicao_id::text, 'EDITOU',
          jsonb_build_object('tipo', v_med.tipo, 'competencia', v_med.competencia, 'valor_total', v_med.valor_total),
          jsonb_build_object('tipo', p_tipo, 'competencia', COALESCE(p_competencia, v_med.competencia), 'valor_total', v_total));

  RETURN jsonb_build_object('ok', true, 'medicao_id', p_medicao_id, 'numero', v_med.numero, 'valor_total', v_total);
END $function$;

REVOKE ALL ON FUNCTION public.fn_obra_medicao_editar(uuid, text, date, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_medicao_editar(uuid, text, date, jsonb, text) TO authenticated, service_role;

-- 2) RD-95 · "?" na ação Editar -----------------------------------------------------
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('projetos.medicao.editar', '/dashboard/projetos/obras/[id]/medicoes', 'Medições · Ações', 'Editar',
   'Corrige uma medição que ainda está em RASCUNHO (tipo, competência, linhas e observações) sem precisar excluir e recriar.',
   'Ajustar um rascunho antes de aprovar — mantém o mesmo número da medição e o histórico. Medição já aprovada é imutável (não aparece o Editar).',
   'Lançou 30% num item e era 40% → Editar → ajuste a linha → Lançar medição.',
   'Tentar editar uma medição aprovada: não dá — aprovada trava o acumulado. Para mudar, crie uma nova medição.',
   'hub_construcao', 11, 'publicado')
ON CONFLICT (chave) DO NOTHING;

-- 3) RD-98 p3 · registrar a rota em system_screens (origem do dado) ------------------
INSERT INTO public.system_screens (id, rota, area, titulo, modulo, estado_real, prioridade_monitoramento, views_consumidas, rpcs_chamadas, auditavel_robo, criado_em, atualizado_em)
VALUES (gen_random_uuid()::text, '/dashboard/projetos/obras/[id]/medicoes', 'hub_construcao', 'Medições ao cliente', 'projetos_obras', 'parcial', 'media',
        ARRAY['projetos_obra_item','projetos_obra_medicao'],
        ARRAY['fn_obra_medicao_listar','fn_obra_medicao_criar','fn_obra_medicao_editar','fn_obra_medicao_aprovar','fn_obra_medicao_excluir'],
        true, now(), now())
ON CONFLICT (rota) DO UPDATE
  SET views_consumidas = EXCLUDED.views_consumidas,
      rpcs_chamadas    = EXCLUDED.rpcs_chamadas,
      atualizado_em    = now();
