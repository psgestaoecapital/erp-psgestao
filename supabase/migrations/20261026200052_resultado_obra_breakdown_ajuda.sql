-- Hub · Resultado por obra: ajuda "?" (RD-95) das novas colunas de custo detalhado
-- (Materiais e Viagens), que a tela passa a exibir separadas do Custo total — fecha o gap
-- de consistência do auditor PDCA ("Blueprint cita compras/viagens mas a tela não exibe").
-- Aditiva: apenas insere linhas de referência em erp_ajuda_campo (sem tocar schema, RLS ou função).
INSERT INTO erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('projetos.resultado_obra.custo_material',
   '/dashboard/projetos/obras/resultado',
   'Colunas',
   'Materiais',
   'Nada a preencher: soma o custo dos materiais consumidos na obra (BOM / saídas de estoque).',
   'Separa quanto a obra gastou de material do restante do custo, para enxergar onde o dinheiro foi.',
   'R$ 18.000,00',
   'Esperar valor sem ter baixado material da obra: sem consumo de estoque a coluna fica em zero.',
   'projetos',
   211,
   1,
   'publicado'),
  ('projetos.resultado_obra.custo_viagens',
   '/dashboard/projetos/obras/resultado',
   'Colunas',
   'Viagens',
   'Nada a preencher: soma o custo das viagens fechadas rateado para esta obra (acerto de deslocamento).',
   'Mostra quanto o deslocamento da equipe custou na obra, já lançado no resultado (GE) sem contar em dobro.',
   'R$ 2.460,35',
   'Esperar valor sem ter fechado viagem com esta obra como destino: viagem aberta ou sem obra não entra.',
   'projetos',
   212,
   1,
   'publicado')
ON CONFLICT (chave) DO NOTHING;
