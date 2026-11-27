-- Hub · Mão de obra › Equipes: ajuda (RD-95) dos indicadores novos Custo total/h e Custo/dia (CEO 24/11).
-- Aditivo/idempotente (ON CONFLICT DO NOTHING). Só texto de ajuda; nenhuma estrutura/cálculo no banco.
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem) VALUES
 ('projetos.mao_obra.equipes.col_total_h', '/dashboard/projetos/mao-obra', 'Equipes', 'Custo total/h da equipe',
  'Indicador (só leitura): a soma do custo/hora de TODAS as pessoas da equipe — quanto a equipe inteira custa por 1 hora trabalhada.',
  'Mostra o custo da equipe completa por hora (diferente do médio, que é por pessoa). Útil para orçar uma frente com a equipe toda.',
  'Equipe de 7 pessoas, médio R$ 37,86/pessoa → total ≈ R$ 265,02/h', 'Confundir com o médio/h (por pessoa) — o total é a equipe inteira.', 'projetos', 40),
 ('projetos.mao_obra.equipes.col_custo_dia', '/dashboard/projetos/mao-obra', 'Equipes', 'Custo/dia',
  'Indicador (só leitura): o custo por dia de trabalho. Equipe/dia = custo total/h × jornada; a 2ª linha mostra o médio por pessoa/dia.',
  'Dá a conta do dia para planejar a obra. Base: jornada padrão de 8h/dia — não há escala cadastrada por equipe; quando houver, passa a usar a da equipe.',
  'Total R$ 265,02/h × 8h = R$ 2.120,16/dia', 'Achar que usa a escala real da equipe — hoje é a jornada padrão de 8h/dia (indicada no "?").', 'projetos', 41)
ON CONFLICT (chave) DO NOTHING;
