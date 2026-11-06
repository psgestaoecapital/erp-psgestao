-- HB0 (auditor F15 em /dashboard/projetos/propostas · "Proposta → Obra visível"): a lista mostra a obra que nasceu de
-- cada proposta e quantas propostas ganhas já viraram obra. Só acrescenta os textos do "?" (RD-95) das áreas novas.
-- Aditiva e idempotente; não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Propostas', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/propostas', 'hub', 'publicado'
FROM (VALUES
 ('projetos.propostas.obra', 'Obra da proposta', 'Nada a preencher: quando o cliente aprova, a obra é criada sozinha com os itens da proposta. Aqui aparece o número, o nome e a situação dela; toque para abrir.', 'Liga a venda à execução: o escopo aprovado vira o escopo da obra, e o custo da obra é comparado com o que foi vendido.', 'OB-2026-0004 · Piso epóxi galpão · em andamento.', '"aprovada sem obra": a proposta foi aprovada mas a obra não nasceu (módulo de obras desligado na empresa). "não é obra": a proposta foi marcada como venda sem obra.', 23),
 ('projetos.propostas.ganhas_com_obra', 'Ganhas com obra', 'Nada a preencher: conta as propostas aprovadas que já têm obra, sobre todas as aprovadas que são obra.', 'Mostra se toda venda fechada chegou à execução — nenhuma obra vendida pode ficar sem acompanhamento de custo.', '4 de 4: toda proposta ganha já é obra.', 'Contar a proposta marcada como "não é obra": ela fica fora da conta de propósito.', 24)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
