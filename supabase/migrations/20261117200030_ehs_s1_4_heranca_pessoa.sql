-- PS EHS · Onda S1.4 — HERANÇA POR PESSOA (VIEW + tela) + RE-SEED das 3 matrizes DEMO
--
-- Arquitetura SETOR -> POSTO -> PESSOA: a pessoa (prod_posto_pessoa) herda o risco do setor + o EPI e o
-- treinamento do posto, sem recadastrar. A S1.4 materializa essa herança numa VIEW e numa tela, no gate #5114
-- (ehs_modulo='completo' = só a DEMO vê).
--
-- Durabilidade da DEMO: a causa real da vitrine vazia (provado no dado 15/11) é que o fn_demo_reset da DEMO 005
-- apaga/reconstrói prod_* e NÃO re-semeava as matrizes EHS (seeds de migration são one-shot). Isso já foi
-- consertado de forma DURÁVEL na migration 20261117180030 (fn_demo_seed_ehs_matrizes chamada no fn_demo_reset).
-- A PARTE 1 abaixo é o re-seed verbatim (idempotente) pedido no SPEC — serve de populate imediato no deploy e
-- de rede de segurança; a durabilidade entre resets vem do hook do fn_demo_reset.

-- ====================================================================================================
-- PARTE 1 — RE-SEED das 3 matrizes DEMO (verbatim das S1.1/S1.2/S1.3; idempotente; SÓ b0700000...005)
-- ====================================================================================================

-- S1.1 · setores sem posto (Expedição/Administrativo) + riscos por setor
INSERT INTO public.prod_setor (company_id, plant_id, nome, ordem, ativo)
SELECT 'b0700000-0000-4000-a000-000000000005','49a0d5ae-c5f8-4969-a40e-46f800f1a2a1', v.nome, v.ordem, true
FROM (VALUES ('Expedição',30),('Administrativo',40)) AS v(nome, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.prod_setor ps
  WHERE ps.company_id='b0700000-0000-4000-a000-000000000005' AND lower(ps.nome)=lower(v.nome));

INSERT INTO public.prod_setor_risco (company_id, setor_id, tipo, descricao, grau)
SELECT 'b0700000-0000-4000-a000-000000000005', ps.id, r.tipo, r.descricao, r.grau
FROM (VALUES
  ('Abate','fisico','Ruído contínuo das serras acima de 85 dB(A)','alto'),
  ('Abate','fisico','Frio e umidade na área de abate','medio'),
  ('Abate','acidente','Corte com faca e serra na linha','alto'),
  ('Desossa','ergonomico','Movimento repetitivo e postura forçada na desossa','alto'),
  ('Desossa','fisico','Frio na sala de desossa','medio'),
  ('Desossa','acidente','Corte com faca na desossa','alto'),
  ('Expedição','fisico','Frio na câmara de expedição','medio'),
  ('Expedição','acidente','Movimentação de cargas e trânsito de empilhadeira','medio'),
  ('Administrativo','ergonomico','Postura sentada prolongada em frente ao computador','leve')
) AS r(setor_nome, tipo, descricao, grau)
JOIN public.prod_setor ps
  ON ps.company_id='b0700000-0000-4000-a000-000000000005' AND lower(ps.nome)=lower(r.setor_nome) AND ps.ativo
WHERE NOT EXISTS (
  SELECT 1 FROM public.prod_setor_risco sr
  WHERE sr.company_id='b0700000-0000-4000-a000-000000000005' AND sr.setor_id=ps.id AND sr.descricao=r.descricao);

-- S1.2 · EPIs por posto (todos os postos do setor; idempotente por UNIQUE(posto_id,catalogo_id))
INSERT INTO public.prod_posto_epi (company_id, posto_id, catalogo_id, obrigatorio, observacao)
SELECT 'b0700000-0000-4000-a000-000000000005', po.id, ec.id, true, NULL
FROM public.prod_posto po
JOIN public.prod_setor s ON s.id = po.setor_id
JOIN (VALUES
  ('Abate','Protetor auricular tipo plug'),
  ('Abate','Japona térmica para câmara'),
  ('Abate','Luva de malha de aço'),
  ('Desossa','Luva de malha de aço'),
  ('Desossa','Japona térmica para câmara'),
  ('Desossa','Avental impermeável')
) AS m(setor_nome, epi_nome) ON lower(s.nome) = lower(m.setor_nome)
JOIN public.epi_catalogo ec ON ec.company_id = 'b0700000-0000-4000-a000-000000000005' AND lower(ec.nome) = lower(m.epi_nome)
WHERE po.company_id = 'b0700000-0000-4000-a000-000000000005'
ON CONFLICT (posto_id, catalogo_id) DO NOTHING;

-- S1.3 · treinamentos por posto (idempotente por UNIQUE(posto_id,tipo_id))
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

-- ====================================================================================================
-- PARTE 2 — S1.4 HERANÇA POR PESSOA
-- ====================================================================================================

-- 2.1) VIEW multi-tenant segura. security_invoker=true é INEGOCIÁVEL (PILAR 2 LGPD): respeita a RLS por
--      empresa das tabelas base. Nome do funcionário vem da tabela de RH real (compliance_funcionarios, FK
--      prod_posto_pessoa.funcionario_id); no demo o funcionario_id é nulo (só CPF), então funcionario_nome
--      fica NULL e a tela cai no CPF.
CREATE OR REPLACE VIEW public.v_ehs_heranca_pessoa
WITH (security_invoker = true) AS
SELECT
  pp.company_id, pp.id AS vinculo_id, pp.funcionario_id, pp.cpf,
  cf.nome_completo AS funcionario_nome,
  pp.vigencia_inicio, pp.vigencia_fim,
  po.id AS posto_id, po.numero AS posto_numero, po.atividade AS posto_atividade,
  s.id AS setor_id, s.nome AS setor_nome,
  (SELECT count(*) FROM public.prod_setor_risco r WHERE r.company_id=pp.company_id AND r.setor_id=po.setor_id) AS n_riscos,
  (SELECT jsonb_agg(jsonb_build_object('tipo',r.tipo,'descricao',r.descricao,'grau',r.grau) ORDER BY r.tipo)
     FROM public.prod_setor_risco r WHERE r.company_id=pp.company_id AND r.setor_id=po.setor_id) AS riscos,
  (SELECT count(*) FROM public.prod_posto_epi e WHERE e.company_id=pp.company_id AND e.posto_id=po.id) AS n_epis,
  (SELECT jsonb_agg(jsonb_build_object('nome',c.nome,'ca',c.ca_numero,'obrigatorio',e.obrigatorio) ORDER BY c.nome)
     FROM public.prod_posto_epi e JOIN public.epi_catalogo c ON c.id=e.catalogo_id
     WHERE e.company_id=pp.company_id AND e.posto_id=po.id) AS epis,
  (SELECT count(*) FROM public.prod_posto_treinamento tp WHERE tp.company_id=pp.company_id AND tp.posto_id=po.id) AS n_treinamentos,
  (SELECT jsonb_agg(jsonb_build_object('nr',t.nr_codigo,'nome',t.nome,'obrigatorio',tp.obrigatorio,'reciclagem_meses',t.reciclagem_meses) ORDER BY t.nr_codigo)
     FROM public.prod_posto_treinamento tp JOIN public.nr_treinamento_tipo t ON t.id=tp.tipo_id
     WHERE tp.company_id=pp.company_id AND tp.posto_id=po.id) AS treinamentos
FROM public.prod_posto_pessoa pp
JOIN public.prod_posto po ON po.id = pp.posto_id
JOIN public.prod_setor s  ON s.id = po.setor_id
LEFT JOIN public.compliance_funcionarios cf ON cf.id = pp.funcionario_id AND cf.company_id = pp.company_id
WHERE (pp.vigencia_inicio IS NULL OR pp.vigencia_inicio <= CURRENT_DATE)
  AND (pp.vigencia_fim   IS NULL OR pp.vigencia_fim   >= CURRENT_DATE);

REVOKE ALL ON public.v_ehs_heranca_pessoa FROM anon;
GRANT SELECT ON public.v_ehs_heranca_pessoa TO authenticated;

-- 2.2) Menu + tela (NASCE ehs_modulo='completo' — obrigatório; NULL vazaria p/ todos)
INSERT INTO public.module_catalog
  (id, nome, rota, ativo, grupo, icone, ordem, subgrupo, descricao, is_shared, so_ps, legacy, so_demo, diferencial, rbac_isento, dependencies, surface_in_groups, ehs_modulo)
VALUES
  ('ehs_heranca_pessoa', 'Herança por Pessoa', '/dashboard/ehs/matriz/heranca-pessoa', true, 'compliance', 'UserCheck', 24,
   'incidentes_riscos', 'Herança por pessoa: cada pessoa herda os riscos do setor + os EPIs e treinamentos do posto, sem recadastro.',
   true, false, false, false, false, false, ARRAY[]::text[], ARRAY[]::text[], 'completo')
ON CONFLICT (id) DO UPDATE SET ehs_modulo = EXCLUDED.ehs_modulo, rota = EXCLUDED.rota, ativo = EXCLUDED.ativo;

INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, auditavel_robo, estado_real, prioridade_monitoramento, auditada_ok)
VALUES
  ('dashboard.ehs_heranca_pessoa', '/dashboard/ehs/matriz/heranca-pessoa', 'compliance', 'Herança por Pessoa',
   'Herança por pessoa (SETOR->POSTO->PESSOA): riscos do setor + EPIs e treinamentos do posto, sem recadastro. Piloto DEMO.',
   true, 'desconhecida', 'alta', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, prioridade, descricao_executiva, descricao_tecnica)
VALUES ('F.ehs.heranca_pessoa', 'ehs_heranca_pessoa', 'compliance', 'Herança por Pessoa', 'pronto', 100, 'alta',
        'Prova da herança: cada pessoa herda riscos, EPIs e treinamentos sem recadastro.', 'v_ehs_heranca_pessoa (security_invoker); prod_posto_pessoa -> posto -> setor')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.screen_route_features (screen_id, feature_id, peso)
VALUES ('dashboard.ehs_heranca_pessoa', 'F.ehs.heranca_pessoa', 1)
ON CONFLICT DO NOTHING;

-- 2.3) Ajuda de campo (RD-95)
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.heranca_pessoa.empresa','/dashboard/ehs/matriz/heranca-pessoa','Herança por Pessoa','Empresa',
   'Quando você cuida de mais de uma empresa, escolha aqui qual quer ver.',
   'Filtra as pessoas e a herança (riscos/EPIs/treinamentos) da empresa escolhida.',
   'Selecionar a empresa certa antes de conferir a herança das pessoas.',
   'Conferir a herança achando que está numa empresa e estar em outra.',
   'compliance',10,1,'publicado'),
  ('ehs.heranca_pessoa.busca','/dashboard/ehs/matriz/heranca-pessoa','Herança por Pessoa','Buscar',
   'Digite parte do nome, do CPF ou do posto da pessoa para filtrar a lista.',
   'Ajuda a achar rápido uma pessoa quando a empresa tem muitas.',
   '"desossa" para as pessoas da Desossa; parte do CPF; o número do posto.',
   'Esperar que a busca procure por risco ou EPI: ela procura pela pessoa/posto.',
   'compliance',20,1,'publicado'),
  ('ehs.heranca_pessoa.setor','/dashboard/ehs/matriz/heranca-pessoa','Herança por Pessoa','Setor',
   'Escolha um setor para ver só as pessoas dele.',
   'Organiza a conferência da herança setor por setor.',
   'Filtrar por "Abate" para ver as pessoas dos postos de abate.',
   'Deixar o filtro ligado e achar que faltam pessoas — elas estão em outro setor.',
   'compliance',30,1,'publicado'),
  ('ehs.heranca_pessoa.heranca','/dashboard/ehs/matriz/heranca-pessoa','Herança por Pessoa','Herança (riscos · EPIs · treinamentos)',
   'Mostra o que a pessoa herda automaticamente: os riscos do setor + os EPIs e treinamentos do posto dela.',
   'É a prova da herança: você cadastra no setor/posto uma vez e todas as pessoas herdam, sem recadastrar pessoa a pessoa.',
   'Uma pessoa do posto de Esfola herda 3 riscos, 3 EPIs e 3 treinamentos sem você digitar nada por ela.',
   'Achar que precisa cadastrar risco/EPI/treinamento por pessoa — não precisa, a herança é automática.',
   'compliance',40,1,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo, o_que_preencher=EXCLUDED.o_que_preencher,
  para_que_serve=EXCLUDED.para_que_serve, exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();
