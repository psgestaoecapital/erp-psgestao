-- Hub · Calculadora: "?" (RD-95) do campo "Nome do cálculo". Aditiva (só texto de ajuda).
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, vertical, ordem, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum)
VALUES
  ('projetos.calculadora.titulo_calculo', '/dashboard/projetos/calculadora', 'Calculadora', 'hub_projetos', 314, 'Nome do cálculo',
   'Opcional: escreva a obra, o cliente ou o ambiente a que este cálculo se refere.', 'Identifica o cálculo no histórico para você reabrir e conferir depois.',
   'Sala reunião — 2º andar', 'Deixar em branco em vários cálculos e depois não saber qual é qual no histórico.')
ON CONFLICT (chave) DO NOTHING;
