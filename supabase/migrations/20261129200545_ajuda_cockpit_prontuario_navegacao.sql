-- Hub §329 (cockpit / prontuário da obra): ajuda de campo ("?") do bloco "Prontuário da obra".
-- Bloco novo = navegação por assunto da obra (atalhos para as telas donas já existentes: ficha, orçamento,
-- custos, cronograma, diário, medições, regularização, encerramento...). RD-95: todo bloco novo tem "?".
-- Só texto novo, aditivo e idempotente (RD-97): nenhuma linha existente é alterada.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('projetos.cockpit.prontuario_navegacao', '/dashboard/projetos/obras/[id]/cockpit', 'Cockpit da obra', 'Prontuário da obra',
   'Nada a preencher: são atalhos. Clique no assunto para abrir a tela responsável por ele dentro desta mesma obra.',
   'Reúne num só lugar o acesso a tudo o que a obra tem — dados gerais, orçamento, custos, materiais, mão de obra, subempreiteiros, medições, cronograma, diário (RDO), regularização, entrega e pós-obra — para você ir direto ao assunto sem procurar no menu.',
   'Clicar em "Cronograma" abre o cronograma desta obra; "Diário de obra" abre o RDO desta obra.',
   'Esperar que o atalho mostre o dado aqui no cockpit: ele apenas LEVA para a tela dona do assunto, onde o dado é preenchido e consultado.',
   'projetos', 905)
ON CONFLICT (chave) DO NOTHING;
