-- RD-41 · Contratos Recorrentes · CRUD completo com GUARDA FISCAL
-- ============================================================================
-- Origem: contratos lançados errados. A coluna AÇÕES só tinha "Ver →".
-- Regra do CEO (inviolável): excluir SÓ se o contrato não tem cobrança VIVA
--   (guarda híbrida "C"): pode_excluir = (receber_vivo=0 AND pagas=0 AND nf=0).
--   Contrato que gerou títulos que JÁ NÃO EXISTEM não tem o que orfanar.
--   Se houver título vivo/pago/NF → só ENCERRAR (para de faturar, mantém história).
-- O SISTEMA decide qual botão aparece — nunca o usuário. A guarda vive no BACKEND.
--
-- Também nesta migração (decisões do CEO):
--  2) erp_receber ganha contrato_id (a guarda não pode depender de parsear JSON).
--     Backfill a partir do event log (fatura_gerada.metadata->>'receber_id').
--     O gerador passa a CARIMBAR contrato_id.
--  3) Soft-delete por status='excluido' + excluido_em/por + motivo_exclusao (RD-30).
--  4) O gerador já filtra status='ativo' (whitelist) → encerrado/excluido/suspenso
--     não faturam. Versionamos as funções (antes só existiam no banco, sem migração).
-- ============================================================================

-- ── 0 · Schema: soft-delete no contrato (RD-30) ─────────────────────────────
ALTER TABLE erp_contratos
  ADD COLUMN IF NOT EXISTS excluido_em     timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por    uuid,
  ADD COLUMN IF NOT EXISTS motivo_exclusao text,
  ADD COLUMN IF NOT EXISTS encerrado_por   uuid;

-- ── 1 · Ponte real contrato ↔ receber (decisão 2 do CEO) ────────────────────
ALTER TABLE erp_receber
  ADD COLUMN IF NOT EXISTS contrato_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'erp_receber_contrato_id_fkey'
  ) THEN
    ALTER TABLE erp_receber
      ADD CONSTRAINT erp_receber_contrato_id_fkey
      FOREIGN KEY (contrato_id) REFERENCES erp_contratos(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_erp_receber_contrato_id
  ON erp_receber(contrato_id) WHERE contrato_id IS NOT NULL;

-- Backfill: liga os títulos existentes ao contrato via o event log (fonte histórica).
UPDATE erp_receber r
   SET contrato_id = e.contrato_id
  FROM erp_contratos_eventos e
 WHERE e.evento = 'fatura_gerada'
   AND e.metadata ? 'receber_id'
   AND (e.metadata->>'receber_id')::uuid = r.id
   AND r.contrato_id IS NULL;

-- ── 2 · GUARDA: a fonte única da verdade. A UI apenas OBEDECE. ───────────────
CREATE OR REPLACE FUNCTION fn_contrato_acoes_permitidas(p_contrato_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_contrato       record;
  v_receber_vivo   int;
  v_pagas          int;
  v_nfs            int;
  v_hist_eventos   int;
BEGIN
  SELECT * INTO v_contrato FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'contrato não encontrado');
  END IF;

  -- Estado VIVO (via contrato_id — join limpo, decisão 2 do CEO)
  SELECT count(*), count(*) FILTER (WHERE r.status = 'pago')
    INTO v_receber_vivo, v_pagas
    FROM erp_receber r WHERE r.contrato_id = p_contrato_id;

  -- NF emitida (não cancelada) atrelada a um título deste contrato
  SELECT count(*) INTO v_nfs
    FROM erp_nfse_emitidas nf
    JOIN erp_receber r ON r.id = nf.erp_receber_id
   WHERE r.contrato_id = p_contrato_id
     AND nf.cancelado_em IS NULL;

  -- Histórico: prova de que a máquina já rodou (mesmo que os títulos tenham sumido)
  SELECT count(*) INTO v_hist_eventos
    FROM erp_contratos_eventos
   WHERE contrato_id = p_contrato_id AND evento = 'fatura_gerada';

  RETURN jsonb_build_object(
    'ok',             true,
    'pode_editar',    true,
    'pode_excluir',   (v_receber_vivo = 0 AND v_pagas = 0 AND v_nfs = 0),   -- guarda híbrida C
    'pode_encerrar',  (v_contrato.status <> 'encerrado' AND v_contrato.status <> 'excluido'),
    'status',         v_contrato.status,
    'receber_vivo',   v_receber_vivo,
    'pagas',          v_pagas,
    'nfs',            v_nfs,
    'historico_titulos', COALESCE(v_contrato.total_titulos_gerados, 0),
    'historico_eventos', v_hist_eventos,
    'total_faturado',    COALESCE(v_contrato.total_faturado, 0),
    'motivo_bloqueio',
      CASE
        WHEN v_pagas > 0 THEN
          'Este contrato tem ' || v_pagas || ' cobrança(s) PAGA(S). ' ||
          'Excluir apagaria histórico financeiro recebido. Encerre em vez disso.'
        WHEN v_nfs > 0 THEN
          'Este contrato tem nota fiscal emitida. Não pode ser excluído. Encerre em vez disso.'
        WHEN v_receber_vivo > 0 THEN
          'Este contrato tem ' || v_receber_vivo || ' cobrança(s) viva(s) em Contas a Receber. ' ||
          'Excluir deixaria os títulos órfãos e o DRE mentiria. Encerre em vez disso.'
        ELSE NULL
      END
  );
END $$;

-- ── 3 · EXCLUIR — soft delete, revalidando a guarda no BACKEND (RD-30) ───────
CREATE OR REPLACE FUNCTION fn_contrato_excluir(p_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_acoes    jsonb;
  v_contrato record;
  v_hist     text;
  v_motivo   text;
BEGIN
  SELECT * INTO v_contrato FROM erp_contratos WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'contrato não encontrado');
  END IF;
  IF v_contrato.status = 'excluido' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'contrato já está excluído');
  END IF;

  v_acoes := fn_contrato_acoes_permitidas(p_id);
  -- 🔒 A GUARDA. Revalidada aqui — nunca confiar no frontend.
  IF NOT (v_acoes->>'pode_excluir')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'erro', v_acoes->>'motivo_bloqueio');
  END IF;

  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'motivo da exclusão é obrigatório');
  END IF;

  -- CEO: GRAVAR no motivo o histórico — daqui a 6 meses ninguém acha que nunca rodou.
  v_hist := format('[histórico: %s título(s) já gerado(s), total faturado R$ %s]',
    COALESCE(v_contrato.total_titulos_gerados, 0),
    to_char(COALESCE(v_contrato.total_faturado, 0), 'FM999999990.00'));
  v_motivo := btrim(p_motivo) || ' ' || v_hist;

  UPDATE erp_contratos
     SET status          = 'excluido',
         excluido_em     = now(),
         excluido_por    = auth.uid(),
         motivo_exclusao = v_motivo,
         updated_at      = now()
   WHERE id = p_id;

  INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, created_at)
  VALUES (p_id, v_contrato.company_id, 'excluido', v_motivo,
          jsonb_build_object('motivo', btrim(p_motivo), 'historico', v_hist, 'acoes', v_acoes),
          auth.uid(), now());

  RETURN jsonb_build_object('ok', true, 'mensagem', 'Contrato EXCLUÍDO.');
END $$;

-- ── 4 · ENCERRAR — para de faturar, MANTÉM toda a história ───────────────────
CREATE OR REPLACE FUNCTION fn_contrato_encerrar(p_id uuid, p_motivo text, p_data date DEFAULT current_date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_contrato record;
BEGIN
  SELECT * INTO v_contrato FROM erp_contratos WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'contrato não encontrado');
  END IF;
  IF v_contrato.status IN ('encerrado', 'excluido') THEN
    RETURN jsonb_build_object('ok', false, 'erro', format('contrato já está %s', v_contrato.status));
  END IF;
  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'motivo do encerramento é obrigatório');
  END IF;

  UPDATE erp_contratos
     SET status              = 'encerrado',
         data_encerramento   = p_data,
         motivo_encerramento = btrim(p_motivo),
         encerrado_por       = auth.uid(),
         updated_at          = now()
   WHERE id = p_id;

  INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, created_at)
  VALUES (p_id, v_contrato.company_id, 'encerrado', 'Motivo: ' || btrim(p_motivo),
          jsonb_build_object('motivo', btrim(p_motivo), 'data_encerramento', p_data),
          auth.uid(), now());

  -- O gerador filtra status='ativo' → encerrado NÃO gera mais cobrança (provado no aceite).
  RETURN jsonb_build_object('ok', true, 'mensagem', 'Contrato ENCERRADO. Não gera mais cobranças.');
END $$;

-- ── 5 · EDITAR — sempre permitido, SEMPRE audita (quem, de → para) ───────────
-- status de exclusão/encerramento NÃO passa por aqui (tem função própria com guarda).
CREATE OR REPLACE FUNCTION fn_contrato_editar(p_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_old   record;
  v_de    jsonb := '{}'::jsonb;
  v_para  jsonb := '{}'::jsonb;
  v_key   text;
  v_allow text[] := ARRAY['nome','descricao','escopo','valor_mensal','valor_atual',
    'dia_vencimento','cliente_id','cliente_nome','cliente_cnpj','cliente_email','tipo',
    'periodicidade','forma_pagamento','tipo_reajuste','reajuste_percentual','mes_reajuste',
    'data_fim','responsavel','observacoes','status'];
BEGIN
  SELECT * INTO v_old FROM erp_contratos WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'contrato não encontrado');
  END IF;

  -- status só pode ir p/ ativo/suspenso por aqui; excluir/encerrar têm função própria.
  IF p_patch ? 'status' AND (p_patch->>'status') NOT IN ('ativo','suspenso') THEN
    RETURN jsonb_build_object('ok', false,
      'erro', 'Para excluir/encerrar use a ação própria (com guarda fiscal).');
  END IF;

  -- diff de auditoria: só das chaves permitidas que mudaram
  FOREACH v_key IN ARRAY v_allow LOOP
    IF p_patch ? v_key AND (p_patch->>v_key) IS DISTINCT FROM (to_jsonb(v_old)->>v_key) THEN
      v_de   := v_de   || jsonb_build_object(v_key, to_jsonb(v_old)->v_key);
      v_para := v_para || jsonb_build_object(v_key, p_patch->v_key);
    END IF;
  END LOOP;

  IF v_para = '{}'::jsonb THEN
    RETURN jsonb_build_object('ok', true, 'mensagem', 'Nada a alterar.');
  END IF;

  UPDATE erp_contratos SET
    nome                = COALESCE(p_patch->>'nome', nome),
    descricao           = COALESCE(p_patch->>'descricao', descricao),
    escopo              = COALESCE(p_patch->>'escopo', escopo),
    valor_mensal        = COALESCE((p_patch->>'valor_mensal')::numeric, valor_mensal),
    valor_atual         = COALESCE((p_patch->>'valor_atual')::numeric, valor_atual),
    dia_vencimento      = COALESCE((p_patch->>'dia_vencimento')::int, dia_vencimento),
    cliente_id          = COALESCE((p_patch->>'cliente_id')::uuid, cliente_id),
    cliente_nome        = COALESCE(p_patch->>'cliente_nome', cliente_nome),
    cliente_cnpj        = COALESCE(p_patch->>'cliente_cnpj', cliente_cnpj),
    cliente_email       = COALESCE(p_patch->>'cliente_email', cliente_email),
    tipo                = COALESCE(p_patch->>'tipo', tipo),
    periodicidade       = COALESCE(p_patch->>'periodicidade', periodicidade),
    forma_pagamento     = COALESCE(p_patch->>'forma_pagamento', forma_pagamento),
    tipo_reajuste       = COALESCE(p_patch->>'tipo_reajuste', tipo_reajuste),
    reajuste_percentual = COALESCE((p_patch->>'reajuste_percentual')::numeric, reajuste_percentual),
    mes_reajuste        = COALESCE((p_patch->>'mes_reajuste')::int, mes_reajuste),
    data_fim            = COALESCE((p_patch->>'data_fim')::date, data_fim),
    responsavel         = COALESCE(p_patch->>'responsavel', responsavel),
    observacoes         = COALESCE(p_patch->>'observacoes', observacoes),
    status              = COALESCE(p_patch->>'status', status),
    updated_at          = now()
  WHERE id = p_id;

  INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, usuario_id, created_at)
  VALUES (p_id, v_old.company_id, 'alterado', 'Campos alterados: ' || (SELECT string_agg(k, ', ') FROM jsonb_object_keys(v_para) k),
          jsonb_build_object('de', v_de, 'para', v_para), auth.uid(), now());

  RETURN jsonb_build_object('ok', true, 'mensagem', 'Contrato ALTERADO.', 'campos', v_para);
END $$;

GRANT EXECUTE ON FUNCTION fn_contrato_acoes_permitidas(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fn_contrato_excluir(uuid, text)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fn_contrato_encerrar(uuid, text, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fn_contrato_editar(uuid, jsonb)     TO authenticated, service_role;

-- ── 6 · Gerador VERSIONADO + carimba contrato_id (decisão 2/4 do CEO) ────────
-- Reproduz fiel a função viva (antes só existia no banco) e adiciona contrato_id
-- na INSERT em erp_receber. Continua filtrando status='ativo' (whitelist).
CREATE OR REPLACE FUNCTION public.fn_contrato_gerar_receber(p_contrato_id uuid, p_mes_referencia date)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_contrato record;
  v_ref_externa text;
  v_data_vencimento date;
  v_descricao text;
  v_receber_id uuid;
  v_already_exists boolean;
BEGIN
  SELECT * INTO v_contrato FROM erp_contratos WHERE id = p_contrato_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'contrato nao encontrado');
  END IF;

  IF v_contrato.status != 'ativo' THEN
    RETURN jsonb_build_object('success', false,
      'error', format('contrato esta com status %s, nao pode gerar fatura', v_contrato.status));
  END IF;

  IF v_contrato.data_inicio > p_mes_referencia THEN
    RETURN jsonb_build_object('success', false, 'error', 'mes de referencia anterior ao inicio do contrato');
  END IF;

  IF v_contrato.data_fim IS NOT NULL AND v_contrato.data_fim < p_mes_referencia THEN
    RETURN jsonb_build_object('success', false, 'error', 'mes de referencia posterior ao fim do contrato');
  END IF;

  v_data_vencimento := date_trunc('month', p_mes_referencia)::date
    + (COALESCE(v_contrato.dia_vencimento, 10) - 1) * interval '1 day';

  v_ref_externa := format('contrato:%s:mes:%s', v_contrato.id, to_char(p_mes_referencia, 'YYYY-MM'));

  SELECT EXISTS(
    SELECT 1 FROM erp_receber
    WHERE ref_externa_sistema = 'contrato_recorrente' AND ref_externa_id = v_ref_externa
  ) INTO v_already_exists;

  IF v_already_exists THEN
    RETURN jsonb_build_object('success', false, 'error', 'fatura ja gerada para este mes',
      'ref_externa', v_ref_externa, 'idempotente', true);
  END IF;

  v_descricao := format('%s - Ref. %s', v_contrato.nome, to_char(p_mes_referencia, 'MM/YYYY'));

  INSERT INTO erp_receber (
    company_id, cliente_id, cliente_nome, descricao, categoria, valor,
    data_emissao, data_vencimento, status, forma_pagamento, centro_custo,
    linha_negocio, observacoes, recorrente, ref_externa_id, ref_externa_sistema,
    contrato_id   -- ← CARIMBO (decisão 2 do CEO): a guarda não depende mais de JSON
  ) VALUES (
    v_contrato.company_id, v_contrato.cliente_id, v_contrato.cliente_nome, v_descricao,
    'Receita Recorrente', COALESCE(v_contrato.valor_atual, v_contrato.valor_mensal),
    p_mes_referencia, v_data_vencimento, 'aberto', v_contrato.forma_pagamento, NULL,
    v_contrato.tipo, format('Gerado automaticamente do contrato %s em %s', v_contrato.numero, now()::date),
    true, v_ref_externa, 'contrato_recorrente',
    v_contrato.id
  )
  RETURNING id INTO v_receber_id;

  UPDATE erp_contratos
  SET ultimo_titulo_gerado_em = CURRENT_DATE,
      total_titulos_gerados = COALESCE(total_titulos_gerados, 0) + 1,
      total_faturado = COALESCE(total_faturado, 0) + COALESCE(valor_atual, valor_mensal),
      updated_at = now()
  WHERE id = p_contrato_id;

  INSERT INTO erp_contratos_eventos (contrato_id, company_id, evento, detalhe, metadata, created_at)
  VALUES (
    p_contrato_id, v_contrato.company_id, 'fatura_gerada',
    format('Fatura gerada para %s no valor de R$ %s',
      to_char(p_mes_referencia, 'MM/YYYY'),
      to_char(COALESCE(v_contrato.valor_atual, v_contrato.valor_mensal), 'FM999999990.00')),
    jsonb_build_object('receber_id', v_receber_id, 'ref_externa', v_ref_externa,
      'data_vencimento', v_data_vencimento, 'valor', COALESCE(v_contrato.valor_atual, v_contrato.valor_mensal)),
    now()
  );

  RETURN jsonb_build_object('success', true, 'receber_id', v_receber_id, 'ref_externa', v_ref_externa,
    'valor', COALESCE(v_contrato.valor_atual, v_contrato.valor_mensal), 'data_vencimento', v_data_vencimento);
END;
$function$;

GRANT EXECUTE ON FUNCTION fn_contrato_gerar_receber(uuid, date) TO authenticated, service_role;
