-- ============================================================
-- NF-e recebidas · DAR CIÊNCIA reseta xml_tentativas (destrava o recebimento) + "tentar novamente" manual
--
-- Dor (KGF, 09-10): o teto de 20 tentativas (#1315) foi feito para 2 notas crônicas (WAY e Avantpar,
-- 675 tentativas — a SEFAZ nunca libera). Mas 20 tentativas se esgotam em ~10h (cron de 30min), então
-- notas normais tambem batiam no teto e paravam. Pior: uma nota que so recebe CIÊNCIA depois de ja ter
-- gasto as 20 tentativas ficava ORFÃ — o worker nao tentava mais, mesmo com a ciencia dada (a 1754884
-- da Scherer foi exatamente isso).
--
-- Ciencia (e Confirmacao) é o ATO que libera o XML na SEFAZ — é o momento em que faz sentido tentar de
-- novo. Entao:
--   1) TRIGGER: ao manifestar como 'ciencia'/'confirmada' uma nota ainda sem XML (resumo/aguardando_xml),
--      zera xml_tentativas (e ultima_tentativa_xml) para o worker voltar a buscar. Funciona de qualquer
--      origem (edge nfe-manifestar, RPC, update manual), porque vive no banco.
--      Recusa ('desconhecida'/'nao_realizada') NAO reseta — a nota sai do fluxo (status='ignorada').
--   2) RPC fn_nfe_recebida_retentar_xml: "tentar novamente" manual da tela (ao lado do "precisa de acao"),
--      zera o contador de uma nota especifica (mesma guarda de acesso da fila).
--
-- Nao mexe no teto (#1315) nem no worker: as 2 notas crônicas (675) seguem paradas em 'precisa_xml'.
-- ============================================================

-- 1) Trigger: ciencia/confirmacao zera o contador (o ato libera o XML → tentar de novo faz sentido).
CREATE OR REPLACE FUNCTION public.fn_nfe_reset_tentativas_ao_manifestar()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Só reseta nas manifestações que LIBERAM o XML (ciencia/confirmada) e só se a nota ainda espera XML.
  -- Recusa (desconhecida/nao_realizada) tira a nota do fluxo — nao deve retentar.
  IF NEW.status_manifestacao IN ('ciencia','confirmada')
     AND NEW.status IN ('resumo','aguardando_xml') THEN
    NEW.xml_tentativas := 0;
    NEW.ultima_tentativa_xml := NULL;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_nfe_reset_tentativas_manifestar ON public.erp_nfe_recebidas;
CREATE TRIGGER trg_nfe_reset_tentativas_manifestar
  BEFORE UPDATE ON public.erp_nfe_recebidas
  FOR EACH ROW
  WHEN (OLD.status_manifestacao IS DISTINCT FROM NEW.status_manifestacao)
  EXECUTE FUNCTION public.fn_nfe_reset_tentativas_ao_manifestar();

-- 2) "Tentar novamente" manual: zera o contador de uma nota (mesma guarda de acesso da fila de recebidas).
CREATE OR REPLACE FUNCTION public.fn_nfe_recebida_retentar_xml(p_nfe_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_status text; v_tent int;
BEGIN
  SELECT company_id, status, xml_tentativas INTO v_comp, v_status, v_tent
    FROM public.erp_nfe_recebidas WHERE id = p_nfe_id;
  IF v_comp IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nfe_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_status <> 'aguardando_xml' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'status_invalido', 'status', v_status,
      'msg', 'So faz sentido tentar novamente quando a nota esta aguardando o XML.'); END IF;
  UPDATE public.erp_nfe_recebidas
     SET xml_tentativas = 0, ultima_tentativa_xml = NULL, updated_at = now()
   WHERE id = p_nfe_id;
  RETURN jsonb_build_object('ok', true, 'status', 'aguardando_xml', 'zerado_de', v_tent);
END $function$;
