-- PDCA P&M (auditor_pdca_2) · /dashboard/pm/briefings · "popular dado real e provar jornada".
--
-- Contexto (RD-38, provado no dado): a tela de Briefings já está pronta (origem/RD-95 OK), mas a DEMO Agência
-- (b0700000-…-002) só tinha 2 briefings (um "[BOT]" e um "Teste Bloco 1 …"), insuficiente para demonstrar a
-- jornada (novo → em análise → aprovado → virou job) e os KPIs (pendentes / viraram job).
--
-- Esta migration SEMEIA 8 briefings realistas da carteira DEMO (clientes reais da DEMO: Clínica Sorriso Vale,
-- Construtora Horizonte, Academia Pulso, Moda Lume, Café Serra Azul), cobrindo os 4 status do STATUS map da tela.
--
-- SEGURANÇA: 100% ADITIVA (só INSERT). Guarda `is_demo` — nunca grava se a empresa-alvo não for DEMO, logo
-- jamais toca dado de cliente real. IDs fixos + ON CONFLICT (id) DO NOTHING → idempotente (re-roda sem duplicar).
-- cliente_id aponta para agency_clientes existentes da própria DEMO (confirmado no dado).

INSERT INTO public.agency_briefings
  (id, company_id, cliente_id, titulo, descricao, objetivo, publico_alvo, referencias,
   prazo_desejado, orcamento_estimado, tipo_servico, prioridade, status, solicitante)
SELECT v.id::uuid, v.company_id::uuid, v.cliente_id::uuid, v.titulo, v.descricao, v.objetivo,
       v.publico_alvo, v.referencias, v.prazo::date, v.orcamento::numeric, v.tipo_servico,
       v.prioridade, v.status, v.solicitante
FROM (VALUES
  ('b0700002-0000-4000-b000-000000000001','b0700000-0000-4000-a000-000000000002','e7d1df48-a289-46ca-9358-5e9a22971c1d',
   'Campanha de captação de pacientes — ortodontia',
   'Atrair novos pacientes para o tratamento ortodôntico com oferta de avaliação gratuita no primeiro mês.',
   'Gerar 40 agendamentos de avaliação por mês pelas redes sociais.',
   'Famílias da região, 25–45 anos, interessadas em ortodontia estética.',
   'Perfis de clínicas odontológicas premium; evitar tom clínico frio.',
   '2026-12-15', 4500, 'social_media', 'alta', 'em_analise', 'Dra. Helena (Clínica Sorriso Vale)'),
  ('b0700002-0000-4000-b000-000000000002','b0700000-0000-4000-a000-000000000002','9732cc98-2531-4b93-9135-7811f33a6b7e',
   'Lançamento imobiliário Residencial Horizonte',
   'Campanha completa de lançamento do novo residencial: tráfego pago, landing page e material de vendas.',
   'Esgotar as unidades da fase 1 em 90 dias.',
   'Investidores e famílias classe A/B buscando imóvel na planta.',
   'Campanhas de lançamento de alto padrão; foco em tour virtual.',
   '2026-12-01', 28000, 'campanha', 'alta', 'aprovado', 'Marcos (Construtora Horizonte)'),
  ('b0700002-0000-4000-b000-000000000003','b0700000-0000-4000-a000-000000000002','849c2360-501e-4e62-b4d9-879531a5d0ab',
   'Plano de conteúdo para redes sociais — verão',
   'Calendário de posts e stories para a temporada de verão, com foco em captação de novos alunos.',
   'Aumentar seguidores engajados e matrículas no período de verão.',
   'Jovens adultos 18–35 anos interessados em saúde e estética.',
   'Linha visual energética; referências fitness nacionais.',
   '2026-12-20', 3200, 'social_media', 'normal', 'novo', 'Rafael (Academia Pulso)'),
  ('b0700002-0000-4000-b000-000000000004','b0700000-0000-4000-a000-000000000002','ddbb4982-4377-45e7-9420-7cffdace3691',
   'Rebranding e identidade visual da nova coleção',
   'Atualizar a identidade visual da marca para o lançamento da coleção cápsula de outono.',
   'Posicionar a marca como referência de moda autoral sustentável.',
   'Público feminino 22–40 anos, consumo consciente.',
   'Moodboards de moda minimalista; paleta terrosa.',
   '2027-01-10', 15000, 'design', 'alta', 'aprovado', 'Lívia (Moda Lume)'),
  ('b0700002-0000-4000-b000-000000000005','b0700000-0000-4000-a000-000000000002','9c62b44a-c827-48df-9ea4-1037d52909a0',
   'Vídeo institucional e cardápio digital',
   'Produzir vídeo institucional curto e implantar cardápio digital com QR code nas mesas.',
   'Reforçar a marca e reduzir custo de impressão de cardápios.',
   'Clientes locais e turistas da serra.',
   'Vídeos aconchegantes de cafeterias; luz natural.',
   '2026-11-30', 6800, 'video', 'normal', 'virou_job', 'Bruno (Café Serra Azul)'),
  ('b0700002-0000-4000-b000-000000000006','b0700000-0000-4000-a000-000000000002','9732cc98-2531-4b93-9135-7811f33a6b7e',
   'Gestão de tráfego pago — leads de apartamentos',
   'Operação contínua de mídia paga (Meta e Google) para geração de leads qualificados.',
   'Reduzir o custo por lead qualificado em 20%.',
   'Compradores em pesquisa ativa por imóveis na região.',
   'Dashboards de performance de tráfego imobiliário.',
   '2026-12-05', 9000, 'trafego', 'normal', 'em_analise', 'Marcos (Construtora Horizonte)'),
  ('b0700002-0000-4000-b000-000000000007','b0700000-0000-4000-a000-000000000002','849c2360-501e-4e62-b4d9-879531a5d0ab',
   'Campanha de Black Friday — planos anuais',
   'Campanha promocional de Black Friday com oferta especial para planos anuais.',
   'Vender 150 planos anuais na semana da Black Friday.',
   'Alunos atuais e ex-alunos; leads de verão.',
   'Campanhas promocionais com senso de urgência.',
   '2026-11-25', 2800, 'campanha', 'alta', 'novo', 'Rafael (Academia Pulso)'),
  ('b0700002-0000-4000-b000-000000000008','b0700000-0000-4000-a000-000000000002','ddbb4982-4377-45e7-9420-7cffdace3691',
   'E-commerce: fotos de produto e catálogo',
   'Ensaio fotográfico da coleção e montagem do catálogo digital para o e-commerce.',
   'Padronizar as fotos de produto e aumentar a conversão da loja.',
   'Consumidoras online da marca.',
   'Still de moda com fundo neutro; sombras suaves.',
   '2026-12-18', 7400, 'design', 'normal', 'virou_job', 'Lívia (Moda Lume)')
) AS v(id, company_id, cliente_id, titulo, descricao, objetivo, publico_alvo, referencias, prazo, orcamento, tipo_servico, prioridade, status, solicitante)
WHERE EXISTS (SELECT 1 FROM public.companies c WHERE c.id = 'b0700000-0000-4000-a000-000000000002' AND c.is_demo)
ON CONFLICT (id) DO NOTHING;
