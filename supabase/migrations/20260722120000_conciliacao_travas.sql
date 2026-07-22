-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- CONCILIAÇÃO · TRAVAS (guards) — só prevenção; NÃO corrige dados existentes (limpeza vem com GO + backup).
-- Diagnóstico: (A) extrato importado 2×+ (arquivo_hash existe mas sem trava); (B) trigger de baixa acumulava
-- valor_pago com "+=" (dobrou a Toy Tintas p/ 5003,32) e estorno condicional deixava órfão; (C) título idêntico
-- duplicado; (D) match manual ambíguo sem confirmação.
-- Force explícito (confirmação do usuário) via GUC de sessão: SET LOCAL app.forcar_<x> = '1'.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- ── (A) EXTRATO DUPLICADO ──────────────────────────────────────────────────────────────────
-- Nota: já existe UNIQUE (company_id, arquivo_hash) WHERE arquivo_hash IS NOT NULL (uq_lote_arquivo_hash) —
-- o arquivo idêntico já é barrado no banco. O FURO real (Tryo: 8 lotes/mesmo período) é hash nulo/diferente com
-- período sobreposto. Trava: hash-dup = bloqueio DURO + mensagem amigável (byte-idêntico não é forçável);
-- período sobreposto = bloqueio FORÇÁVEL (SET LOCAL app.forcar_lote_dup='1').
CREATE OR REPLACE FUNCTION public.fn_conciliacao_lote_antidup()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_quando text;
BEGIN
  IF NEW.arquivo_hash IS NOT NULL AND btrim(NEW.arquivo_hash) <> '' THEN
    SELECT to_char(min(created_at),'DD/MM/YYYY') INTO v_quando
      FROM public.conciliacao_lote
     WHERE company_id = NEW.company_id AND arquivo_hash = NEW.arquivo_hash AND id <> NEW.id;
    IF v_quando IS NOT NULL THEN
      RAISE EXCEPTION 'Este extrato (arquivo idêntico) já foi importado nesta empresa em %.', v_quando USING ERRCODE = '23505';
    END IF;
  END IF;

  IF current_setting('app.forcar_lote_dup', true) IS DISTINCT FROM '1'
     AND NEW.periodo_inicio IS NOT NULL AND NEW.periodo_fim IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.conciliacao_lote l
       WHERE l.company_id = NEW.company_id
         AND l.conta_bancaria_id IS NOT DISTINCT FROM NEW.conta_bancaria_id
         AND l.periodo_inicio IS NOT NULL AND l.periodo_fim IS NOT NULL
         AND l.periodo_inicio <= NEW.periodo_fim AND l.periodo_fim >= NEW.periodo_inicio
         AND l.id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'Já existe extrato importado com período sobreposto nesta conta. Confirme para importar mesmo assim.'
        USING ERRCODE = '23505', HINT = 'Para forçar: SET LOCAL app.forcar_lote_dup = ''1''.';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_conciliacao_lote_antidup ON public.conciliacao_lote;
CREATE TRIGGER trg_conciliacao_lote_antidup BEFORE INSERT ON public.conciliacao_lote
  FOR EACH ROW EXECUTE FUNCTION public.fn_conciliacao_lote_antidup();

-- ── (B) BAIXA IDEMPOTENTE ──────────────────────────────────────────────────────────────────
-- valor_pago = SOMA dos movimentos conciliados que apontam pro título (nunca "+="). Estorno incondicional
-- (ao desvincular, a soma cai sozinha). Guard: bloqueia soma > valor quando há 2+ movimentos (over-conciliação;
-- permite excesso de 1 movimento só, p/ juros/multa de pagamento único).
CREATE OR REPLACE FUNCTION public.fn_recompute_baixa_titulo(p_tabela text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_valor numeric; v_venc date; v_soma numeric; v_n int; v_dt date; v_status text;
BEGIN
  IF p_id IS NULL OR p_tabela NOT IN ('erp_receber','erp_pagar') THEN RETURN; END IF;

  SELECT COALESCE(SUM(valor),0), count(*), max(data_transacao)
    INTO v_soma, v_n, v_dt
    FROM public.conciliacao_movimento
   WHERE lancamento_tabela = p_tabela AND lancamento_id = p_id AND status = 'conciliado';

  IF p_tabela = 'erp_receber' THEN
    SELECT valor, data_vencimento INTO v_valor, v_venc FROM public.erp_receber WHERE id = p_id;
  ELSE
    SELECT valor, data_vencimento INTO v_valor, v_venc FROM public.erp_pagar WHERE id = p_id;
  END IF;
  IF v_valor IS NULL THEN RETURN; END IF;

  -- Guard: over-conciliação (soma acima do valor com 2+ movimentos) — impede dobra como a da Toy Tintas.
  IF v_n >= 2 AND v_soma > v_valor + 0.01 THEN
    RAISE EXCEPTION 'Conciliação excede o valor do título: % movimentos somam % para um título de %. Desvincule um antes.',
      v_n, to_char(v_soma,'FM999999990.00'), to_char(v_valor,'FM999999990.00') USING ERRCODE = '23514';
  END IF;

  v_status := CASE
    WHEN v_soma <= 0 THEN (CASE WHEN v_venc < CURRENT_DATE THEN 'vencido' ELSE 'aberto' END)
    WHEN v_soma + 0.01 >= v_valor THEN 'pago'
    ELSE 'parcial' END;

  IF p_tabela = 'erp_receber' THEN
    UPDATE public.erp_receber
       SET valor_pago = v_soma,
           status = v_status,
           data_pagamento = CASE WHEN v_soma > 0 THEN v_dt ELSE NULL END,
           forma_pagamento = CASE WHEN v_soma > 0 THEN COALESCE(NULLIF(forma_pagamento,''),'conciliacao_bancaria') ELSE NULL END,
           updated_at = now()
     WHERE id = p_id;
  ELSE
    UPDATE public.erp_pagar
       SET valor_pago = v_soma,
           status = v_status,
           data_pagamento = CASE WHEN v_soma > 0 THEN v_dt ELSE NULL END,
           forma_pagamento = CASE WHEN v_soma > 0 THEN COALESCE(NULLIF(forma_pagamento,''),'conciliacao_bancaria') ELSE NULL END,
           updated_at = now()
     WHERE id = p_id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_baixa_por_conciliacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  -- Multi-tenant guard (vincular): título tem que ser da mesma empresa do movimento.
  IF TG_OP <> 'DELETE' AND NEW.lancamento_id IS NOT NULL AND NEW.lancamento_tabela IN ('erp_receber','erp_pagar') THEN
    DECLARE v_comp uuid; BEGIN
      IF NEW.lancamento_tabela = 'erp_receber' THEN SELECT company_id INTO v_comp FROM erp_receber WHERE id = NEW.lancamento_id;
      ELSE SELECT company_id INTO v_comp FROM erp_pagar WHERE id = NEW.lancamento_id; END IF;
      IF v_comp IS NOT NULL AND v_comp <> NEW.company_id THEN
        RAISE EXCEPTION 'Conciliação multi-tenant bloqueada: título %/empresa %, movimento %/empresa %',
          NEW.lancamento_id, v_comp, NEW.id, NEW.company_id;
      END IF;
    END;
  END IF;

  -- Recompute idempotente do(s) título(s) afetado(s): o antigo (estorno) e o novo (vínculo).
  IF TG_OP IN ('UPDATE','DELETE') THEN
    PERFORM public.fn_recompute_baixa_titulo(OLD.lancamento_tabela, OLD.lancamento_id);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    IF TG_OP = 'INSERT' OR OLD.lancamento_id IS DISTINCT FROM NEW.lancamento_id OR OLD.lancamento_tabela IS DISTINCT FROM NEW.lancamento_tabela OR OLD.status IS DISTINCT FROM NEW.status THEN
      PERFORM public.fn_recompute_baixa_titulo(NEW.lancamento_tabela, NEW.lancamento_id);
    END IF;
  END IF;
  RETURN NULL;
END $$;
-- passa a rodar também no DELETE (estorno ao arquivar/excluir movimento)
DROP TRIGGER IF EXISTS trg_baixa_por_conciliacao ON public.conciliacao_movimento;
CREATE TRIGGER trg_baixa_por_conciliacao AFTER INSERT OR UPDATE OR DELETE ON public.conciliacao_movimento
  FOR EACH ROW EXECUTE FUNCTION public.fn_baixa_por_conciliacao();

-- ── (C) TÍTULO DUPLICADO ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_titulo_antidup()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_existe boolean;
BEGIN
  IF current_setting('app.forcar_titulo_dup', true) = '1' THEN RETURN NEW; END IF;
  IF NEW.company_id IS NULL OR COALESCE(btrim(NEW.descricao),'')='' OR NEW.valor IS NULL OR NEW.data_vencimento IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format(
    'SELECT EXISTS(SELECT 1 FROM public.%I WHERE company_id=$1 AND descricao=$2 AND valor=$3 AND data_vencimento=$4 AND id <> $5)',
    TG_TABLE_NAME)
    INTO v_existe USING NEW.company_id, NEW.descricao, NEW.valor, NEW.data_vencimento, NEW.id;
  IF v_existe THEN
    RAISE EXCEPTION 'Já existe um título idêntico (mesma descrição, valor e vencimento) nesta empresa. Confirme para duplicar.'
      USING ERRCODE = '23505', HINT = 'Para forçar: SET LOCAL app.forcar_titulo_dup = ''1''.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_receber_antidup ON public.erp_receber;
CREATE TRIGGER trg_receber_antidup BEFORE INSERT ON public.erp_receber
  FOR EACH ROW EXECUTE FUNCTION public.fn_titulo_antidup();
DROP TRIGGER IF EXISTS trg_pagar_antidup ON public.erp_pagar;
CREATE TRIGGER trg_pagar_antidup BEFORE INSERT ON public.erp_pagar
  FOR EACH ROW EXECUTE FUNCTION public.fn_titulo_antidup();

-- ── (D) MATCH MANUAL: motivo obrigatório p/ score baixo ────────────────────────────────────
-- Semáforo de score (>=90 verde · 70-89 amarelo · <70 vermelho). <70 exige motivo. (Painel lado-a-lado é frontend.)
CREATE OR REPLACE FUNCTION public.fn_conciliacao_aplicar_match(
  p_movimento_id uuid, p_lancamento_tabela text, p_lancamento_id uuid, p_operador_id uuid,
  p_origem text DEFAULT 'manual', p_motivo text DEFAULT NULL)
RETURNS TABLE(movimento_id uuid, status_resultado text, mensagem text)
LANGUAGE plpgsql AS $function$
DECLARE v_mov RECORD; v_score numeric;
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN RETURN QUERY SELECT p_movimento_id, 'erro', 'Movimento não encontrado'; RETURN; END IF;
  IF v_mov.status NOT IN ('pendente','divergente') THEN
    RETURN QUERY SELECT p_movimento_id, 'erro', 'Movimento já processado: ' || v_mov.status; RETURN;
  END IF;

  IF p_lancamento_tabela = 'erp_pagar' THEN
    SELECT CASE WHEN abs(p.valor - v_mov.valor) < 0.01 THEN 50 ELSE 25 END
         + CASE WHEN abs(EXTRACT(DAY FROM (p.data_vencimento::timestamp - v_mov.data_transacao::timestamp))) <= 1 THEN 30 ELSE 10 END + 20
      INTO v_score FROM erp_pagar p WHERE p.id = p_lancamento_id;
  ELSE
    SELECT CASE WHEN abs(r.valor - v_mov.valor) < 0.01 THEN 50 ELSE 25 END
         + CASE WHEN abs(EXTRACT(DAY FROM (r.data_vencimento::timestamp - v_mov.data_transacao::timestamp))) <= 1 THEN 30 ELSE 10 END + 20
      INTO v_score FROM erp_receber r WHERE r.id = p_lancamento_id;
  END IF;

  -- Trava D: score baixo (<70) exige motivo explícito do operador.
  IF COALESCE(v_score,0) < 70 AND COALESCE(btrim(p_motivo),'') = '' THEN
    RETURN QUERY SELECT p_movimento_id, 'erro',
      'Match de baixa confiança (score '||COALESCE(v_score,0)::text||'). Informe o motivo para confirmar.';
    RETURN;
  END IF;

  UPDATE conciliacao_movimento
     SET lancamento_tabela = p_lancamento_tabela, lancamento_id = p_lancamento_id,
         match_score = v_score, match_origem = p_origem, match_aplicado_em = now(),
         match_aplicado_por = p_operador_id, status = 'conciliado',
         obs = CASE WHEN COALESCE(btrim(p_motivo),'')<>'' THEN left('[match '||COALESCE(v_score,0)::text||'] '||p_motivo, 500) ELSE obs END,
         updated_at = now()
   WHERE id = p_movimento_id;

  IF length(v_mov.descricao_normalizada) >= 5 THEN
    INSERT INTO conciliacao_regra (company_id, tipo_lote, padrao_descricao, padrao_tipo, sugestao_psgc, origem, hits_total, hits_aceitos, ultima_aplicacao)
    SELECT v_mov.company_id, cl.tipo, substring(v_mov.descricao_normalizada FROM 1 FOR LEAST(30, length(v_mov.descricao_normalizada))),
           'substring', v_mov.psgc_sugestao, 'aprendido', 1, 1, now()
    FROM conciliacao_lote cl WHERE cl.id = v_mov.lote_id
    ON CONFLICT (company_id, tipo_lote, padrao_descricao) DO UPDATE
      SET hits_total = conciliacao_regra.hits_total + 1, hits_aceitos = conciliacao_regra.hits_aceitos + 1,
          ultima_aplicacao = now(), updated_at = now();
  END IF;

  RETURN QUERY SELECT p_movimento_id, 'conciliado', 'Match aplicado com score ' || v_score::text;
END;
$function$;
