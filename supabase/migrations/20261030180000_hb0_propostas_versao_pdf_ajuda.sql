-- HB0 (auditor F15 em /dashboard/projetos/propostas): lista mostra versão (v2+), PDF anexado, paginação e atalho Calcular.
-- Só acrescenta os textos do "?" (RD-95) das áreas novas. Aditiva e idempotente; não toca dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Propostas', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/propostas', 'hub', 'publicado'
FROM (VALUES
 ('projetos.propostas.calcular', 'Calcular', 'Nada a preencher: leva à calculadora de obra para conferir quantidades e custos antes de ajustar a proposta.', 'Atalho para refazer a conta da obra sem sair do Hub.', 'Abra a calculadora, confira o custo e volte para abrir a proposta.', 'Alterar a calculadora não muda a proposta sozinha: abra a proposta e atualize os itens.', 91),
 ('projetos.propostas.paginacao', 'Páginas da lista', 'Nada a preencher: use Anterior e Próxima para ver as demais propostas (25 por página).', 'Mantém a lista rápida e legível quando há muitas propostas.', 'Página 2 de 4.', 'A busca e o filtro valem para todas as páginas; ao mudar, volta à página 1.', 92)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
