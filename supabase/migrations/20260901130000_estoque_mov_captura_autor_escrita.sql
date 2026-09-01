-- §6 · §2.3 — captura do AUTOR na ESCRITA daqui pra frente (forward-hygiene).
-- Auditoria (RD-38): das 7 funções que inserem em erp_estoque_movimentacoes, só duas NÃO
-- gravam o autor — fn_compra_receber (a 1 movimentação de compra) e fn_faturar (as 7 de
-- faturamento). Batem exatamente com as 8 sem usuario_id. A canônica fn_movimentar_estoque
-- já grava usuario_id = auth.uid(); estas duas passam a fazer o mesmo.
--
-- NADA de UPDATE histórico: só corrige a escrita futura. As 702 linhas ficam intactas
-- (aceite: contagem de movimentações sem autor CONTINUA em 8 depois desta migration).
-- usuario_nome NÃO é escrita por ninguém — segue órfã (RD-30/RD-52), não a preenchemos.
--
-- Patch CIRÚRGICO sobre a definição viva (pg_get_functiondef), com guarda de ocorrência:
-- se o número de âncoras não bater exatamente, a migration ABORTA e a função financeira fica
-- intocada — falha barulhenta, nunca desalinhamento silencioso de coluna/valor no faturamento.
-- usuario_id entra imediatamente ANTES de data_movimento (coluna) e auth.uid() imediatamente
-- ANTES de now() (valor): ambos são o último par coluna/valor do INSERT, então o alinhamento
-- posicional usuario_id↔auth.uid() e data_movimento↔now() é garantido.
-- auth.uid() NULL em contexto automatizado (sem JWT) → usuario_id NULL → a tela mostra "—".

-- 1) fn_compra_receber — 1 INSERT de movimentação (ref_tipo 'compra')
DO $$
DECLARE v_def text; v_new text; v_oc int;
        a_col text := 'ref_numero, data_movimento';
        a_val text := 'v_compra.numero, now()';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE proname='fn_compra_receber' AND pronamespace='public'::regnamespace;
  IF v_def IS NULL THEN RAISE EXCEPTION 'fn_compra_receber nao encontrada'; END IF;
  IF position('usuario_id' IN v_def) > 0 THEN RETURN; END IF;   -- idempotente: ja captura autor

  v_oc := (length(v_def) - length(replace(v_def, a_col, ''))) / length(a_col);
  IF v_oc <> 1 THEN RAISE EXCEPTION 'fn_compra_receber: ancora coluna esperava 1, achei %', v_oc; END IF;
  v_oc := (length(v_def) - length(replace(v_def, a_val, ''))) / length(a_val);
  IF v_oc <> 1 THEN RAISE EXCEPTION 'fn_compra_receber: ancora valor esperava 1, achei %', v_oc; END IF;

  v_new := replace(v_def, a_col, 'ref_numero, usuario_id, data_movimento');
  v_new := replace(v_new, a_val, 'v_compra.numero, auth.uid(), now()');
  EXECUTE v_new;
END $$;

-- 2) fn_faturar — 2 INSERTs de movimentação (produto direto + BOM de serviço); ambos capturam.
--    Os erp_receber usam COALESCE(v_ped.numero,''), NÃO o par bruto — as âncoras só pegam as 2 mov.
DO $$
DECLARE v_def text; v_new text; v_oc int;
        a_col text := 'ref_numero, data_movimento';
        a_val text := 'v_ped.numero, now()';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE proname='fn_faturar' AND pronamespace='public'::regnamespace;
  IF v_def IS NULL THEN RAISE EXCEPTION 'fn_faturar nao encontrada'; END IF;
  IF position('usuario_id' IN v_def) > 0 THEN RETURN; END IF;   -- idempotente

  v_oc := (length(v_def) - length(replace(v_def, a_col, ''))) / length(a_col);
  IF v_oc <> 2 THEN RAISE EXCEPTION 'fn_faturar: ancora coluna esperava 2, achei %', v_oc; END IF;
  v_oc := (length(v_def) - length(replace(v_def, a_val, ''))) / length(a_val);
  IF v_oc <> 2 THEN RAISE EXCEPTION 'fn_faturar: ancora valor esperava 2, achei %', v_oc; END IF;

  v_new := replace(v_def, a_col, 'ref_numero, usuario_id, data_movimento');   -- ambas as ocorrencias
  v_new := replace(v_new, a_val, 'v_ped.numero, auth.uid(), now()');          -- ambas as ocorrencias
  EXECUTE v_new;
END $$;
