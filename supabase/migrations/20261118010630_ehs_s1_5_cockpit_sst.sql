-- PS EHS · Onda S1.5 — COCKPIT SST (visão consolidada da cadeia S1.1->S1.4)
--
-- Camada de gestão que fecha a onda S1: numa tela, quanto da matriz SST (risco/EPI/treino/herança) está
-- mapeado, onde estão os buracos e como está a cobertura da empresa inteira. NÃO é a "Matriz de Conformidade"
-- (/dashboard/ehs/matriz, foco em documentos) — é a camada matriz. Gate #5114: nasce ehs_modulo='completo'.
--
-- NADA de seed/DML aqui (só VIEWs + catálogo da tela). As VIEWs são security_invoker=true (RLS por empresa).

-- 1.1) VIEW resumo — 1 linha por empresa (KPIs do topo)
CREATE OR REPLACE VIEW public.v_ehs_cockpit_resumo
WITH (security_invoker = true) AS
SELECT c.id AS company_id,
  (SELECT count(*) FROM public.prod_setor s WHERE s.company_id=c.id AND s.ativo) AS n_setores,
  (SELECT count(*) FROM public.prod_posto p WHERE p.company_id=c.id AND p.ativo) AS n_postos,
  (SELECT count(*) FROM public.prod_posto_pessoa pp WHERE pp.company_id=c.id
     AND (pp.vigencia_fim IS NULL OR pp.vigencia_fim>=CURRENT_DATE)) AS n_pessoas,
  (SELECT count(DISTINCT s.id) FROM public.prod_setor s WHERE s.company_id=c.id AND s.ativo
     AND EXISTS(SELECT 1 FROM public.prod_setor_risco r WHERE r.company_id=c.id AND r.setor_id=s.id)) AS setores_com_risco,
  (SELECT count(DISTINCT p.id) FROM public.prod_posto p WHERE p.company_id=c.id AND p.ativo
     AND EXISTS(SELECT 1 FROM public.prod_posto_epi e WHERE e.company_id=c.id AND e.posto_id=p.id)) AS postos_com_epi,
  (SELECT count(DISTINCT p.id) FROM public.prod_posto p WHERE p.company_id=c.id AND p.ativo
     AND EXISTS(SELECT 1 FROM public.prod_posto_treinamento t WHERE t.company_id=c.id AND t.posto_id=p.id)) AS postos_com_treino,
  (SELECT count(*) FROM public.v_ehs_heranca_pessoa h WHERE h.company_id=c.id
     AND h.n_riscos>0 AND h.n_epis>0 AND h.n_treinamentos>0) AS pessoas_cobertura_completa,
  (SELECT count(*) FROM public.v_ehs_heranca_pessoa h WHERE h.company_id=c.id
     AND NOT (h.n_riscos>0 AND h.n_epis>0 AND h.n_treinamentos>0)) AS pessoas_com_gap,
  (SELECT count(*) FROM public.prod_posto_epi e JOIN public.epi_catalogo ec ON ec.id=e.catalogo_id
     WHERE e.company_id=c.id AND ec.ca_validade IS NOT NULL AND ec.ca_validade < CURRENT_DATE) AS epis_ca_vencido,
  (SELECT count(*) FROM public.prod_posto_epi e JOIN public.epi_catalogo ec ON ec.id=e.catalogo_id
     WHERE e.company_id=c.id AND ec.ca_validade IS NOT NULL
       AND ec.ca_validade BETWEEN CURRENT_DATE AND CURRENT_DATE + 30) AS epis_ca_vencendo_30d
FROM public.companies c;

-- 1.2) VIEW setor — 1 linha por setor (semáforo de cobertura)
CREATE OR REPLACE VIEW public.v_ehs_cockpit_setor
WITH (security_invoker = true) AS
SELECT x.*,
  CASE WHEN x.n_riscos=0 AND x.postos_com_epi=0 AND x.postos_com_treino=0 THEN 'vazia'
       WHEN x.n_riscos>0 AND x.n_postos>0 AND x.postos_com_epi=x.n_postos AND x.postos_com_treino=x.n_postos THEN 'completa'
       ELSE 'parcial' END AS cobertura
FROM (
  SELECT s.company_id, s.id AS setor_id, s.nome AS setor_nome,
    (SELECT count(*) FROM public.prod_posto p WHERE p.company_id=s.company_id AND p.setor_id=s.id AND p.ativo) AS n_postos,
    (SELECT count(*) FROM public.prod_posto_pessoa pp JOIN public.prod_posto p ON p.id=pp.posto_id
       WHERE pp.company_id=s.company_id AND p.setor_id=s.id AND (pp.vigencia_fim IS NULL OR pp.vigencia_fim>=CURRENT_DATE)) AS n_pessoas,
    (SELECT count(*) FROM public.prod_setor_risco r WHERE r.company_id=s.company_id AND r.setor_id=s.id) AS n_riscos,
    (SELECT count(DISTINCT p.id) FROM public.prod_posto p WHERE p.company_id=s.company_id AND p.setor_id=s.id AND p.ativo
       AND EXISTS(SELECT 1 FROM public.prod_posto_epi e WHERE e.company_id=s.company_id AND e.posto_id=p.id)) AS postos_com_epi,
    (SELECT count(DISTINCT p.id) FROM public.prod_posto p WHERE p.company_id=s.company_id AND p.setor_id=s.id AND p.ativo
       AND EXISTS(SELECT 1 FROM public.prod_posto_treinamento t WHERE t.company_id=s.company_id AND t.posto_id=p.id)) AS postos_com_treino
  FROM public.prod_setor s WHERE s.ativo
) x;

REVOKE ALL ON public.v_ehs_cockpit_resumo FROM anon;   GRANT SELECT ON public.v_ehs_cockpit_resumo TO authenticated;
REVOKE ALL ON public.v_ehs_cockpit_setor  FROM anon;   GRANT SELECT ON public.v_ehs_cockpit_setor  TO authenticated;

-- 2) Menu + tela (NASCE ehs_modulo='completo'; ordem 20 = porta de entrada da área, antes da Matriz de Risco=21)
INSERT INTO public.module_catalog
  (id, nome, rota, ativo, grupo, icone, ordem, subgrupo, descricao, is_shared, so_ps, legacy, so_demo, diferencial, rbac_isento, dependencies, surface_in_groups, ehs_modulo)
VALUES
  ('ehs_cockpit', 'Cockpit SST', '/dashboard/ehs/cockpit', true, 'compliance', 'LayoutDashboard', 20,
   'incidentes_riscos', 'Cockpit SST: quanto da matriz (risco/EPI/treino/herança) está mapeado, onde estão os buracos e a cobertura por setor.',
   true, false, false, false, false, false, ARRAY[]::text[], ARRAY[]::text[], 'completo')
ON CONFLICT (id) DO UPDATE SET ehs_modulo = EXCLUDED.ehs_modulo, rota = EXCLUDED.rota, ativo = EXCLUDED.ativo;

INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, auditavel_robo, estado_real, prioridade_monitoramento, auditada_ok)
VALUES
  ('dashboard.ehs_cockpit', '/dashboard/ehs/cockpit', 'compliance', 'Cockpit SST',
   'Visão consolidada da matriz SST: cobertura (risco/EPI/treino), herança por pessoa e semáforo por setor. Piloto DEMO.',
   true, 'desconhecida', 'alta', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, prioridade, descricao_executiva, descricao_tecnica)
VALUES ('F.ehs.cockpit', 'ehs_cockpit', 'compliance', 'Cockpit SST', 'pronto', 100, 'alta',
        'Visão de gestão da matriz SST: cobertura, herança e semáforo por setor, com atalhos para cada matriz.', 'v_ehs_cockpit_resumo + v_ehs_cockpit_setor (security_invoker)')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.screen_route_features (screen_id, feature_id, peso)
VALUES ('dashboard.ehs_cockpit', 'F.ehs.cockpit', 1)
ON CONFLICT DO NOTHING;

-- 3) Ajuda de campo (RD-95)
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.cockpit.empresa','/dashboard/ehs/cockpit','Cockpit SST','Empresa',
   'Quando você cuida de mais de uma empresa, escolha aqui qual quer ver no cockpit.',
   'Filtra os indicadores e o semáforo de setores da empresa escolhida.',
   'Selecionar a empresa antes de ler a cobertura da matriz SST.',
   'Ler a cobertura achando que é de uma empresa e ser de outra.',
   'compliance',10,1,'publicado'),
  ('ehs.cockpit.busca','/dashboard/ehs/cockpit','Cockpit SST','Buscar setor',
   'Digite parte do nome do setor para filtrar o semáforo.',
   'Ajuda a achar rápido um setor quando a empresa tem muitos.',
   '"abate" para ver só o setor de Abate.',
   'Esperar que a busca procure por pessoa ou posto: aqui ela filtra setores.',
   'compliance',20,1,'publicado'),
  ('ehs.cockpit.cobertura','/dashboard/ehs/cockpit','Cockpit SST','Cobertura da matriz',
   'Mostra quanto da matriz está mapeado: setores com risco, postos com EPI e postos com treinamento.',
   'É o termômetro do mapeamento SST — quanto mais alto, menos buraco na matriz.',
   '"setores com risco 3/4" quer dizer que falta mapear o risco de 1 setor.',
   'Achar que 100% de postos com EPI já cobre tudo: risco e treinamento também contam.',
   'compliance',30,1,'publicado'),
  ('ehs.cockpit.heranca','/dashboard/ehs/cockpit','Cockpit SST','Herança (pessoas)',
   'Mostra quantas pessoas têm cobertura completa (herdam risco + EPI + treinamento) e quantas têm gap.',
   'Aponta onde a herança está incompleta — a pessoa está num posto/setor sem algum dos três.',
   '"5 completas, 3 com gap": as 3 estão num setor/posto que ainda não tem risco, EPI ou treino.',
   'Confundir pessoa com gap com erro de cadastro: o gap é da matriz do posto/setor, não da pessoa.',
   'compliance',40,1,'publicado'),
  ('ehs.cockpit.alertas','/dashboard/ehs/cockpit','Cockpit SST','Alertas de EPI (CA)',
   'Mostra os EPIs usados nos postos cujo Certificado de Aprovação (CA) está vencido ou vence em 30 dias.',
   'Antecipa a troca do EPI/renovação do CA antes de virar não conformidade.',
   '"2 vencidos, 1 vencendo": troque o CA vencido e programe o que vence.',
   'Ignorar o "vencendo em 30 dias" e deixar virar vencido.',
   'compliance',50,1,'publicado'),
  ('ehs.cockpit.semaforo','/dashboard/ehs/cockpit','Cockpit SST','Semáforo por setor',
   'Mostra, por setor, se a cobertura está completa (verde), parcial (amarelo) ou vazia (vermelho), com os números e o atalho para cada matriz.',
   'É o mapa de onde agir primeiro: setor vermelho/amarelo é onde falta mapear.',
   'Setor "parcial" com risco mas sem EPI: clique para abrir EPIs por Posto e completar.',
   'Olhar só o total e perder o setor específico que está vermelho.',
   'compliance',60,1,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo, o_que_preencher=EXCLUDED.o_que_preencher,
  para_que_serve=EXCLUDED.para_que_serve, exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();
