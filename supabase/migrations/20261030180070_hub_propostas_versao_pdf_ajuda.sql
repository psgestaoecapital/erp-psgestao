-- HB0 (auditor F15 em /dashboard/projetos/propostas): coluna Versão (revisão de), PDF anexo, atalho à Calculadora e
-- "Mostrar mais". Só acrescenta os textos do "?" (RD-95) das áreas novas. Aditiva e idempotente; não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Propostas', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/propostas', 'hub', 'publicado'
FROM (VALUES
 ('projetos.propostas.versao', 'Versão da proposta', 'Nada a preencher: mostra a versão (v1, v2…) e, quando a proposta é revisão de outra, o número da proposta de origem. Também avisa se há PDF anexo.', 'Deixa claro qual é a versão vigente e de qual proposta ela nasceu, sem abrir uma a uma.', 'v2 · revisão de ORC-0012: segunda versão da ORC-0012.', 'Enviar ao cliente uma versão antiga: confira se existe versão mais nova do mesmo cliente.', 27),
 ('projetos.propostas.com_pdf', 'Com PDF anexo', 'Nada a preencher: conta as propostas que têm o PDF guardado no sistema.', 'Mostra quantas propostas já têm o documento final arquivado para consulta.', '4 de 6: duas propostas ainda sem PDF anexo.', 'Achar que proposta sem PDF anexo não foi enviada: o envio por link não gera anexo.', 28),
 ('projetos.propostas.revisoes', 'Revisões', 'Nada a preencher: conta as propostas que são nova versão de outra.', 'Ajuda a ver quanto retrabalho de negociação existe nas propostas.', '2: duas propostas são revisões.', 'Contar a mesma negociação duas vezes: cada revisão é uma proposta própria.', 29),
 ('projetos.propostas.calculadora', 'Calculadora de obra', 'Nada a preencher: abre a Calculadora para estimar custo e preço de uma obra.', 'Permite conferir quantidades e preço antes de ajustar a proposta.', 'Abra, calcule e volte a Abrir a proposta para aplicar.', 'Esperar que a Calculadora altere a proposta sozinha: ela só calcula.', 30),
 ('projetos.propostas.mostrar_mais', 'Mostrar mais', 'Toque para ver as próximas 25 propostas da lista filtrada.', 'A lista aparece de 25 em 25 para carregar leve, inclusive no celular.', 'Mostrar mais (30 restantes).', 'Achar que a lista acabou: o contador mostra quantas faltam.', 31)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
