-- Hub · Plano de Ação 5W2H (/dashboard/hub/plano-acao) — SEED DEMO (aud8 90/95, PDCA req869)
-- A tela está bem construída (RD-95: "?" em tabs/botões/KPIs/filtros; layout premium; CTA "+ Nova ação"),
-- mas a DEMO ...006 (Construtora Modelo) tinha 0 ações (erp_plano_acao = 0, provado no dado): todos os KPIs
-- em 0 (Abertas/Em andamento/Atrasadas/Concluídas) e as 4 colunas do kanban vazias, impedindo o aud8 de
-- provar b (dado carrega para a etapa seguinte), c (status muda) e g (CRUD de cards) — tela morta (RD-98 p1).
--
-- AÇÃO: só dado de DEMO (RD-69/LGPD — fictício), aditivo e idempotente. Nenhuma mudança de tela/função.
-- Semeia 8 ações 5W2H na DEMO ...006 distribuídas pelas colunas do kanban (aberta / em_andamento / concluida /
-- cancelada) e cobrindo os 4 KPIs: Abertas=3, Em andamento=2, Atrasadas=2 (quando < hoje e não concluída/
-- cancelada), Concluídas (no mês)=2. Datas relativas a CURRENT_DATE (evergreen). Responsável, prazo, origem e
-- os campos 5W2H preenchidos para a jornada ficar auditável.
--
-- Valores de status conforme fn_plano_acao_resumo/listar: aberta, em_andamento, concluida, cancelada.
-- IDEMPOTÊNCIA: ids fixos + ON CONFLICT (id) DO NOTHING. SEGURANÇA: só INSERT na empresa DEMO ...006;
-- não toca dado de cliente real; sem alterar RLS/função.

INSERT INTO public.erp_plano_acao
  (id, company_id, ano, seq, codigo, titulo, o_que, por_que, onde, quando,
   responsavel_user_id, responsavel_nome, como, custo_estimado, status, prioridade, origem, origem_ref,
   concluida_em, criado_em)
VALUES
  -- 1) aberta · prazo futuro (Abertas)
  ('ac111111-0006-4a00-b000-0000000a0001','b0700000-0000-4000-a000-000000000006',2026,901,'PA-2026-901',
   'Padronizar checklist de recebimento de obra',
   'Criar e aplicar um checklist único de vistoria na entrega de cada etapa da obra.',
   'Retrabalho recorrente por itens não conferidos na entrega.','Obras / Qualidade', CURRENT_DATE + 10,
   'f3867e65-94d6-43c0-aeb9-8da82fcfe433','Responsável Demo',
   'Modelo no sistema + treinamento do mestre de obras.', 0, 'aberta','alta','reuniao','Ata 11/2026',
   NULL, now() - interval '6 days'),

  -- 2) aberta · prazo vencido (Abertas + Atrasadas)
  ('ac111111-0006-4a00-b000-0000000a0002','b0700000-0000-4000-a000-000000000006',2026,902,'PA-2026-902',
   'Negociar prazo com fornecedor de esquadrias',
   'Renegociar o prazo de entrega das esquadrias de alumínio do empreendimento Vista Verde.',
   'Atraso do fornecedor impacta o cronograma da obra.','Suprimentos', CURRENT_DATE - 5,
   '43ef8386-3262-4e56-b31a-6f0e41d1e21c','Responsável Demo',
   'Reunião com o comercial do fornecedor e ajuste contratual.', 0, 'aberta','alta','auditoria',NULL,
   NULL, now() - interval '12 days'),

  -- 3) em_andamento · prazo futuro (Em andamento)
  ('ac111111-0006-4a00-b000-0000000a0003','b0700000-0000-4000-a000-000000000006',2026,903,'PA-2026-903',
   'Implantar controle de EPIs por colaborador',
   'Registrar entrega e troca de EPIs por colaborador em todas as frentes de obra.',
   'Exigência de segurança do trabalho e redução de risco de acidente.','SST / Obras', CURRENT_DATE + 7,
   '666fca82-fefb-4a7c-bf35-89463a587e6b','Responsável Demo',
   'Ficha digital + conferência semanal pelo técnico de segurança.', 1200, 'em_andamento','media','reuniao','Ata 11/2026',
   NULL, now() - interval '9 days'),

  -- 4) em_andamento · prazo vencido (Em andamento + Atrasadas)
  ('ac111111-0006-4a00-b000-0000000a0004','b0700000-0000-4000-a000-000000000006',2026,904,'PA-2026-904',
   'Revisar rateio de custos indiretos por obra',
   'Rever os critérios de rateio de custos indiretos entre as obras ativas.',
   'Resultado por obra distorcido dificulta a decisão de preço.','Financeiro / Controladoria', CURRENT_DATE - 2,
   '33464170-036f-4d3b-bc48-f2dc3dfde660','Responsável Demo',
   'Workshop com a controladoria e ajuste no fechamento mensal.', 0, 'em_andamento','alta','auditoria',NULL,
   NULL, now() - interval '20 days'),

  -- 5) concluida no prazo, neste mês (Concluídas)
  ('ac111111-0006-4a00-b000-0000000a0005','b0700000-0000-4000-a000-000000000006',2026,905,'PA-2026-905',
   'Treinar equipe no novo fluxo de medição',
   'Capacitar engenheiros e apontadores no fluxo de medição do Hub.',
   'Medições lançadas fora do padrão geravam glosa.','Engenharia', CURRENT_DATE - 6,
   'f3867e65-94d6-43c0-aeb9-8da82fcfe433','Responsável Demo',
   'Treinamento presencial + material de apoio.', 800, 'concluida','media','reuniao','Ata 10/2026',
   date_trunc('month', now()) + interval '3 days', now() - interval '25 days'),

  -- 6) concluida no prazo, neste mês (Concluídas)
  ('ac111111-0006-4a00-b000-0000000a0006','b0700000-0000-4000-a000-000000000006',2026,906,'PA-2026-906',
   'Organizar documentação de licenças do canteiro',
   'Reunir e digitalizar alvarás e licenças ambientais dos canteiros ativos.',
   'Risco de autuação por documento vencido ou não localizado.','Administrativo', CURRENT_DATE - 1,
   '43ef8386-3262-4e56-b31a-6f0e41d1e21c','Responsável Demo',
   'Pasta digital por obra com alerta de vencimento.', 0, 'concluida','baixa','auditoria',NULL,
   date_trunc('month', now()) + interval '5 days', now() - interval '18 days'),

  -- 7) cancelada (coluna Cancelada do kanban)
  ('ac111111-0006-4a00-b000-0000000a0007','b0700000-0000-4000-a000-000000000006',2026,907,'PA-2026-907',
   'Terceirizar transporte de entulho',
   'Contratar empresa terceira para a remoção de entulho das obras.',
   'Custo e logística do transporte próprio.','Suprimentos', CURRENT_DATE - 8,
   '666fca82-fefb-4a7c-bf35-89463a587e6b','Responsável Demo',
   'Cotação com três fornecedores.', 0, 'cancelada','baixa','reuniao','Ata 10/2026',
   NULL, now() - interval '22 days'),

  -- 8) aberta · prazo futuro (Abertas)
  ('ac111111-0006-4a00-b000-0000000a0008','b0700000-0000-4000-a000-000000000006',2026,908,'PA-2026-908',
   'Criar painel de acompanhamento de prazos de obra',
   'Montar um painel que mostre os marcos de cada obra e o status do prazo.',
   'Falta de visão consolidada do andamento das obras.','Engenharia / Planejamento', CURRENT_DATE + 15,
   '33464170-036f-4d3b-bc48-f2dc3dfde660','Responsável Demo',
   'Configurar os indicadores no Hub e revisar na reunião quinzenal.', 0, 'aberta','media','reuniao','Ata 11/2026',
   NULL, now() - interval '3 days')
ON CONFLICT (id) DO NOTHING;
