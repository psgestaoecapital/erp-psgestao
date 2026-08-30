-- BUG CRÍTICO (catch-up OMIE Tryo): fn_titulo_antidup (BEFORE INSERT em
-- erp_pagar/erp_receber) abortava a RE-IMPORTAÇÃO do ETL. O promote faz upsert por
-- ref_externa_id (código OMIE codigo_lancamento), mas o BEFORE INSERT dispara ANTES
-- do ON CONFLICT → re-puxar um título já importado batia na trava "Já existe um
-- título idêntico (mesma descrição, valor e vencimento)" e o lote não entrava.
--
-- A trava existe pra pegar DIGITAÇÃO MANUAL duplicada — NÃO re-import de API, que já
-- deduplica pelo índice único (company_id, ref_externa_sistema, ref_externa_id).
-- FIX (mesmo princípio da trava de extrato, que isenta origem 'api%'): isentar
-- títulos que carregam ref_externa_sistema (import de sistema externo: OMIE, etc.).
-- Mantém a proteção intacta para lançamentos manuais (ref_externa_sistema NULL).
--
-- O ETL abortando NÃO criou duplicata (dado intacto): re-importar o mesmo OMIE
-- codigo_lancamento agora ATUALIZA via upsert; título novo INSERE.

CREATE OR REPLACE FUNCTION public.fn_titulo_antidup()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_existe boolean;
BEGIN
  IF current_setting('app.forcar_titulo_dup', true) = '1' THEN RETURN NEW; END IF;
  -- Import de sistema externo (OMIE, …) deduplica por ref_externa_id → isento da
  -- trava lógica (senão o upsert de re-importação aborta no BEFORE INSERT).
  IF NEW.ref_externa_sistema IS NOT NULL AND btrim(NEW.ref_externa_sistema) <> '' THEN
    RETURN NEW;
  END IF;
  IF NEW.company_id IS NULL OR COALESCE(btrim(NEW.descricao),'')='' OR NEW.valor IS NULL OR NEW.data_vencimento IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE company_id=$1 AND descricao=$2 AND valor=$3 AND data_vencimento=$4 AND id <> $5)', TG_TABLE_NAME)
    INTO v_existe USING NEW.company_id, NEW.descricao, NEW.valor, NEW.data_vencimento, NEW.id;
  IF v_existe THEN
    RAISE EXCEPTION 'Já existe um título idêntico (mesma descrição, valor e vencimento) nesta empresa. Confirme para duplicar.'
      USING ERRCODE = '23505', HINT = 'Para forçar: SET LOCAL app.forcar_titulo_dup = ''1''.';
  END IF;
  RETURN NEW;
END $function$;
