-- Hub · /dashboard/projetos/propostas — delta 85 -> 95 (aud 27/10 15:29 · Code: dev7claudeps)
--   1) RD-98 p2/p4: Editar + Excluir por proposta NA LINHA. Excluir = soft-delete RASTREÁVEL: a proposta passa a
--      status 'cancelado' (já permitido pelo CHECK de erp_orcamentos), com QUEM/QUANDO em audit_log_global.
--      Nunca DELETE físico. Só propostas ainda sem desfecho (rascunho/enviado/visualizado/recusado/expirado) e sem
--      pedido/obra — proposta aprovada, convertida ou com obra não se exclui (histórico fiscal/comercial).
--   2) RD-95: chaves de ajuda dos botões Editar/Excluir.
--   3) RD-98 p3 (ORIGEM): system_screens.views_consumidas/rpcs_chamadas da rota (null hoje), provado no page.tsx.
-- Migration ADITIVA (RD-94.1): função NOVA SECURITY DEFINER com guarda de empresa, REVOKE anon/public; INSERT de ajuda
-- (ON CONFLICT DO NOTHING); UPDATE de catálogo. Não toca RLS, não altera função/view existente.

CREATE OR REPLACE FUNCTION public.fn_proposta_excluir(p_company_id uuid, p_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_status text; v_numero text; v_pedido uuid; v_obra uuid; v_tem_obra boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para excluir a proposta' USING ERRCODE = '42501'; END IF;
  PERFORM public.fn__guarda_empresa(p_company_id);
  SELECT status, numero, pedido_id, obra_id INTO v_status, v_numero, v_pedido, v_obra
    FROM public.erp_orcamentos WHERE id = p_id AND company_id = p_company_id FOR UPDATE;
  IF v_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Proposta não encontrada nesta empresa.'); END IF;
  IF v_status = 'cancelado' THEN RETURN jsonb_build_object('ok', true, 'status', v_status); END IF;  -- idempotente
  SELECT EXISTS (SELECT 1 FROM public.projetos_obras o WHERE o.orcamento_id = p_id) INTO v_tem_obra;
  IF v_status IN ('aprovado', 'convertido', 'venda_avulsa') OR v_pedido IS NOT NULL OR v_obra IS NOT NULL OR v_tem_obra THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Proposta aprovada, com pedido ou com obra não pode ser excluída. Cancele a obra/pedido antes.');
  END IF;
  UPDATE public.erp_orcamentos SET status = 'cancelado', updated_at = now() WHERE id = p_id AND company_id = p_company_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (p_company_id, auth.uid(), 'erp_orcamentos', p_id, 'excluir',
            jsonb_build_object('status', v_status, 'numero', v_numero),
            jsonb_build_object('status', 'cancelado', 'numero', v_numero, 'motivo', nullif(btrim(coalesce(p_motivo, '')), '')));
  RETURN jsonb_build_object('ok', true, 'status', 'cancelado');
END $function$;

REVOKE ALL ON FUNCTION public.fn_proposta_excluir(uuid, uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_proposta_excluir(uuid, uuid, text) TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_projetos', 'publicado'
FROM (VALUES
  ('projetos.propostas.acao.editar', 'Propostas', 'Editar proposta',
   'Nada a preencher: é um botão. Abre a proposta no editor completo (itens, preços, BDI, condições).',
   'Serve para ajustar uma proposta já criada: trocar item, corrigir preço, mudar validade ou condição de pagamento. Proposta enviada ao cliente pode ser reaberta; o histórico fica registrado.',
   'O cliente pediu desconto: toque em Editar, ajuste o desconto e envie de novo.',
   'Editar uma proposta já aprovada: depois de aprovada ela vira obra/pedido; para mudar valores, peça a liberação de edição no editor.',
   60, '/dashboard/projetos/propostas'),
  ('projetos.propostas.acao.excluir', 'Propostas', 'Excluir proposta',
   'Nada a preencher: é um botão. Pede confirmação e um motivo opcional.',
   'Tira a proposta da lista sem apagar nada do banco: ela passa a "cancelado" e a ação fica gravada (quem, quando, motivo) na auditoria. Só vale para proposta sem desfecho — aprovada, com pedido ou com obra não pode ser excluída.',
   'Proposta duplicada por engano: exclua a cópia e mantenha a original.',
   'Tentar excluir proposta aprovada: o sistema recusa porque já virou obra/pedido; cancele a obra primeiro.',
   61, '/dashboard/projetos/propostas')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

UPDATE public.system_screens
   SET views_consumidas = ARRAY[
        'erp_orcamentos',          -- lista de propostas (exclui canceladas)
        'erp_orcamentos_itens',    -- composição: itens, custo, margem, BDI
        'erp_crm_oportunidade',    -- origem: oportunidade que gerou a proposta
        'erp_crm_visita',          -- origem: visitas técnicas
        'erp_obra_planta',         -- origem: take-off
        'projetos_obras',          -- obra nascida da proposta
        'projetos_modulo_config'   -- BDI padrão da empresa
       ]::text[],
       rpcs_chamadas = ARRAY['fn_proposta_excluir']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/propostas';
