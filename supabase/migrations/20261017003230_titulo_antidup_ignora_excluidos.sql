-- Antiduplicidade (CEO 14/10) — a trava bloqueava RELANÇAR um título que o cliente EXCLUIU.
-- Prova (Umuarama, 14/10 14:36–14:40): fn_pagar_criar_com_parcelas devolveu 409 dezenas de vezes porque o trigger
-- trg_pagar_antidup → fn_titulo_antidup comparava descricao+valor+data_vencimento com TODAS as linhas da tabela,
-- INCLUSIVE as com deleted_at preenchido (e canceladas). "Retirada de Lucros - Rosana R$ 300.000 venc. 17/07" foi
-- excluída e não deixava relançar.
--
-- Correção: a verificação passa a ignorar linhas EXCLUÍDAS (deleted_at IS NULL) e CANCELADAS. A função é genérica
-- (TG_TABLE_NAME) e já serve erp_pagar e erp_receber — as duas têm deleted_at e status. Flag de forçar
-- (app.forcar_titulo_dup='1') e bypass de ref_externa_sistema permanecem inalterados.
--
-- CREATE OR REPLACE de função de guarda do financeiro → via revisada.

CREATE OR REPLACE FUNCTION public.fn_titulo_antidup()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_existe boolean;
BEGIN
  IF current_setting('app.forcar_titulo_dup', true) = '1' THEN RETURN NEW; END IF;
  IF NEW.ref_externa_sistema IS NOT NULL AND btrim(NEW.ref_externa_sistema) <> '' THEN
    RETURN NEW;
  END IF;
  IF NEW.company_id IS NULL OR COALESCE(btrim(NEW.descricao),'')='' OR NEW.valor IS NULL OR NEW.data_vencimento IS NULL THEN RETURN NEW; END IF;
  -- Só compara com títulos VIVOS: ignora excluídos (deleted_at) e cancelados — um título excluído não pode travar o relançamento.
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE company_id=$1 AND descricao=$2 AND valor=$3 AND data_vencimento=$4 AND id <> $5 AND deleted_at IS NULL AND lower(COALESCE(status,'''')) NOT IN (''cancelado''))', TG_TABLE_NAME)
    INTO v_existe USING NEW.company_id, NEW.descricao, NEW.valor, NEW.data_vencimento, NEW.id;
  IF v_existe THEN
    RAISE EXCEPTION 'Já existe um título idêntico (mesma descrição, valor e vencimento) nesta empresa. Confirme para duplicar.'
      USING ERRCODE = '23505', HINT = 'Para forçar: SET LOCAL app.forcar_titulo_dup = ''1''.';
  END IF;
  RETURN NEW;
END $function$;
