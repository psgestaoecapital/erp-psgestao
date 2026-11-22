-- PS EHS · os 22 módulos no menu lateral da DEMO, cada um com as suas abas planejadas (CEO 20/11/2026 16:46):
-- "crie os menus laterais, todos os módulos, com todas as abas planejadas dentro do Blueprint, para eu poder
-- acessar e olhar; crie o módulo inicial dentro da demo e audite com o Blueprint."
--
-- O que entra:
-- 1) fn_ehs_plano_modulo(p_modulo): lê o blueprint vivo (blueprint_tela_requisito vertical 'ehs', tela_num = módulo
--    M1–M22) + a última blueprint_tela_cobertura de cada requisito. Sem dado de empresa. Só usuário logado.
-- 2) 22 itens de menu (module_catalog 'ehs_plano_mNN', grupo 'compliance', so_demo = true → só aparecem em empresa
--    DEMO), em 5 seções temáticas, apontando para /dashboard/ehs/modulo?m=N (uma aba por função do módulo).
-- 3) Os itens entram no plano Compliance (plan_modules) e ganham o selo do menu pela situação no blueprint
--    (feature_catalog: 'previsto' sem nada pronto; 'parcial' com algo pronto).
-- 4) A DEMO EHS (…00b) contrata o bucket 'completo' (empresa_ehs_modulo), para ver também as telas novas do S1
--    (cockpit, matrizes, herança) que nascem com ehs_modulo = 'completo'.
-- 5) Tela registrada em system_screens e as 2 chaves do "?" (RD-95).
-- Aditiva e idempotente. Só DEMO. Não toca dado de cliente, RLS ou policies.

-- 1) Leitura do plano (blueprint)
CREATE OR REPLACE FUNCTION public.fn_ehs_plano_modulo(p_modulo integer DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF auth.uid() IS NULL AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'login obrigatório' USING ERRCODE = '42501';
  END IF;
  WITH r AS (
    SELECT b.tela_num AS m, b.tela_nome, b.rota_padrao, b.requisito, b.prioridade,
           coalesce((SELECT c.status FROM public.blueprint_tela_cobertura c
                      WHERE c.requisito_id = b.id ORDER BY c.avaliado_em DESC LIMIT 1), b.status_baseline) AS status
      FROM public.blueprint_tela_requisito b
     WHERE b.vertical = 'ehs' AND b.tela_num BETWEEN 1 AND 22
       AND (p_modulo IS NULL OR b.tela_num = p_modulo)
  )
  SELECT CASE
    WHEN p_modulo IS NULL THEN
      (SELECT coalesce(jsonb_agg(jsonb_build_object('m', s.m, 'nome', s.nome, 'total', s.total, 'atendido', s.at,
                                                    'parcial', s.pa, 'ausente', s.au) ORDER BY s.m), '[]'::jsonb)
         FROM (SELECT m, min(tela_nome) AS nome, count(*) AS total,
                      count(*) FILTER (WHERE status = 'atendido') AS at,
                      count(*) FILTER (WHERE status = 'parcial') AS pa,
                      count(*) FILTER (WHERE status NOT IN ('atendido', 'parcial')) AS au
                 FROM r GROUP BY m) s)
    ELSE
      (SELECT jsonb_build_object('m', p_modulo, 'nome', min(tela_nome), 'rota', min(rota_padrao),
                'funcoes', coalesce(jsonb_agg(jsonb_build_object('requisito', requisito, 'prioridade', prioridade, 'status', status)
                                              ORDER BY (status = 'atendido') DESC, (status = 'parcial') DESC,
                                                       (prioridade = 'essencial') DESC, requisito), '[]'::jsonb))
         FROM r)
  END INTO v;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_ehs_plano_modulo(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ehs_plano_modulo(integer) TO authenticated, service_role;

-- 2) Menu: 22 módulos em 5 seções (só DEMO)
INSERT INTO public.module_subgrupos (id, label, grupo, ordem, ativo, descricao)
VALUES
  ('ehs_estrutura_e_riscos',     'EHS · Estrutura e riscos',      'compliance', 3, true, 'PS EHS V11 · M1 a M5'),
  ('ehs_saude_e_protecao',       'EHS · Saúde e proteção',        'compliance', 4, true, 'PS EHS V11 · M6 a M9'),
  ('ehs_campo_e_operacao',       'EHS · Campo e operação',        'compliance', 5, true, 'PS EHS V11 · M10 a M14'),
  ('ehs_esocial_e_conformidade', 'EHS · eSocial e conformidade',  'compliance', 6, true, 'PS EHS V11 · M15 a M18'),
  ('ehs_gestao_e_inteligencia',  'EHS · Gestão e inteligência',   'compliance', 7, true, 'PS EHS V11 · M19 a M22')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.module_catalog
  (id, nome, grupo, icone, rota, ordem, ativo, descricao, is_shared, legacy, subgrupo, surface_in_groups, so_demo, so_ps, diferencial)
VALUES
  ('ehs_plano_m01', 'M1 · Estrutura e cadastros',        'compliance', 'Building',      '/dashboard/ehs/modulo?m=1',  1, true, 'Plano do módulo M1 (PS EHS V11): empresas, setores/GHE, postos, funções, trabalhadores, máquinas', false, false, 'ehs_estrutura_e_riscos',     ARRAY[]::text[], true, false, false),
  ('ehs_plano_m02', 'M2 · Riscos e PGR',                 'compliance', 'AlertTriangle', '/dashboard/ehs/modulo?m=2',  2, true, 'Plano do módulo M2: inventário de riscos, matriz, plano de ação e PGR (NR-1)', false, false, 'ehs_estrutura_e_riscos',     ARRAY[]::text[], true, false, false),
  ('ehs_plano_m03', 'M3 · Higiene e laudos',             'compliance', 'FlaskConical',  '/dashboard/ehs/modulo?m=3',  3, true, 'Plano do módulo M3: agentes, avaliações, LTCAT, insalubridade, PPP, aposentadoria especial', false, false, 'ehs_estrutura_e_riscos',     ARRAY[]::text[], true, false, false),
  ('ehs_plano_m04', 'M4 · Ergonomia',                    'compliance', 'Accessibility', '/dashboard/ehs/modulo?m=4',  4, true, 'Plano do módulo M4: AEP, AET, ergonomia por vídeo, rodízio e ritmo da linha', false, false, 'ehs_estrutura_e_riscos',     ARRAY[]::text[], true, false, false),
  ('ehs_plano_m05', 'M5 · Fatores psicossociais',        'compliance', 'Brain',         '/dashboard/ehs/modulo?m=5',  5, true, 'Plano do módulo M5: questionário anônimo, riscos psicossociais no PGR, canal de relato', false, false, 'ehs_estrutura_e_riscos',     ARRAY[]::text[], true, false, false),
  ('ehs_plano_m06', 'M6 · Saúde ocupacional',            'compliance', 'HeartPulse',    '/dashboard/ehs/modulo?m=6',  1, true, 'Plano do módulo M6: PCMSO, exames, convocação, ASO, prontuário com sigilo (NR-7)', false, false, 'ehs_saude_e_protecao',       ARRAY[]::text[], true, false, false),
  ('ehs_plano_m07', 'M7 · EPI e proteção coletiva',      'compliance', 'HardHat',       '/dashboard/ehs/modulo?m=7',  2, true, 'Plano do módulo M7: matriz de EPI, CA, ficha e assinatura, estoque, EPC (NR-6)', false, false, 'ehs_saude_e_protecao',       ARRAY[]::text[], true, false, false),
  ('ehs_plano_m08', 'M8 · Treinamentos',                 'compliance', 'GraduationCap', '/dashboard/ehs/modulo?m=8',  3, true, 'Plano do módulo M8: matriz por NR e função, vencimento e bloqueio, turmas, certificados', false, false, 'ehs_saude_e_protecao',       ARRAY[]::text[], true, false, false),
  ('ehs_plano_m09', 'M9 · Pausas, jornada e exposição',  'compliance', 'Timer',         '/dashboard/ehs/modulo?m=9',  4, true, 'Plano do módulo M9: pausas NR-36, pausa térmica, auditoria de batidas, motor de infrações', false, false, 'ehs_saude_e_protecao',       ARRAY[]::text[], true, false, false),
  ('ehs_plano_m10', 'M10 · Campo, inspeções e DDS',      'compliance', 'ClipboardCheck','/dashboard/ehs/modulo?m=10', 1, true, 'Plano do módulo M10: inspeções e checklists, plano de ação, DDS, relatos, rondas', false, false, 'ehs_campo_e_operacao',       ARRAY[]::text[], true, false, false),
  ('ehs_plano_m11', 'M11 · Trabalhos de risco',          'compliance', 'Flame',         '/dashboard/ehs/modulo?m=11', 2, true, 'Plano do módulo M11: permissão de trabalho, bloqueio de energias, APR, aptidão na hora', false, false, 'ehs_campo_e_operacao',       ARRAY[]::text[], true, false, false),
  ('ehs_plano_m12', 'M12 · Incidentes e investigação',   'compliance', 'Siren',         '/dashboard/ehs/modulo?m=12', 3, true, 'Plano do módulo M12: registro, classificação, causa raiz, plano de ação, CAT', false, false, 'ehs_campo_e_operacao',       ARRAY[]::text[], true, false, false),
  ('ehs_plano_m13', 'M13 · Terceiros',                   'compliance', 'Users',         '/dashboard/ehs/modulo?m=13', 4, true, 'Plano do módulo M13: portal da contratada, vencimentos, liberação de acesso, avaliação', false, false, 'ehs_campo_e_operacao',       ARRAY[]::text[], true, false, false),
  ('ehs_plano_m14', 'M14 · Comissões e programas',       'compliance', 'Vote',          '/dashboard/ehs/modulo?m=14', 5, true, 'Plano do módulo M14: CIPA, SESMT, brigada, SIPAT', false, false, 'ehs_campo_e_operacao',       ARRAY[]::text[], true, false, false),
  ('ehs_plano_m15', 'M15 · eSocial SST',                 'compliance', 'Send',          '/dashboard/ehs/modulo?m=15', 1, true, 'Plano do módulo M15: S-2240, S-2220, S-2210, S-2221, validação e envio', false, false, 'ehs_esocial_e_conformidade', ARRAY[]::text[], true, false, false),
  ('ehs_plano_m16', 'M16 · Previdenciário e jurídico',   'compliance', 'Scale',         '/dashboard/ehs/modulo?m=16', 2, true, 'Plano do módulo M16: FAP e RAT, NTEP, pasta de prova, apoio à perícia, passivo', false, false, 'ehs_esocial_e_conformidade', ARRAY[]::text[], true, false, false),
  ('ehs_plano_m17', 'M17 · Conformidade e ISO 45001',    'compliance', 'ShieldCheck',   '/dashboard/ehs/modulo?m=17', 3, true, 'Plano do módulo M17: biblioteca de requisitos, matriz, radar regulatório, auditorias', false, false, 'ehs_esocial_e_conformidade', ARRAY[]::text[], true, false, false),
  ('ehs_plano_m18', 'M18 · Documentos e guarda',         'compliance', 'FolderLock',    '/dashboard/ehs/modulo?m=18', 4, true, 'Plano do módulo M18: GED, modelos próprios, assinatura, selo de integridade, guarda legal', false, false, 'ehs_esocial_e_conformidade', ARRAY[]::text[], true, false, false),
  ('ehs_plano_m19', 'M19 · Indicadores e custo de SST',  'compliance', 'BarChart3',     '/dashboard/ehs/modulo?m=19', 1, true, 'Plano do módulo M19: frequência e gravidade, antecedentes, custo na DRE, painel da diretoria', false, false, 'ehs_gestao_e_inteligencia',  ARRAY[]::text[], true, false, false),
  ('ehs_plano_m20', 'M20 · App do trabalhador',          'compliance', 'Smartphone',    '/dashboard/ehs/modulo?m=20', 2, true, 'Plano do módulo M20: meus dados, ciência e assinaturas, relatar, aprender, WhatsApp', false, false, 'ehs_gestao_e_inteligencia',  ARRAY[]::text[], true, false, false),
  ('ehs_plano_m21', 'M21 · Prestador e cliente',         'compliance', 'Briefcase',     '/dashboard/ehs/modulo?m=21', 3, true, 'Plano do módulo M21: carteira de clientes, OS de campo, contratos e faturamento, portal', false, false, 'ehs_gestao_e_inteligencia',  ARRAY[]::text[], true, false, false),
  ('ehs_plano_m22', 'M22 · Corporativo',                 'compliance', 'Network',       '/dashboard/ehs/modulo?m=22', 4, true, 'Plano do módulo M22: multi-planta, padrões corporativos, aprovações, permissões, API', false, false, 'ehs_gestao_e_inteligencia',  ARRAY[]::text[], true, false, false)
ON CONFLICT (id) DO NOTHING;

-- Ordem das seções do plano no menu do Compliance/EHS (as seções que já existem seguem a ordem atual)
INSERT INTO public.area_secao_ordem (area_slug, secao, ordem, ativo)
SELECT 'compliance', s.secao, s.ordem, true
FROM (VALUES ('EHS_ESTRUTURA_E_RISCOS', 3), ('EHS_SAUDE_E_PROTECAO', 4), ('EHS_CAMPO_E_OPERACAO', 5),
             ('EHS_ESOCIAL_E_CONFORMIDADE', 6), ('EHS_GESTAO_E_INTELIGENCIA', 7)) AS s(secao, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.area_secao_ordem a WHERE a.area_slug = 'compliance' AND a.secao = s.secao);

-- 3) Plano Compliance + selo do menu pela situação no blueprint
INSERT INTO public.plan_modules (id, plan_id, module_id, is_default_active, minimum_sla, legacy)
SELECT gen_random_uuid(), 'v15_compliance', mc.id, true, NULL, false
FROM public.module_catalog mc
WHERE mc.id LIKE 'ehs_plano_m%'
  AND EXISTS (SELECT 1 FROM public.plan_catalog pc WHERE pc.id = 'v15_compliance')
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules pm WHERE pm.plan_id = 'v15_compliance' AND pm.module_id = mc.id);

INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, prioridade, descricao_executiva, descricao_tecnica)
SELECT 'F.ehs.plano_m' || lpad(b.m::text, 2, '0'), 'ehs_plano_m' || lpad(b.m::text, 2, '0'), 'compliance',
       'Plano do módulo M' || b.m,
       CASE WHEN b.pronto > 0 THEN 'parcial' ELSE 'previsto' END,
       CASE WHEN b.total > 0 THEN round(100.0 * b.pronto / b.total)::int ELSE 0 END,
       'alta',
       'Funções planejadas do módulo M' || b.m || ' do PS EHS V11, medidas contra o blueprint vivo.',
       'blueprint_tela_requisito vertical ehs tela_num ' || b.m || ' via fn_ehs_plano_modulo'
FROM (SELECT tela_num AS m, count(*) AS total, count(*) FILTER (WHERE status_baseline IN ('atendido', 'parcial')) AS pronto
        FROM public.blueprint_tela_requisito WHERE vertical = 'ehs' AND tela_num BETWEEN 1 AND 22 GROUP BY tela_num) b
ON CONFLICT (id) DO NOTHING;

-- 4) A DEMO EHS vê também as telas do S1 (bucket 'completo'); só a DEMO
INSERT INTO public.empresa_ehs_modulo (company_id, modulo)
SELECT c.id, 'completo'
FROM public.companies c
WHERE c.id = 'b0700000-0000-4000-a000-00000000000b' AND c.is_demo = true
  AND NOT EXISTS (SELECT 1 FROM public.empresa_ehs_modulo e WHERE e.company_id = c.id AND e.modulo = 'completo');

-- 5) Tela e "?" (RD-95)
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, modulo, estado_real, prioridade_monitoramento, auditavel_robo, motivo_nao_auditavel)
VALUES ('S.ehs.plano_modulo', '/dashboard/ehs/modulo', 'compliance', 'PS EHS · Plano completo do módulo',
        'Vitrine do blueprint: os 22 módulos do PS EHS, uma aba por função planejada, com a situação de cada uma (pronto, parcial, planejado) e o atalho para a tela real.',
        'ehs_plano_m01', 'pronto', 'media', false,
        'Tela de plano (mostra o blueprint, só em empresa DEMO); a auditoria de produto é feita nas telas reais de cada módulo.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('ehs.modulo.situacao', '/dashboard/ehs/modulo', 'PS EHS · Plano do módulo', 'Situação das funções',
   'Nada a preencher: é a contagem das funções do módulo pela situação medida no blueprint.',
   'Mostra quanto do módulo já está no sistema: Pronto (funciona e foi auditado), Parcial (existe em parte) e Planejado (ainda vai ser construído).',
   'M7 · EPI: 7 funções · 1 pronta · 3 parciais · 3 planejadas.',
   'Achar que "Planejado" é erro: é uma função que ainda vai entrar, na onda indicada na aba.',
   'compliance', 1, 'publicado'),
  ('ehs.modulo.onda', '/dashboard/ehs/modulo', 'PS EHS · Plano do módulo', 'Onda de construção',
   'Nada a preencher: é a etapa do plano em que a função é construída.',
   'Indica a ordem de entrega (E0 a E9 do plano aprovado do PS EHS). Cada onda é provada na DEMO e homologada antes da seguinte.',
   'Onda E2 = Riscos e PGR; onda E6 = EPI e treinamentos premium.',
   'Confundir a onda com prazo em dias: a onda é a ordem, não uma data.',
   'compliance', 2, 'publicado')
ON CONFLICT (chave) DO NOTHING;
