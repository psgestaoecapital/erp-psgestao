-- Hub HB2: ajuda "?" do botão Imprimir / PDF da lista de compra da Calculadora de Obra (aditiva).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'projetos.calculadora.pdf', 'Calculadora de Obra', 'Imprimir / PDF', 'Nada a preencher: o botão abre a lista de compra pronta para imprimir.', 'Gera a lista com material, quantidade, custo e total; na impressão escolha "Salvar como PDF" para anexar a pedidos.', 'Total R$ 1.320,00', 'Pop-up bloqueado pelo navegador: libere e clique de novo.', 23, '/dashboard/projetos/calculadora', 'hub', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
