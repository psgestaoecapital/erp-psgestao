-- ============================================================
-- Faturamento #18 v2 · ETAPA 3 — passo 3b (backend): efetivar SÓ quando a NFS-e AUTORIZAR
-- ============================================================
-- SPEC docs/SPEC_faturamento_etapa3_previsto_efetivacao.md. Depende do passo 3 (fn_faturar_efetivar, no ar).
-- Decisão do CEO (timing "a"): a efetivação (previsto→aberto) acontece SÓ quando a nota fica 'autorizada'.
--   'processando' NÃO é nota; 'rejeitada' NÃO efetiva e não deixa resíduo (a parcela segue 'previsto' e a
--   pessoa corrige e reemite). Se cada rejeição efetivasse, seriam N estornos (a devolução do KGF rejeitou 6x).
-- Três exigências do CEO, atendidas aqui:
--   #1 rejeitada/processando → NÃO efetiva, parcela intacta em 'previsto';
--   #3 autorizada mas efetivação FALHA → NUNCA em silêncio: grava efetivacao_status='falha' + o erro.
--      (a #2 — a tela dizer o estado — é o passo 3b-frontend.)
-- Atômico: fn_faturar_efetivar roda dentro de um subblock com EXCEPTION; se falhar, o subtransaction é
-- desfeito (parcela continua 'previsto') e só o carimbo de 'falha' persiste. Idempotente (efetivar 2x = no-op).

ALTER TABLE public.erp_nfse_emitidas ADD COLUMN IF NOT EXISTS parcela_ids uuid[];        -- parcelas que ESTA nota efetiva (medição)
ALTER TABLE public.erp_nfse_emitidas ADD COLUMN IF NOT EXISTS efetivacao_status text;    -- NULL=n/a | pendente | ok | falha | nao_aplicavel
ALTER TABLE public.erp_nfse_emitidas ADD COLUMN IF NOT EXISTS efetivacao_erro text;

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='erp_nfse_emitidas_efetivacao_status_chk') THEN
    ALTER TABLE public.erp_nfse_emitidas ADD CONSTRAINT erp_nfse_emitidas_efetivacao_status_chk
      CHECK (efetivacao_status IS NULL OR efetivacao_status IN ('pendente','ok','falha','nao_aplicavel'));
  END IF;
END $chk$;

COMMENT ON COLUMN public.erp_nfse_emitidas.parcela_ids IS
  'ETAPA3: parcelas (erp_pedidos_parcelas.id) que esta nota efetiva quando autorizar. NULL em nota avulsa/legado.';
COMMENT ON COLUMN public.erp_nfse_emitidas.efetivacao_status IS
  'ETAPA3: NULL/nao_aplicavel = nota não-medição; pendente = aguardando autorizar; ok = parcelas efetivadas; falha = autorizou mas efetivação falhou (ver efetivacao_erro) — estado a resolver, NUNCA silencioso.';

-- Efetiva as parcelas da nota SÓ se ela estiver 'autorizada'. Idempotente, atômico, registra falha.
CREATE OR REPLACE FUNCTION public.fn_nfse_efetivar_se_autorizada(p_nfse_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_n record; v_res jsonb;
BEGIN
  SELECT id, company_id, pedido_id, parcela_ids, valor_servicos, numero, status, data_emissao, efetivacao_status
    INTO v_n FROM public.erp_nfse_emitidas WHERE id = p_nfse_id;
  IF v_n IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nfse nao encontrada'); END IF;

  -- idempotente: já efetivada, não repete
  IF v_n.efetivacao_status = 'ok' THEN RETURN jsonb_build_object('ok', true, 'ja_efetivada', true); END IF;

  -- #1: só autorizada efetiva. 'processando'/'rejeitada'/'cancelada' → não toca nada (parcela segue previsto)
  IF v_n.status IS DISTINCT FROM 'autorizada' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'nota_nao_autorizada', 'status', v_n.status);
  END IF;

  -- nota sem vínculo de medição (avulsa/legado) → nada a efetivar
  IF v_n.pedido_id IS NULL OR v_n.parcela_ids IS NULL OR array_length(v_n.parcela_ids,1) IS NULL THEN
    UPDATE public.erp_nfse_emitidas SET efetivacao_status='nao_aplicavel', atualizado_em=now() WHERE id=p_nfse_id;
    RETURN jsonb_build_object('ok', true, 'nao_aplicavel', true);
  END IF;

  BEGIN
    v_res := public.fn_faturar_efetivar(v_n.pedido_id, v_n.parcela_ids, v_n.valor_servicos, v_n.numero,
                                        p_nfse_id, COALESCE(v_n.data_emissao::date, CURRENT_DATE), NULL);
    UPDATE public.erp_nfse_emitidas SET efetivacao_status='ok', efetivacao_erro=NULL, atualizado_em=now() WHERE id=p_nfse_id;
    RETURN jsonb_build_object('ok', true, 'efetivacao', v_res);
  EXCEPTION WHEN others THEN
    -- #3: autorizou e a efetivação falhou → o subblock reverte as parcelas (seguem 'previsto') e gravamos
    -- a FALHA visível. Nota existe, financeiro não: pior estado — nunca em silêncio.
    UPDATE public.erp_nfse_emitidas SET efetivacao_status='falha', efetivacao_erro=left(SQLERRM,2000), atualizado_em=now() WHERE id=p_nfse_id;
    RETURN jsonb_build_object('ok', false, 'erro', SQLERRM, 'estado', 'AUTORIZADA_SEM_FINANCEIRO');
  END;
END $fn$;

GRANT EXECUTE ON FUNCTION public.fn_nfse_efetivar_se_autorizada(uuid) TO authenticated, service_role;
