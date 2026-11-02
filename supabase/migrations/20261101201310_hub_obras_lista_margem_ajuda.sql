-- Hub · Obras (lista) — RD-95: "?" do novo indicador "Resultado (faturado − custo)" por obra.
-- Aditiva: apenas 1 linha nova em erp_ajuda_campo (idempotente por chave). Não toca dado de cliente,
-- RLS, função, fiscal nem financeiro. Faixa de migration do agente: segundos :10.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES (
  'projetos.obras.res_margem',
  '/dashboard/projetos/obras',
  'Resultado',
  'Resultado realizado',
  'Nada a preencher: resultado operacional da obra pelo banco — receita reconhecida (serviço + material já medidos) menos o custo real (material + viagens).',
  'Mostra, ao vivo, se a obra está dando lucro ou prejuízo. Verde = positivo; vermelho = negativo. Pode diferir do Faturado acima, que conta só as NFS-e já emitidas; o Resultado considera o que já foi medido/consumido mesmo antes da nota sair.',
  'Receita reconhecida R$ 253.940 − Custo R$ 142.127 = Resultado R$ 111.813 (verde).',
  'Confundir com o Faturado: o Resultado é por competência (o que já foi medido e gasto); o Faturado é só o que já virou NFS-e. Traço (—) = ainda não há receita nem custo na obra.',
  'hub_projetos',
  44
)
ON CONFLICT (chave) DO NOTHING;
