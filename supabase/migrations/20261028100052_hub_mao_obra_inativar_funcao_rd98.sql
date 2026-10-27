-- Hub · /dashboard/projetos/mao-obra — delta 88 -> 95 (aud 27/10 15:35 #3310 · Code: desenvolvedor_4_g)
-- Auditor PDCA, delta p/ 95:
--   1) RD-98 p2/p4: expor "Excluir (soft-delete RASTREÁVEL)" por função NA LINHA — hoje só Editar/Unir, e inativar
--      função só pelo modal. Vira ação visível "Inativar"/"Reativar" (reversível) via RPC guardada NOVA
--      fn_mao_obra_funcao_inativar, que flipa ativo E grava QUEM/QUANDO em audit_log_global (rastreável de verdade,
--      não só updated_at). Chave de ajuda nova para o "?" do botão.
--   2) RD-98 p3 (ORIGEM): system_screens.views_consumidas estava null; a tela só chama RPCs (sem .from direto), então
--      registra as TABELAS que essas RPCs leem/gravam (provado no corpo das funções, RD-38).
--
-- Migration (RD-94.1): INSERT de ajuda (ON CONFLICT DO NOTHING) + UPDATE de catálogo + função NOVA aditiva,
-- SECURITY DEFINER com guarda de empresa + exige-gestor, REVOKE anon/public. Não faz DELETE físico, não toca RLS
-- de tabela, não altera função/view existente. Inativar = soft (ativo=false), reversível, com trilha de auditoria.

-- (1a) RPC guardada: inativar/reativar função com trilha (audit_log_global). Não apaga: só flipa 'ativo'.
CREATE OR REPLACE FUNCTION public.fn_mao_obra_funcao_inativar(p_company_id uuid, p_id uuid, p_inativar boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_nome text; v_antes boolean;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  PERFORM public.fn__mao_obra_exige_gestor(p_company_id);
  SELECT nome, ativo INTO v_nome, v_antes
    FROM public.erp_funcao_mao_obra WHERE id = p_id AND company_id = p_company_id FOR UPDATE;
  IF v_nome IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Função não encontrada nesta empresa.'); END IF;
  IF v_antes = (NOT p_inativar) THEN
    RETURN jsonb_build_object('ok', true, 'ativo', v_antes);  -- já está no estado pedido (idempotente)
  END IF;
  UPDATE public.erp_funcao_mao_obra SET ativo = NOT p_inativar, updated_at = now()
   WHERE id = p_id AND company_id = p_company_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (p_company_id, auth.uid(), 'erp_funcao_mao_obra', p_id,
            CASE WHEN p_inativar THEN 'inativar' ELSE 'reativar' END,
            jsonb_build_object('ativo', v_antes, 'nome', v_nome),
            jsonb_build_object('ativo', NOT p_inativar, 'nome', v_nome));
  PERFORM public.fn__mao_obra_sync_catalogo(p_id);
  RETURN jsonb_build_object('ok', true, 'ativo', NOT p_inativar);
END $function$;

REVOKE ALL ON FUNCTION public.fn_mao_obra_funcao_inativar(uuid, uuid, boolean) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_funcao_inativar(uuid, uuid, boolean) TO authenticated;

-- (1b) "?" do novo botão de linha
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_projetos', 'publicado'
FROM (VALUES
  ('projetos.mao_obra.acao.inativar_funcao', 'Mão de obra', 'Inativar / Reativar função',
   'Nada a preencher: é um botão. "Inativar" tira a função do uso ativo; "Reativar" devolve.',
   'Serve para aposentar uma função que você não usa mais, sem perder o histórico. Inativa: some do cálculo de custo e dos seletores de função (fica esmaecida na lista); o dado continua no banco e pode ser reativado a qualquer momento. É a forma correta de "excluir" uma função — reversível e com trilha de quem fez e quando (auditoria).',
   'Criou "Ajudante Temporário" para uma obra única e não vai mais usar: inative. Precisou de novo no mês seguinte: reative e o histórico volta junto.',
   'Confundir com "Unir": Unir junta duas funções parecidas numa só (migra o histórico); Inativar só tira a função do uso ativo, sem juntá-la a outra.',
   48, '/dashboard/projetos/mao-obra')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- (2) RD-98 p3: origem do dado de /dashboard/projetos/mao-obra (a tela chama só RPCs; tabelas que elas tocam)
UPDATE public.system_screens
   SET views_consumidas = ARRAY[
        'erp_funcao_mao_obra',     -- funções (nome/CBO/forma de pagamento/HE/ativo) — lista e custo por função
        'erp_mao_obra_custo',      -- fichas das pessoas/perfis (salário, encargos, horas) — base do custo
        'erp_mao_obra_componente', -- componentes do custo (parcelas que compõem custo hora/mês)
        'erp_encargos_empresa',    -- encargos-padrão da empresa (provisórios até configurar)
        'erp_mao_obra_acesso_log'  -- trilha LGPD de quem viu o custo (dado sensível de pessoa)
       ]::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/mao-obra';
