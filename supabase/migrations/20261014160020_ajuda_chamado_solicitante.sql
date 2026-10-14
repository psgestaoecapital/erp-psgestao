-- "?" do seletor "Em nome de" do chamado aberto pela equipe PS (RD-95). Aditiva: só texto de ajuda. Faixa 20.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT 'chamado.solicitante', 'Chamados', 'Em nome de', 'Escolha a pessoa da empresa cliente que pediu a ajuda. Deixe em branco se o chamado é interno da equipe.', 'A pessoa escolhida passa a receber as respostas e os avisos deste chamado, e o chamado aparece para ela na lista da empresa.', 'Karol pediu ajuda por telefone: abra o chamado e escolha "Karol" aqui.', 'Escolher alguém de outra empresa: só aparecem pessoas vinculadas à empresa selecionada no topo.', 1, '/dashboard/melhorias', 'gestao_empresarial', 'publicado'
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
