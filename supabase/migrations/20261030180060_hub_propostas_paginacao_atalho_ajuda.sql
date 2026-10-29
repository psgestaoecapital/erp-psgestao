-- Hub · Propostas: "?" da paginação da lista e do atalho para a Calculadora (RD-95). Aditiva, idempotente.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT * FROM (VALUES
  ('projetos.propostas.mostrar_mais', '/dashboard/projetos/propostas', 'Propostas', 'Mostrar mais propostas',
   'Toque para exibir mais 25 propostas da lista atual (respeita a busca e o filtro de situação).', 'A lista abre leve com 25 linhas e cresce sob demanda, sem cortar nenhuma proposta.', 'Mostrando 25 de 60 → toque e veja 50', 'Achar que só existem 25: o contador mostra o total filtrado.', 'hub', 964, 1, 'publicado'),
  ('projetos.propostas.atalho_calculadora', '/dashboard/projetos/propostas', 'Propostas', 'Atalho para a Calculadora',
   'Abre a Calculadora de obra para simular custo e preço antes de ajustar a proposta.', 'Evita sair do Hub para refazer a conta de uma proposta.', 'Simular outro BDI', 'Esperar que a calculadora altere a proposta: ela só simula; os ajustes são feitos no editor (Abrir).', 'hub', 965, 1, 'publicado')
) AS t(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = t.chave);
