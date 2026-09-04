-- Chamado #20 · Fase 3b (§8.2): a fila "entregue sem nota".
--
-- NF não bloqueia a entrega (o cliente leva o carro). Mas uma OS entregue SEM nota fiscal não pode
-- sumir — é onde o dinheiro/obrigação fiscal parou. Esta fila lista as OS entregues que ainda não
-- têm nota (nem NFS-e de serviço nem NF-e de peça), ordenadas pela mais antiga (onde parou há mais tempo).
--
-- Pré-requisito: saber se a OS TEM nota dos dois lados.
--   • NF-e de peça já linka à OS (erp_nfe_emitidas.os_id — Fase 3).
--   • NFS-e de serviço NÃO linkava (a Fase 2 emite pelo modal→edge gov-nfse-emitir, sem os_id).
--     Aqui adicionamos erp_nfse_emitidas.os_id + fn_os_nfse_vincular, que a tela chama DEPOIS da
--     emissão (por provider_reference) — sem tocar a edge que já emitiu as 84 notas.

-- 1) link OS ↔ NFS-e
ALTER TABLE public.erp_nfse_emitidas ADD COLUMN IF NOT EXISTS os_id uuid;
CREATE INDEX IF NOT EXISTS idx_erp_nfse_emitidas_os_id ON public.erp_nfse_emitidas(os_id) WHERE os_id IS NOT NULL;

-- Liga a NFS-e recém-emitida à OS, pela referência do provider. Idempotente e sem sobrescrever.
CREATE OR REPLACE FUNCTION public.fn_os_nfse_vincular(p_os_id uuid, p_provider_reference text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_comp uuid; v_n int;
BEGIN
  SELECT company_id INTO v_comp FROM erp_os WHERE id = p_os_id;
  IF v_comp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'OS não encontrada'); END IF;
  IF NOT (v_comp IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;
  IF COALESCE(btrim(p_provider_reference),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem referência'); END IF;
  UPDATE erp_nfse_emitidas SET os_id = p_os_id
   WHERE provider_reference = p_provider_reference AND company_id = v_comp AND os_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'vinculadas', v_n);
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_os_nfse_vincular(uuid, text) TO authenticated;

-- 2) a fila: OS entregues sem nota fiscal (nem NFS-e nem NF-e autorizada/processando).
--    Uma nota REJEITADA não conta como "tem nota" — a OS ainda está descoberta.
CREATE OR REPLACE FUNCTION public.fn_os_entregue_sem_nota(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_lista jsonb;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'os_id', o.id, 'numero', o.numero, 'cliente_nome', o.cliente_nome,
           'total', o.total, 'entregue_em', o.entregue_em,
           'dias', GREATEST(0, (CURRENT_DATE - o.entregue_em::date)),
           'faturada', (COALESCE(o.titulos_gerados,false) OR o.lancamento_id IS NOT NULL),
           'tem_servico', EXISTS(SELECT 1 FROM erp_os_diagnostico_item i WHERE i.os_id=o.id AND i.tipo='servico' AND i.aprovado),
           'tem_peca', EXISTS(SELECT 1 FROM erp_os_diagnostico_item i WHERE i.os_id=o.id AND i.tipo='peca' AND i.aprovado)
         ) ORDER BY o.entregue_em ASC), '[]'::jsonb)
    INTO v_lista
  FROM erp_os o
  WHERE o.company_id = p_company_id
    AND o.entregue_em IS NOT NULL
    AND o.status NOT IN ('cancelada')
    AND NOT EXISTS (SELECT 1 FROM erp_nfe_emitidas n  WHERE n.os_id = o.id AND n.status IN ('autorizada','processando'))
    AND NOT EXISTS (SELECT 1 FROM erp_nfse_emitidas s WHERE s.os_id = o.id AND s.status IN ('autorizada','processando'));

  RETURN jsonb_build_object('ok', true, 'itens', v_lista,
    'total_parado', COALESCE((SELECT SUM((e->>'total')::numeric) FROM jsonb_array_elements(v_lista) e), 0),
    'qtd', jsonb_array_length(v_lista));
END $function$;
GRANT EXECUTE ON FUNCTION public.fn_os_entregue_sem_nota(uuid) TO authenticated;
