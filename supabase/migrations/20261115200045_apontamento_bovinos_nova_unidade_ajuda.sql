-- RD-95: "?" da ação nova "Cadastrar unidade" do Apontamento de Produção — Bovinos
-- (/dashboard/industrial/apontamento). O estado vazio ("Nenhuma unidade/planta cadastrada")
-- ganhou um cadastro rápido inline (critério d do PDCA: antes o usuário travava sem saber
-- onde criar a unidade). Chave nova, aditiva e idempotente (ON CONFLICT DO NOTHING).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  ('industria.apontamento.nova_unidade', '/dashboard/industrial/apontamento', NULL, 'Cadastrar unidade / planta',
   'Dê um nome para a unidade (planta/frigorífico) e clique em Cadastrar. Ela entra na lista de unidades ativas da empresa e já fica selecionada para você apontar a produção.',
   'Cria a unidade sem sair da tela, para quem ainda não tem nenhuma planta cadastrada conseguir apontar a produção já no primeiro acesso.',
   'Planta Matriz — Abate.',
   'Cadastrar a mesma planta duas vezes com nomes diferentes: confira a lista antes de criar outra.',
   'industria', 0, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
ON CONFLICT (chave) DO NOTHING;
