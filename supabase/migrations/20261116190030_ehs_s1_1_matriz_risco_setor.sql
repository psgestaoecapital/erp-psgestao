-- PS EHS · Onda S1.1 — Matriz de Risco por Setor (SPEC Eng. Chefe · piloto DEMO · bucket ehs_completo)
--
-- Cadastrar o risco ocupacional UMA vez no setor → vale para todos os postos/pessoas dele (herança).
-- Tela mãe da Matriz de Risco. Backend prod_setor_risco já existe (RLS por empresa). Esta migration é
-- ADITIVA: índice, menu/tela classificada 'completo' (só a demo vê — gate #5114), ajuda (RD-95) e
-- SEED de dados FICTÍCIOS só na DEMO b0700000 (nunca Frioeste/cliente real). Também corrige o texto do
-- Documento Mestre V11 (piloto DEMO, S1.4 por VIEW), conforme a SPEC.

-- 1) prod_setor_risco: índice de herança + anon fora (RLS/policy por empresa já existem) ─────────────
CREATE INDEX IF NOT EXISTS idx_prod_setor_risco_empresa_setor ON public.prod_setor_risco (company_id, setor_id);
REVOKE ALL ON public.prod_setor_risco FROM anon;

-- 2) Menu + tela (NASCE ehs_modulo='completo' — obrigatório; NULL vazaria p/ todos) ──────────────────
INSERT INTO public.module_catalog
  (id, nome, rota, ativo, grupo, icone, ordem, subgrupo, descricao, is_shared, so_ps, legacy, so_demo, diferencial, rbac_isento, dependencies, surface_in_groups, ehs_modulo)
VALUES
  ('ehs_matriz_risco_setor', 'Matriz de Risco por Setor', '/dashboard/ehs/matriz/risco-setor', true, 'compliance', 'AlertTriangle', 21,
   'incidentes_riscos',
   'Riscos ocupacionais por setor (GRO/PGR). O risco do setor é herdado por todos os postos e pessoas dele.',
   true, false, false, false, false, false, ARRAY[]::text[], ARRAY[]::text[], 'completo')
ON CONFLICT (id) DO UPDATE SET ehs_modulo = EXCLUDED.ehs_modulo, rota = EXCLUDED.rota, ativo = EXCLUDED.ativo;

INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, auditavel_robo, estado_real, prioridade_monitoramento, auditada_ok)
VALUES
  ('dashboard.ehs_matriz_risco_setor', '/dashboard/ehs/matriz/risco-setor', 'compliance', 'Matriz de Risco por Setor',
   'Inventário de riscos ocupacionais por setor (GRO/PGR); base da herança para postos e pessoas. Piloto DEMO.',
   true, 'desconhecida', 'alta', false)
ON CONFLICT (id) DO NOTHING;

-- feature_catalog + link de rota (status do menu)
INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, prioridade, descricao_executiva, descricao_tecnica)
VALUES ('F.ehs.matriz_risco_setor', 'ehs_matriz_risco_setor', 'compliance', 'Matriz de Risco por Setor', 'pronto', 100, 'alta',
        'Cadastro de riscos por setor com herança para postos e pessoas.', 'prod_setor_risco + contagem via prod_posto/prod_posto_pessoa')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.screen_route_features (screen_id, feature_id, peso)
VALUES ('dashboard.ehs_matriz_risco_setor', 'F.ehs.matriz_risco_setor', 1)
ON CONFLICT DO NOTHING;

-- 3) Ajuda de campo (RD-95) ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.risco_setor.empresa','/dashboard/ehs/matriz/risco-setor','Matriz de Risco por Setor','Empresa',
   'Quando você cuida de mais de uma empresa, escolha aqui em qual vai cadastrar os riscos.',
   'A escolha filtra os setores/riscos da tela e define onde o novo risco é salvo.',
   'Selecionar a empresa certa antes de incluir um risco.',
   'Cadastrar um risco achando que está numa empresa e estar em outra.',
   'compliance',10,1,'publicado'),
  ('ehs.risco_setor.busca','/dashboard/ehs/matriz/risco-setor','Matriz de Risco por Setor','Buscar',
   'Digite parte do nome do setor ou do texto do risco para filtrar a lista.',
   'Ajuda a achar rápido um setor ou um risco quando há muitos setores.',
   '"abate" para ver só o Abate; "ruído" para achar onde o ruído está mapeado.',
   'Esperar que a busca procure por tipo de agente: para isso use o filtro de tipo.',
   'compliance',20,1,'publicado'),
  ('ehs.risco_setor.filtro_tipo','/dashboard/ehs/matriz/risco-setor','Matriz de Risco por Setor','Tipo de agente (filtro)',
   'Escolha um tipo de agente para ver só os riscos daquele tipo em todos os setores.',
   'Os riscos se dividem em físico, químico, biológico, ergonômico e de acidente. O filtro revisa um grupo por vez.',
   'Filtrar por "Físico" para conferir ruído, calor, frio e vibração.',
   'Deixar o filtro ligado e achar que um setor está sem riscos — ele só não tem daquele tipo.',
   'compliance',30,1,'publicado'),
  ('ehs.risco_setor.heranca','/dashboard/ehs/matriz/risco-setor','Matriz de Risco por Setor','Herança (postos / pessoas)',
   'Mostra, só pra conferência, quantos postos e quantas pessoas do setor herdam os riscos cadastrados nele.',
   'É a prova da herança: o risco do setor vale para todos os postos e pessoas dele, sem recadastrar.',
   '"herdado por 5 postos / 23 pessoas" no setor Abate.',
   'Achar que precisa repetir o risco posto a posto — não precisa, a herança é automática.',
   'compliance',40,1,'publicado'),
  ('ehs.risco_setor.setor','/dashboard/ehs/matriz/risco-setor','Matriz de Risco por Setor','Setor',
   'Escolha o setor onde este risco existe. O risco vai valer para todos os postos e pessoas desse setor.',
   'É a base da herança: cadastrando no setor, você não repete o risco posto a posto nem pessoa a pessoa.',
   'Selecionar "Desossa" para registrar frio e esforço repetitivo.',
   'Cadastrar no setor errado faz o risco aparecer para as pessoas erradas.',
   'compliance',50,1,'publicado'),
  ('ehs.risco_setor.tipo','/dashboard/ehs/matriz/risco-setor','Matriz de Risco por Setor','Tipo de agente',
   'Classifique o risco em Físico, Químico, Biológico, Ergonômico ou Acidente/Mecânico.',
   'A classificação organiza o inventário do GRO e orienta as medidas do PGR por grupo de agente.',
   'Ruído e frio = Físico; produto de limpeza = Químico; contato com carne = Biológico; esforço repetitivo = Ergonômico; faca = Acidente.',
   'Classificar tudo como "Físico". Separar certo é o que deixa o PGR e os laudos corretos.',
   'compliance',60,1,'publicado'),
  ('ehs.risco_setor.descricao','/dashboard/ehs/matriz/risco-setor','Matriz de Risco por Setor','Descrição do risco',
   'Escreva, em poucas palavras, qual é o risco de verdade naquele setor.',
   'É o texto que aparece no inventário e nos documentos; quanto mais claro, melhor para técnico e auditor.',
   '"Ruído contínuo acima de 85 dB(A) nas serras"; "Frio na câmara"; "Corte com faca na desossa".',
   'Escrever só "ruído" sem contexto. Diga onde e por quê.',
   'compliance',70,1,'publicado'),
  ('ehs.risco_setor.grau','/dashboard/ehs/matriz/risco-setor','Matriz de Risco por Setor','Grau do risco',
   'Escolha o grau do risco: Leve, Médio ou Alto.',
   'O grau orienta a prioridade das ações do PGR e a leitura da matriz de risco.',
   'Ruído alto nas serras = Alto; postura sentada no administrativo = Leve.',
   'Marcar tudo como Alto. O grau perde o sentido se não diferencia.',
   'compliance',80,1,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo, o_que_preencher=EXCLUDED.o_que_preencher,
  para_que_serve=EXCLUDED.para_que_serve, exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();

-- 4) SEED DE DEMONSTRAÇÃO — SÓ na DEMO b0700000 (fictício; NUNCA Frioeste/cliente real) ──────────────
-- setores da demo (Abate/Desossa já existem; acrescenta Expedição/Administrativo, idempotente)
INSERT INTO public.prod_setor (company_id, plant_id, nome, ordem, ativo)
SELECT 'b0700000-0000-4000-a000-000000000005','49a0d5ae-c5f8-4969-a40e-46f800f1a2a1', v.nome, v.ordem, true
FROM (VALUES ('Expedição',30),('Administrativo',40)) AS v(nome, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.prod_setor ps
  WHERE ps.company_id='b0700000-0000-4000-a000-000000000005' AND lower(ps.nome)=lower(v.nome));

-- riscos fictícios por setor (NR-36: frio, ruído, corte, ergonomia), idempotentes por (setor, descrição)
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

-- 5) Correções de texto do Documento Mestre V11 (SPEC §2) — piloto DEMO, S1.4 por VIEW. ───────────────
-- Só o bloco do plano (V11); versão/status/aprovação intactos. replace() é idempotente.
UPDATE public.erp_documento_vertical
   SET conteudo_md = replace(replace(replace(replace(conteudo_md,
       'cada uma validada no piloto Frioeste antes da seguinte',
       'cada uma validada no piloto DEMO (Indústria Modelo) e homologada na SOS antes da seguinte'),
       'EM PRODUÇÃO AGORA (piloto Frioeste · 6 fatias)',
       'EM PRODUÇÃO AGORA (piloto DEMO → homologação SOS · 6 fatias)'),
       'provada no dado real da Frioeste antes da seguinte',
       'provada no dado fictício da DEMO antes da seguinte'),
       '**S1.4 — HERANÇA** (`compliance_exigencia_pessoa`)',
       '**S1.4 — HERANÇA** (VIEW `v_ehs_exigencia_funcionario` + exceção `ehs_exigencia_excecao`)')
 WHERE vertical='compliance' AND versao=11;
