-- ============================================================
-- #27 + #42 (Karoline/Frioeste) · vincular tipo de treinamento -> tipo de documento
-- passa a RETRO-SINCRONIZAR os certificados já anexados.
-- ============================================================
-- A ponte certificado->ficha já existe (20260906010000): fn_nr_sincronizar_documento gera o
-- documento na ficha do funcionário, e a rota de anexo já a chama a cada upload. MAS o vínculo
-- (tipo_documento_id) é pré-requisito, e configurá-lo NÃO puxava os certificados que já estavam
-- anexados — só valia dali pra frente. Resultado auditado (RD-38) na Frioeste: 10 tipos, 2
-- vinculados; NR-12 (vinculado) tem 17 certificados e 0 órfãos, enquanto NR-36/NR-11 (não
-- vinculados) somam 12 certificados fora da ficha. A Karoline pediu duas vezes justamente porque,
-- ao vincular, os certificados antigos continuavam de fora — parecia que "não caía sozinho".
--
-- Correção cirúrgica: ao vincular (tipo_documento_id não nulo), sincroniza na hora todas as
-- presenças com certificado desse treinamento. fn_nr_sincronizar_documento é IDEMPOTENTE (índice
-- único nr_presenca_id: uma presença = no máximo um documento), então re-vincular não duplica.
-- Desvincular (NULL) não sincroniza nada e não apaga o que já existe.
-- Preserva a assinatura, os guards e as validações da versão anterior; só acrescenta o retro-sync
-- e devolve quantos certificados foram para as fichas (a tela mostra a confirmação).

CREATE OR REPLACE FUNCTION public.fn_nr_tipo_vincular_documento(
  p_company_id uuid, p_tipo_id uuid, p_tipo_documento_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_sync int := 0; v_pres uuid; v_r jsonb;
BEGIN
  PERFORM public.fn_nr_assert_acesso(p_company_id);
  IF p_tipo_documento_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM compliance_tipos_documento
                      WHERE id = p_tipo_documento_id AND categoria = 'funcionario' AND ativo) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tipo_documento_invalido');
  END IF;
  UPDATE nr_treinamento_tipo SET tipo_documento_id = p_tipo_documento_id, atualizado_em = now()
   WHERE id = p_tipo_id AND company_id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'tipo_nao_encontrado'); END IF;

  -- #27+#42 · retro-sync: certificados já anexados deste treinamento caem nas fichas agora.
  -- Idempotente (uma presença = um documento); desvincular não dispara.
  IF p_tipo_documento_id IS NOT NULL THEN
    FOR v_pres IN
      SELECT p.id
        FROM nr_turma_presenca p
        JOIN nr_turma tu ON tu.id = p.turma_id
       WHERE tu.tipo_id = p_tipo_id
         AND p.company_id = p_company_id
         AND COALESCE(btrim(p.certificado_url), '') <> ''
    LOOP
      v_r := public.fn_nr_sincronizar_documento(v_pres);
      IF COALESCE((v_r->>'gerou')::boolean, false) THEN v_sync := v_sync + 1; END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'sincronizados', v_sync);
END $function$;

GRANT EXECUTE ON FUNCTION public.fn_nr_tipo_vincular_documento(uuid, uuid, uuid) TO authenticated;
