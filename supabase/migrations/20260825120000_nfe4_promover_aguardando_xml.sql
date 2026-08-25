-- NFE-4 (#4) · NF-e Recebidas presas em "resumo". Causa raiz (auditada): a transição
-- resumo → aguardando_xml NUNCA foi implementada, então o cron jobid 41 (fn_dfe_baixar_xml_pendentes
-- _dispatch, filtra status='aguardando_xml') nunca pega as notas → 213 notas do KGF presas em 'resumo'
-- com xml_tentativas=0. A distribuição DF-e (jobid 42) e a cadeia aplicar_xml/gerar_pagar/estoque já
-- funcionam. O status 'resumo' vem do DEFAULT da coluna (o edge worker insere sem status).
--
-- Decisão do CEO: 🅰️ AUTOMÁTICO — toda nota que chega como resumo vai p/ aguardando_xml (o cron baixa o
-- XML de todas; a Jordana vê os itens de todas). A ciência/manifestação fiscal continua ação SEPARADA
-- e manual (eventos SEFAZ via edge nfe-manifestar; não mexo nisso).
--
-- Implementação: gatilho BEFORE INSERT (independe de onde a nota é inserida — edge/SQL) que promove
-- 'resumo' → 'aguardando_xml' na chegada. + RPC gated p/ promover 1 nota manualmente (botão "Puxar XML").

-- 1) Promotor automático (🅰️): BEFORE INSERT — nota que entraria como 'resumo' já entra na fila do XML.
CREATE OR REPLACE FUNCTION public.fn_nfe_recebida_promover_xml()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.status = 'resumo' THEN NEW.status := 'aguardando_xml'; END IF;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_nfe_promover_xml ON public.erp_nfe_recebidas;
CREATE TRIGGER trg_nfe_promover_xml BEFORE INSERT ON public.erp_nfe_recebidas
  FOR EACH ROW EXECUTE FUNCTION public.fn_nfe_recebida_promover_xml();

-- 2) RPC gated: promover UMA nota 'resumo' → 'aguardando_xml' (botão "Puxar XML" / re-tentar).
--    Idempotente: nota que já saiu de 'resumo' só devolve o status atual.
CREATE OR REPLACE FUNCTION public.fn_nfe_recebida_solicitar_xml(p_nfe_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_comp uuid; v_status text;
BEGIN
  SELECT company_id, status INTO v_comp, v_status FROM public.erp_nfe_recebidas WHERE id = p_nfe_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nfe_nao_encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_status <> 'resumo' THEN
    RETURN jsonb_build_object('ok', true, 'ja_na_fila', true, 'status', v_status); END IF;
  UPDATE public.erp_nfe_recebidas SET status = 'aguardando_xml', updated_at = now() WHERE id = p_nfe_id;
  RETURN jsonb_build_object('ok', true, 'status', 'aguardando_xml');
END $fn$;

REVOKE ALL ON FUNCTION public.fn_nfe_recebida_solicitar_xml(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_nfe_recebida_solicitar_xml(uuid) TO authenticated;
