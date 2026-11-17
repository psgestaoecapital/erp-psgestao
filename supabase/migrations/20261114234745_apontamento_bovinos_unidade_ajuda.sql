-- RD-95: "?" do campo novo "Unidade / Planta" do Apontamento de Produção — Bovinos
-- (/dashboard/industrial/apontamento). A tela ganhou o seletor de unidade (o unidade_id
-- era enviado sempre vazio -> POST 400). Chave nova, aditiva e idempotente (ON CONFLICT DO NOTHING).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT * FROM (VALUES
  ('industria.apontamento.unidade_id', '/dashboard/industrial/apontamento', NULL, 'Unidade / Planta',
   'Escolha a unidade (planta/frigorífico) onde a produção do turno aconteceu. A lista traz só as unidades ativas da empresa selecionada no topo da tela.',
   'Vincula o apontamento à planta certa, para o custo, o rendimento e os KPIs do dia ficarem separados por unidade.',
   'Planta Matriz — Abate.',
   'Apontar sem escolher a unidade: o turno não é gravado (a unidade é obrigatória).',
   'industria', 0, 'publicado')
) AS v(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
ON CONFLICT (chave) DO NOTHING;
