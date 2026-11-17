-- PS EHS · Onda S1.3 — TREINAMENTOS obrigatórios por POSTO (NRs) · piloto DEMO · bucket ehs_completo
--
-- Marcar no posto quais treinamentos (do catálogo nr_treinamento_tipo) são obrigatórios. Vale para todas as
-- pessoas do posto (herança). Backend prod_posto_treinamento (posto_id→prod_posto; tipo_id→nr_treinamento_tipo;
-- obrigatorio) JÁ EXISTE (UNIQUE(posto_id,tipo_id), RLS por empresa). ADITIVA: REVOKE anon + índice, tela
-- classificada 'completo' (só a demo vê — gate #5114), ajuda (RD-95) e SEED FICTÍCIO só na DEMO b0700000
-- (nunca Frioeste/cliente real). Mesmo padrão da S1.1/S1.2.
-- Gancho S1.4: o treinamento do posto entra na herança da pessoa junto com o risco (S1.1) e o EPI (S1.2).

-- 1) prod_posto_treinamento: anon fora (idempotente; RLS já barra) + índice de leitura por empresa/posto
REVOKE ALL ON public.prod_posto_treinamento FROM anon;
CREATE INDEX IF NOT EXISTS idx_prod_posto_treinamento_empresa_posto ON public.prod_posto_treinamento (company_id, posto_id);

-- 2) Menu + tela (NASCE ehs_modulo='completo' — obrigatório; NULL vazaria p/ todos)
INSERT INTO public.module_catalog
  (id, nome, rota, ativo, grupo, icone, ordem, subgrupo, descricao, is_shared, so_ps, legacy, so_demo, diferencial, rbac_isento, dependencies, surface_in_groups, ehs_modulo)
VALUES
  ('ehs_matriz_treinamento_posto', 'Treinamentos por Posto', '/dashboard/ehs/matriz/treinamento-posto', true, 'compliance', 'GraduationCap', 23,
   'docs_regulatorios', 'Treinamentos (NRs) obrigatórios por posto. O treinamento do posto é herdado por todas as pessoas dele.',
   true, false, false, false, false, false, ARRAY[]::text[], ARRAY[]::text[], 'completo')
ON CONFLICT (id) DO UPDATE SET ehs_modulo = EXCLUDED.ehs_modulo, rota = EXCLUDED.rota, ativo = EXCLUDED.ativo;

INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, auditavel_robo, estado_real, prioridade_monitoramento, auditada_ok)
VALUES
  ('dashboard.ehs_matriz_treinamento_posto', '/dashboard/ehs/matriz/treinamento-posto', 'compliance', 'Treinamentos por Posto',
   'Treinamentos (NRs) obrigatórios por posto, herdados pelas pessoas do posto. Piloto DEMO.',
   true, 'desconhecida', 'alta', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, prioridade, descricao_executiva, descricao_tecnica)
VALUES ('F.ehs.matriz_treinamento_posto', 'ehs_matriz_treinamento_posto', 'compliance', 'Treinamentos por Posto', 'pronto', 100, 'alta',
        'Definição dos treinamentos obrigatórios por posto, com NR, carga horária e periodicidade.', 'prod_posto_treinamento + nr_treinamento_tipo; herança via prod_posto_pessoa')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.screen_route_features (screen_id, feature_id, peso)
VALUES ('dashboard.ehs_matriz_treinamento_posto', 'F.ehs.matriz_treinamento_posto', 1)
ON CONFLICT DO NOTHING;

-- 3) Ajuda de campo (RD-95)
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.treino_posto.empresa','/dashboard/ehs/matriz/treinamento-posto','Treinamentos por Posto','Empresa',
   'Quando você cuida de mais de uma empresa, escolha aqui em qual vai definir os treinamentos.',
   'Filtra os postos/treinamentos da tela e define onde o novo treinamento é salvo.',
   'Selecionar a empresa certa antes de incluir um treinamento no posto.',
   'Definir treinamento achando que está numa empresa e estar em outra.',
   'compliance',10,1,'publicado'),
  ('ehs.treino_posto.busca','/dashboard/ehs/matriz/treinamento-posto','Treinamentos por Posto','Buscar',
   'Digite parte do número do posto, da atividade ou do setor para filtrar a lista.',
   'Ajuda a achar rápido um posto quando a empresa tem muitos.',
   '"desossa" para ver os postos da Desossa; "02" para o posto 02.',
   'Esperar que a busca procure pelo nome do treinamento: para isso abra o posto.',
   'compliance',20,1,'publicado'),
  ('ehs.treino_posto.filtro_setor','/dashboard/ehs/matriz/treinamento-posto','Treinamentos por Posto','Setor',
   'Escolha um setor para ver só os postos dele.',
   'Organiza a revisão dos treinamentos setor por setor.',
   'Filtrar por "Abate" para conferir os treinamentos dos postos de abate.',
   'Deixar o filtro ligado e achar que faltam postos — eles estão em outro setor.',
   'compliance',30,1,'publicado'),
  ('ehs.treino_posto.heranca','/dashboard/ehs/matriz/treinamento-posto','Treinamentos por Posto','Herança (pessoas do posto)',
   'Mostra, só pra conferência, quantas pessoas do posto herdam os treinamentos obrigatórios dele.',
   'É a prova da herança: o treinamento do posto vale para todas as pessoas dele, sem recadastrar por pessoa.',
   '"obrigatório para 3 pessoas" no posto de Esfola.',
   'Achar que precisa marcar o treinamento pessoa a pessoa — não precisa, a herança é automática.',
   'compliance',40,1,'publicado'),
  ('ehs.treino_posto.tipo','/dashboard/ehs/matriz/treinamento-posto','Treinamentos por Posto','Treinamento do catálogo',
   'Escolha o treinamento (do catálogo de NRs) que é obrigatório neste posto. A tela mostra a NR, a carga horária e a periodicidade de reciclagem.',
   'Liga o treinamento certo ao posto; a NR e a carga horária vêm do catálogo para não errar a exigência.',
   'Na Desossa, escolher "NR-12 — Máquinas e equipamentos" por causa das serras e facas.',
   'Escolher um treinamento que não corresponde ao risco do posto. Confira a NR e a carga horária.',
   'compliance',50,1,'publicado'),
  ('ehs.treino_posto.obrigatorio','/dashboard/ehs/matriz/treinamento-posto','Treinamentos por Posto','Obrigatoriedade',
   'Marque se o treinamento é Obrigatório (exigido pela NR) ou Recomendado.',
   'Define a cobrança: obrigatório entra como pendência quando a pessoa não tem o treinamento válido; recomendado é orientação.',
   'NR-36 = Obrigatório em frigorífico; um reforço de boas práticas = Recomendado.',
   'Marcar tudo como recomendado. O obrigatório é o que gera a pendência de treinamento.',
   'compliance',60,1,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo, o_que_preencher=EXCLUDED.o_que_preencher,
  para_que_serve=EXCLUDED.para_que_serve, exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();

-- 4) SEED DE DEMONSTRAÇÃO — SÓ na DEMO b0700000 (fictício; coerente com os riscos da S1.1 e os EPIs da S1.2).
-- NR-36 (frigorífico) + NR-06 (uso de EPI) em TODOS os postos; NR-12 (máquinas/facas) nos postos de corte/
-- máquina (obrigatório), e recomendado na Embalagem a vácuo (seladora semiautomática) — demonstra o toggle.
-- Join por (setor, número do posto) + nr_codigo; UNIQUE(posto_id,tipo_id) + ON CONFLICT deixam idempotente.
INSERT INTO public.prod_posto_treinamento (company_id, posto_id, tipo_id, obrigatorio)
SELECT 'b0700000-0000-4000-a000-000000000005', po.id, t.id, m.obrig
FROM public.prod_posto po
JOIN public.prod_setor s ON s.id = po.setor_id
JOIN (VALUES
  ('Abate','01','NR-36', true),  ('Abate','01','NR-06', true),  ('Abate','01','NR-12', true),
  ('Abate','02','NR-36', true),  ('Abate','02','NR-06', true),
  ('Abate','03','NR-36', true),  ('Abate','03','NR-06', true),  ('Abate','03','NR-12', true),
  ('Abate','04','NR-36', true),  ('Abate','04','NR-06', true),  ('Abate','04','NR-12', true),
  ('Abate','05','NR-36', true),  ('Abate','05','NR-06', true),
  ('Abate','06','NR-36', true),  ('Abate','06','NR-06', true),
  ('Desossa','01','NR-36', true),('Desossa','01','NR-06', true),('Desossa','01','NR-12', true),
  ('Desossa','02','NR-36', true),('Desossa','02','NR-06', true),('Desossa','02','NR-12', true),
  ('Desossa','03','NR-36', true),('Desossa','03','NR-06', true),('Desossa','03','NR-12', true),
  ('Desossa','04','NR-36', true),('Desossa','04','NR-06', true),('Desossa','04','NR-12', false),
  ('Desossa','05','NR-36', true),('Desossa','05','NR-06', true)
) AS m(setor_nome, num, nr, obrig) ON lower(s.nome) = lower(m.setor_nome) AND po.numero = m.num
JOIN public.nr_treinamento_tipo t ON t.company_id = 'b0700000-0000-4000-a000-000000000005' AND t.nr_codigo = m.nr AND t.ativo
WHERE po.company_id = 'b0700000-0000-4000-a000-000000000005'
ON CONFLICT (posto_id, tipo_id) DO NOTHING;
