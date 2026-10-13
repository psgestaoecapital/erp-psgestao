-- RD-41 · Conciliação — ignorar ruído de extrato (Saldo Anterior / futuros) + conserto do Arquivar.
-- Achado da Jordana: OFX Cresol traz "Saldo Anterior" e lançamentos futuros → viram
-- pendência fantasma. E o botão Arquivar quebrava (apontava pra tabela inexistente
-- erp_conciliacao_movimentos; a real é conciliacao_movimento).
--
-- P1: nada é apagado — 'ignorado' é soft, reversível, com trilha (motivo_status + obs).
-- P2: RPCs checam get_user_company_ids(). Sem check em status → 'ignorado' é livre.
-- Os contadores do lote (v_conciliacao_saude) já caem sozinhos: fn_conciliacao_lote_recalc
-- conta total_pendentes = count(status='pendente'); o AFTER trigger recalcula por linha.

-- ── 1a) ARQUIVAR/IGNORAR na tabela REAL ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_conciliacao_arquivar_movimento(
  p_movimento_id uuid, p_motivo text DEFAULT 'manual')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_status text;
BEGIN
  SELECT company_id, status INTO v_company, v_status
    FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso',false,'erro','sem_acesso'); END IF;
  IF v_status = 'conciliado' THEN
    RETURN jsonb_build_object('sucesso',false,'erro','ja_conciliado',
      'orientacao','Desvincule antes de ignorar.'); END IF;

  UPDATE conciliacao_movimento
     SET status = 'ignorado',
         motivo_status = COALESCE(NULLIF(p_motivo,''),'manual'),
         match_aplicado_por = auth.uid(), match_aplicado_em = now(), updated_at = now(),
         obs = COALESCE(obs,'') || ' [IGNORADO: ' || COALESCE(p_motivo,'manual') || ']'
   WHERE id = p_movimento_id;

  RETURN jsonb_build_object('sucesso',true,'movimento_id',p_movimento_id,
    'status','ignorado','motivo',p_motivo);
END; $function$;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_arquivar_movimento(uuid,text) TO authenticated;

-- ── 1b) REINCLUIR (desfaz — reversibilidade Pilar 1) ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_conciliacao_reincluir_movimento(p_movimento_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_status text;
BEGIN
  SELECT company_id, status INTO v_company, v_status
    FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF v_company IS NULL THEN RETURN jsonb_build_object('sucesso',false,'erro','nao_encontrado'); END IF;
  IF NOT (v_company IN (SELECT public.get_user_company_ids())) THEN
    RETURN jsonb_build_object('sucesso',false,'erro','sem_acesso'); END IF;
  IF v_status <> 'ignorado' THEN
    RETURN jsonb_build_object('sucesso',false,'erro','nao_ignorado'); END IF;

  UPDATE conciliacao_movimento
     SET status='pendente', motivo_status=NULL, updated_at=now(),
         obs = COALESCE(obs,'') || ' [REINCLUIDO]'
   WHERE id = p_movimento_id;

  RETURN jsonb_build_object('sucesso',true,'movimento_id',p_movimento_id,'status','pendente');
END; $function$;
GRANT EXECUTE ON FUNCTION public.fn_conciliacao_reincluir_movimento(uuid) TO authenticated;

-- ── 2) Auto-ignore genérico no trigger (todo banco, todo caminho) ────────────
-- Preserva o comportamento atual (trim + normalização + natureza por texto quando
-- NULL) e ADICIONA a classificação de ruído. Só em INSERT e só se ainda 'pendente'.
CREATE OR REPLACE FUNCTION public.fn_conciliacao_movimento_before()
RETURNS trigger LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.descricao := trim(NEW.descricao);
  NEW.descricao_normalizada := fn_normalizar_texto_alerta(NEW.descricao);
  NEW.updated_at := now();

  IF TG_OP = 'INSERT' AND NEW.natureza IS NULL THEN
    NEW.natureza := fn_normalizar_natureza_ofx(NEW.descricao);
  END IF;

  -- AUTO-IGNORAR ruído de extrato. Genérico (não é Cresol-específico). Padrões de
  -- saldo específicos (não '%saldo%' puro) pra não suprimir transação legítima.
  IF TG_OP = 'INSERT' AND COALESCE(NEW.status,'pendente') = 'pendente' THEN
    IF lower(NEW.descricao) LIKE ANY (ARRAY[
         '%saldo anterior%','%saldo do dia%','%saldo em conta%','%saldo bloqueado%',
         '%saldo disponivel%','%saldo disponível%','%saldo inicial%','%saldo final%',
         '%saldo da conta%'])
    THEN
      NEW.status := 'ignorado';
      NEW.motivo_status := 'saldo_informativo';
    ELSIF NEW.data_transacao > CURRENT_DATE THEN
      NEW.status := 'ignorado';
      NEW.motivo_status := 'lancamento_futuro';
    END IF;
  END IF;

  RETURN NEW;
END; $function$;
