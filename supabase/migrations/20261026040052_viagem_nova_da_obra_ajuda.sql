-- Hub · Viagens (gap do auditor "viagem criada em 1 toque a partir da obra"): atalho no cockpit da obra que abre
-- /dashboard/projetos/viagens com a obra e a data de hoje preenchidas. Só o "?" (RD-95) da ação nova; só acrescenta.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES ('projetos.cockpit.nova_viagem', 'Atalhos', 'Nova viagem desta obra',
  'Toque para abrir uma viagem já ligada a esta obra, com saída e volta marcadas para hoje. Falta só o colaborador (e a placa, se for de carro).',
  'A viagem nasce com o centro de custo da obra: hotel, comida, pedágio e combustível lançados nela entram no Resultado desta obra.',
  'Equipe saindo hoje para a obra 12 → toque, digite o colaborador e "Abrir viagem".',
  'Abrir a viagem pela lista geral e esquecer de escolher a obra: o custo fica sem dono até alguém corrigir.',
  150, '/dashboard/projetos/obras/[id]/cockpit', 'projetos', 'publicado')
ON CONFLICT (chave) DO NOTHING;
