-- HOTFIX (regressão): a trava de PERÍODO SOBREPOSTO em fn_conciliacao_lote_antidup
-- (bloco 2, introduzida em 20260722120000) barrava a sincronização por API (Sicoob),
-- que SEMPRE sobrepõe período por natureza (janela "últimos N dias"). Sintoma: sync do
-- André falhava com "falha ao gravar movimentos".
--
-- A duplicação real que motivou a trava era origem='upload_pdf' (MANUAL, Tryo 8x) — não API.
-- FIX: isentar origens 'api%' do bloco (2). Mantém a trava para upload_pdf / ofx / manual.
-- O bloco (1) hash NÃO muda (API não envia arquivo_hash).
--
-- Proteção equivalente para API já existe: fn_extrato_importar_sistema deduplica por
-- (company_id, id_externo) — pré-check + unique_violation, com índice único
-- uniq_conciliacao_movimento_company_idexterno. Re-puxar a mesma janela ignora movimentos
-- já importados (id_externo = id da transação no banco).
CREATE OR REPLACE FUNCTION public.fn_conciliacao_lote_antidup()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_quando text;
BEGIN
  -- 1) arquivo idêntico (hash) — bloqueio duro, mensagem amigável.
  IF NEW.arquivo_hash IS NOT NULL AND btrim(NEW.arquivo_hash) <> '' THEN
    SELECT to_char(min(created_at),'DD/MM/YYYY') INTO v_quando
      FROM public.conciliacao_lote
     WHERE company_id = NEW.company_id AND arquivo_hash = NEW.arquivo_hash AND id <> NEW.id;
    IF v_quando IS NOT NULL THEN
      RAISE EXCEPTION 'Este extrato (arquivo idêntico) já foi importado nesta empresa em %.', v_quando USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 2) período sobreposto na mesma conta (arquivo diferente / sem hash) — forçável com confirmação.
  --    Origens de API (api_sicoob, api_sicredi, api_pluggy, ...) SEMPRE sobrepõem período por
  --    natureza (janela "últimos N dias") e são isentas aqui — a dedup delas é por identificador
  --    do movimento no próprio sync (id_externo), não por lote.
  IF current_setting('app.forcar_lote_dup', true) IS DISTINCT FROM '1'
     AND NEW.origem NOT LIKE 'api%'
     AND NEW.periodo_inicio IS NOT NULL AND NEW.periodo_fim IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.conciliacao_lote l
       WHERE l.company_id = NEW.company_id AND l.conta_bancaria_id IS NOT DISTINCT FROM NEW.conta_bancaria_id
         AND l.periodo_inicio IS NOT NULL AND l.periodo_fim IS NOT NULL
         AND l.periodo_inicio <= NEW.periodo_fim AND l.periodo_fim >= NEW.periodo_inicio AND l.id <> NEW.id) THEN
      RAISE EXCEPTION 'Já existe extrato importado com período sobreposto nesta conta. Confirme para importar mesmo assim.'
        USING ERRCODE = '23505', HINT = 'Para forçar: SET LOCAL app.forcar_lote_dup = ''1''.';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
