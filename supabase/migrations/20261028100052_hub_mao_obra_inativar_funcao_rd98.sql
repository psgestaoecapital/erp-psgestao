-- Hub · /dashboard/projetos/mao-obra — delta 88 -> 95 (aud 27/10 15:35 #3310 · Code: desenvolvedor_4_g)
-- Auditor PDCA: (a) "Ação Excluir por função não visível na linha" e (b) "RD-98: views_consumidas vazio (10 rpcs ok)".
--   (a) RD-95/UX: a linha da função ganha ação VISÍVEL "Inativar"/"Reativar" (soft, reversível) — antes só Editar/Unir,
--       e inativar função só dava pelo modal. Reaproveita a RPC guardada EXISTENTE fn_mao_obra_funcao_salvar, que já
--       trata {ativo} no UPDATE (nenhuma função nova; nada sensível criado). Chave de ajuda nova para o "?" do botão.
--   (b) RD-98 p3 (ORIGEM): system_screens.views_consumidas estava null; a tela só chama RPCs (sem .from direto), então
--       registra as TABELAS que essas RPCs leem/gravam (provado no corpo das funções, RD-38): erp_funcao_mao_obra,
--       erp_encargos_empresa, erp_mao_obra_custo, erp_mao_obra_componente, erp_mao_obra_acesso_log. rpcs_chamadas já ok.
--
-- Migration ADITIVA (RD-94.1): só INSERT de ajuda (ON CONFLICT DO NOTHING) + UPDATE de catálogo de telas. Sem RLS,
-- sem função/view nova, sem tocar dado de cliente.

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_projetos', 'publicado'
FROM (VALUES
  ('projetos.mao_obra.acao.inativar_funcao', 'Mão de obra', 'Inativar / Reativar função',
   'Nada a preencher: é um botão. "Inativar" tira a função do uso ativo; "Reativar" devolve.',
   'Serve para aposentar uma função que você não usa mais, sem perder o histórico. Inativa: some do cálculo de custo e dos seletores de função (fica esmaecida na lista); o dado continua no banco e pode ser reativado a qualquer momento. É a forma correta de "excluir" uma função — reversível e rastreável (não apaga de verdade).',
   'Criou "Ajudante Temporário" para uma obra única e não vai mais usar: inative. Precisou de novo no mês seguinte: reative e o histórico volta junto.',
   'Confundir com "Unir": Unir junta duas funções parecidas numa só (migra o histórico); Inativar só tira a função do uso ativo, sem juntá-la a outra.',
   48, '/dashboard/projetos/mao-obra')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3: origem do dado de /dashboard/projetos/mao-obra (a tela chama só RPCs; estas são as tabelas que elas tocam)
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
