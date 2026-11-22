-- PS EHS · EHS-7 / M12 — Incidentes e investigação (fatia 1: registro + classificação + testemunhas)
--
-- Requisitos do blueprint vivo (vertical 'ehs', M12 · onda E7):
--   • "Registro: Local no mapa, fotos, testemunhas"              -> esta fatia entrega LOCAL (texto) + TESTEMUNHAS (parcial; mapa/fotos nas próximas)
--   • "Classificação: Gravidade, tipo, parte do corpo, agente"   -> esta fatia entrega COMPLETA (atendido)
-- Próximas fatias (independentes desta): Causa raiz (5 porquês / espinha de peixe), Plano de ação 5W2H
-- (reusando erp_plano_acao — RD-71), CAT S-2210, Custo do acidente no financeiro, Alerta entre unidades.
--
-- Company-scoped (RLS por empresa via get_user_company_ids(), igual a compliance_* e às fatias #5692/#5706).
-- ADITIVA: 2 tabelas novas, RLS ligada, REVOKE anon, menu/tela 'completo' (gate #5114 — só DEMO/contratante vê),
-- ajuda (RD-95) e SEED FICTÍCIO só na DEMO EHS (b0700000-...-000b). Não toca nenhuma estrutura existente.
-- Nenhum dado de cliente real.

-- 1) Tabelas ─────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ehs_incidente (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  ocorrido_em     timestamptz NOT NULL DEFAULT now(),
  titulo          text NOT NULL,
  descricao       text,
  local_texto     text,
  setor           text,
  -- Classificação (requisito "Classificação: Gravidade, tipo, parte do corpo, agente")
  tipo            text NOT NULL DEFAULT 'quase_acidente'
                    CHECK (tipo IN ('quase_acidente','tipico','trajeto','doenca_ocupacional','ambiental','material')),
  gravidade       text NOT NULL DEFAULT 'sem_lesao'
                    CHECK (gravidade IN ('sem_lesao','leve','moderada','grave','fatal')),
  parte_corpo     text,
  agente_causador text,
  com_lesao       boolean NOT NULL DEFAULT false,
  com_afastamento boolean NOT NULL DEFAULT false,
  dias_afastamento integer NOT NULL DEFAULT 0 CHECK (dias_afastamento BETWEEN 0 AND 3650),
  vitima_nome     text,
  status          text NOT NULL DEFAULT 'registrado'
                    CHECK (status IN ('registrado','em_investigacao','concluido')),
  ativo           boolean NOT NULL DEFAULT true,
  criado_por      uuid DEFAULT auth.uid(),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ehs_incidente_testemunha (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  incidente_id  uuid NOT NULL REFERENCES public.ehs_incidente(id) ON DELETE CASCADE,
  nome          text NOT NULL,
  funcao        text,
  relato        text,
  registrado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ehs_incidente_empresa   ON public.ehs_incidente (company_id, ativo, ocorrido_em DESC);
CREATE INDEX IF NOT EXISTS idx_ehs_incidente_status    ON public.ehs_incidente (company_id, status);
CREATE INDEX IF NOT EXISTS idx_ehs_inc_test_incidente  ON public.ehs_incidente_testemunha (incidente_id);
CREATE INDEX IF NOT EXISTS idx_ehs_inc_test_empresa    ON public.ehs_incidente_testemunha (company_id);

-- 2) RLS por empresa (mesmo padrão de compliance_* / #5692 / #5706: get_user_company_ids()) ─────────────
ALTER TABLE public.ehs_incidente            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ehs_incidente_testemunha ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ehs_incidente_select ON public.ehs_incidente;
DROP POLICY IF EXISTS ehs_incidente_insert ON public.ehs_incidente;
DROP POLICY IF EXISTS ehs_incidente_update ON public.ehs_incidente;
DROP POLICY IF EXISTS ehs_incidente_delete ON public.ehs_incidente;
CREATE POLICY ehs_incidente_select ON public.ehs_incidente FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_incidente_insert ON public.ehs_incidente FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_incidente_update ON public.ehs_incidente FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_incidente_delete ON public.ehs_incidente FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

DROP POLICY IF EXISTS ehs_inc_test_select ON public.ehs_incidente_testemunha;
DROP POLICY IF EXISTS ehs_inc_test_insert ON public.ehs_incidente_testemunha;
DROP POLICY IF EXISTS ehs_inc_test_update ON public.ehs_incidente_testemunha;
DROP POLICY IF EXISTS ehs_inc_test_delete ON public.ehs_incidente_testemunha;
CREATE POLICY ehs_inc_test_select ON public.ehs_incidente_testemunha FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_inc_test_insert ON public.ehs_incidente_testemunha FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_inc_test_update ON public.ehs_incidente_testemunha FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_inc_test_delete ON public.ehs_incidente_testemunha FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

REVOKE ALL ON public.ehs_incidente            FROM anon;
REVOKE ALL ON public.ehs_incidente_testemunha FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ehs_incidente            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ehs_incidente_testemunha TO authenticated;
GRANT ALL ON public.ehs_incidente            TO service_role;
GRANT ALL ON public.ehs_incidente_testemunha TO service_role;

-- 3) Menu + tela (NASCE ehs_modulo='completo' — gate #5114; NULL vazaria p/ todos) ────────────────────
INSERT INTO public.module_catalog
  (id, nome, rota, ativo, grupo, icone, ordem, subgrupo, descricao, is_shared, so_ps, legacy, so_demo, diferencial, rbac_isento, dependencies, surface_in_groups, ehs_modulo)
VALUES
  ('ehs_incidentes', 'Incidentes e investigação', '/dashboard/ehs/incidentes', true, 'compliance', 'AlertTriangle', 24,
   'incidentes_riscos',
   'Registre incidentes, acidentes e quase-acidentes com classificação (gravidade, tipo, parte do corpo, agente) e testemunhas.',
   true, false, false, false, false, false, ARRAY[]::text[], ARRAY[]::text[], 'completo')
ON CONFLICT (id) DO UPDATE SET ehs_modulo = EXCLUDED.ehs_modulo, rota = EXCLUDED.rota, ativo = EXCLUDED.ativo, nome = EXCLUDED.nome, descricao = EXCLUDED.descricao;

INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, auditavel_robo, estado_real, prioridade_monitoramento, auditada_ok)
VALUES
  ('dashboard.ehs_incidentes', '/dashboard/ehs/incidentes', 'compliance', 'Incidentes e investigação',
   'Registro de incidentes/acidentes/quase-acidentes: data/hora, local, descrição, classificação (gravidade, tipo, parte do corpo, agente) e testemunhas, por empresa (M12). Piloto DEMO EHS.',
   true, 'desconhecida', 'alta', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, prioridade, descricao_executiva, descricao_tecnica)
VALUES ('F.ehs.incidentes', 'ehs_incidentes', 'compliance', 'Incidentes e investigação', 'pronto', 100, 'alta',
        'Registro e classificação de incidentes com testemunhas.', 'ehs_incidente + ehs_incidente_testemunha (RLS por empresa)')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.screen_route_features (screen_id, feature_id, peso)
VALUES ('dashboard.ehs_incidentes', 'F.ehs.incidentes', 1)
ON CONFLICT DO NOTHING;

-- 4) Ajuda de campo (RD-95) — uma chave por campo/coluna/ação da tela ─────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.inc.empresa','/dashboard/ehs/incidentes','Incidentes','Empresa',
   'Quando você cuida de mais de uma empresa, escolha aqui em qual vai registrar o incidente.',
   'Define em qual empresa o incidente é salvo e filtra a lista ao lado.',
   'Escolher a empresa onde o acidente aconteceu antes de registrar.',
   'Registrar o incidente achando que está numa empresa e estar em outra.',
   'compliance',10,1,'publicado'),
  ('ehs.inc.busca','/dashboard/ehs/incidentes','Incidentes','Buscar',
   'Digite parte do título, do setor ou do agente para filtrar a lista.',
   'Ajuda a achar rápido um registro quando há muitos incidentes.',
   '"empilhadeira" para achar o incidente na expedição.',
   'Esperar que a busca procure pela vítima: ela filtra por título, setor e agente.',
   'compliance',20,1,'publicado'),
  ('ehs.inc.filtro_status','/dashboard/ehs/incidentes','Incidentes','Filtro de situação',
   'Filtre a lista pela situação do incidente: registrado, em investigação ou concluído.',
   'Permite focar no que ainda precisa ser investigado.',
   'Escolher "em investigação" para ver só o que está em análise.',
   'Achar que não há incidentes quando o filtro está escondendo os concluídos.',
   'compliance',30,1,'publicado'),
  ('ehs.inc.novo','/dashboard/ehs/incidentes','Incidentes','Novo incidente',
   'Registra um incidente, acidente ou quase-acidente novo para a empresa escolhida.',
   'Abre o registro para classificar o evento e anotar as testemunhas.',
   'Registrar um quase-acidente com empilhadeira logo após o ocorrido.',
   'Deixar para registrar dias depois e perder detalhes importantes.',
   'compliance',40,1,'publicado'),
  ('ehs.inc.ocorrido_em','/dashboard/ehs/incidentes','Incidentes','Data e hora',
   'Informe quando o incidente aconteceu (data e hora).',
   'Organiza os eventos na linha do tempo e é base para prazos legais (ex.: CAT).',
   'A data e a hora reais do ocorrido, não a de agora.',
   'Deixar a hora atual quando o evento foi em outro momento.',
   'compliance',50,1,'publicado'),
  ('ehs.inc.titulo','/dashboard/ehs/incidentes','Incidentes','Título',
   'Resuma em poucas palavras o que aconteceu.',
   'É o título do incidente na lista e o que o identifica depois.',
   '"Corte na mão ao manusear faca de desossa".',
   'Título vago como "acidente" que não diz o que houve.',
   'compliance',60,1,'publicado'),
  ('ehs.inc.descricao','/dashboard/ehs/incidentes','Incidentes','Descrição',
   'Descreva como o incidente aconteceu, o que a pessoa estava fazendo e o que deu errado.',
   'É o relato base para a investigação e a análise de causa raiz depois.',
   '"O operador escorregou no piso molhado perto da câmara fria e torceu o tornozelo."',
   'Descrever só a lesão, sem dizer como o evento aconteceu.',
   'compliance',70,1,'publicado'),
  ('ehs.inc.local_texto','/dashboard/ehs/incidentes','Incidentes','Local',
   'Informe o local onde ocorreu (área, máquina, ponto da planta).',
   'Ajuda a localizar o risco e a cruzar eventos no mesmo lugar.',
   '"Corredor da câmara fria 2"; "Serra fita da sala de cortes".',
   'Deixar em branco — sem local fica difícil agir sobre a causa.',
   'compliance',80,1,'publicado'),
  ('ehs.inc.setor','/dashboard/ehs/incidentes','Incidentes','Setor',
   'Opcional: o setor ou a equipe envolvida no incidente.',
   'Permite acompanhar a estatística de incidentes por setor.',
   '"Abate"; "Expedição"; "Manutenção".',
   'Confundir o setor com o local físico exato.',
   'compliance',90,1,'publicado'),
  ('ehs.inc.tipo','/dashboard/ehs/incidentes','Incidentes','Tipo',
   'Classifique o evento: quase-acidente, acidente típico, de trajeto, doença ocupacional, ambiental ou material.',
   'Separa o que exige CAT e o que entra nas estatísticas de segurança.',
   '"Quase-acidente" quando não houve lesão, mas poderia ter havido.',
   'Marcar como típico um evento de trajeto (casa-trabalho) — a regra é diferente.',
   'compliance',100,1,'publicado'),
  ('ehs.inc.gravidade','/dashboard/ehs/incidentes','Incidentes','Gravidade',
   'Informe a gravidade: sem lesão, leve, moderada, grave ou fatal.',
   'É a base dos indicadores de segurança e da priorização da investigação.',
   '"Leve" para um corte superficial sem afastamento.',
   'Subestimar a gravidade para não abrir investigação.',
   'compliance',110,1,'publicado'),
  ('ehs.inc.parte_corpo','/dashboard/ehs/incidentes','Incidentes','Parte do corpo',
   'Opcional: a parte do corpo atingida, quando houve lesão.',
   'Alimenta a estatística de lesões e ajuda a direcionar a prevenção (EPI, proteção).',
   '"Mão direita"; "Tornozelo esquerdo".',
   'Preencher a parte do corpo num evento sem lesão.',
   'compliance',120,1,'publicado'),
  ('ehs.inc.agente_causador','/dashboard/ehs/incidentes','Incidentes','Agente causador',
   'Opcional: o que causou o incidente (máquina, ferramenta, piso, produto químico).',
   'Agrupa incidentes pelo mesmo agente para atacar a causa de uma vez.',
   '"Piso molhado"; "Faca de desossa"; "Empilhadeira".',
   'Descrever a lesão no lugar do agente que a causou.',
   'compliance',130,1,'publicado'),
  ('ehs.inc.com_lesao','/dashboard/ehs/incidentes','Incidentes','Houve lesão?',
   'Marque se o incidente resultou em lesão em alguém.',
   'Separa acidentes com lesão (que podem exigir CAT) dos quase-acidentes.',
   'Marcar "sim" num corte na mão; "não" num quase-acidente.',
   'Marcar lesão e deixar a gravidade como "sem lesão" (incoerente).',
   'compliance',140,1,'publicado'),
  ('ehs.inc.com_afastamento','/dashboard/ehs/incidentes','Incidentes','Houve afastamento?',
   'Marque se a pessoa precisou se afastar do trabalho por causa do incidente.',
   'Base da taxa de gravidade (dias perdidos) e de obrigações legais.',
   'Marcar "sim" quando houve atestado com dias de afastamento.',
   'Marcar afastamento e deixar os dias em zero.',
   'compliance',150,1,'publicado'),
  ('ehs.inc.dias_afastamento','/dashboard/ehs/incidentes','Incidentes','Dias de afastamento',
   'Informe quantos dias a pessoa ficou afastada (0 se não houve).',
   'Entra no cálculo da taxa de gravidade dos acidentes.',
   '15 dias conforme o atestado médico.',
   'Informar dias de afastamento sem marcar "houve afastamento".',
   'compliance',160,1,'publicado'),
  ('ehs.inc.vitima_nome','/dashboard/ehs/incidentes','Incidentes','Vítima',
   'Opcional: o nome de quem se envolveu/acidentou (quando houver).',
   'Permite acompanhar o caso e preencher a CAT numa próxima etapa.',
   '"João da Silva" quando o acidente teve uma vítima identificada.',
   'Registrar o nome de uma testemunha como se fosse a vítima.',
   'compliance',170,1,'publicado'),
  ('ehs.inc.status','/dashboard/ehs/incidentes','Incidentes','Situação',
   'A situação do incidente: registrado, em investigação ou concluído.',
   'Mostra o andamento e evita que um evento fique sem tratamento.',
   'Passar para "em investigação" assim que começar a análise de causa.',
   'Marcar como concluído sem ter investigado a causa.',
   'compliance',180,1,'publicado'),
  ('ehs.inc.testemunhas','/dashboard/ehs/incidentes','Incidentes','Testemunhas',
   'Acrescente quem presenciou o incidente, com nome e, se quiser, o relato de cada um.',
   'As testemunhas sustentam a investigação e a análise de causa raiz.',
   'Adicionar os dois colegas que viram o colega escorregar.',
   'Registrar o incidente sem nenhuma testemunha quando havia pessoas por perto.',
   'compliance',190,1,'publicado'),
  ('ehs.inc.test_nome','/dashboard/ehs/incidentes','Incidentes','Nome da testemunha',
   'Escreva o nome de quem presenciou o incidente.',
   'Identifica quem pode relatar o que viu.',
   '"Maria Souza".',
   'Abreviar a ponto de não dar para identificar a pessoa depois.',
   'compliance',200,1,'publicado'),
  ('ehs.inc.test_funcao','/dashboard/ehs/incidentes','Incidentes','Função da testemunha',
   'Opcional: a função ou o cargo da testemunha.',
   'Ajuda a entender o ponto de vista de quem relatou.',
   '"Operador de serra"; "Encarregado".',
   'Preencher com o setor em vez da função.',
   'compliance',210,1,'publicado'),
  ('ehs.inc.test_relato','/dashboard/ehs/incidentes','Incidentes','Relato da testemunha',
   'Opcional: o que a testemunha viu, com as palavras dela.',
   'Guarda a versão de cada testemunha para a investigação.',
   '"Vi o colega escorregar no piso molhado perto da câmara".',
   'Resumir demais e perder o que a pessoa realmente viu.',
   'compliance',220,1,'publicado'),
  ('ehs.inc.col_data','/dashboard/ehs/incidentes','Incidentes','Coluna Data/Hora',
   'Mostra quando cada incidente ocorreu.',
   'Ordena os eventos do mais recente para o mais antigo.',
   '"20/11/2026 14:30".',
   'Confundir a data do ocorrido com a data em que foi digitado.',
   'compliance',230,1,'publicado'),
  ('ehs.inc.col_titulo','/dashboard/ehs/incidentes','Incidentes','Coluna Título',
   'Mostra o título e a classificação resumida de cada incidente.',
   'Identifica rapidamente o evento e sua gravidade na lista.',
   '"Corte na mão — leve".',
   'Ler só o título achando que é o relato completo — abra o incidente.',
   'compliance',240,1,'publicado'),
  ('ehs.inc.col_classificacao','/dashboard/ehs/incidentes','Incidentes','Coluna Classificação',
   'Mostra o tipo e a gravidade de cada incidente.',
   'Permite enxergar o perfil dos eventos sem abrir cada um.',
   '"Típico · grave".',
   'Ignorar a gravidade na hora de priorizar a investigação.',
   'compliance',250,1,'publicado'),
  ('ehs.inc.col_setor','/dashboard/ehs/incidentes','Incidentes','Coluna Setor',
   'Mostra o setor de cada incidente (quando informado).',
   'Ajuda a ver onde os eventos se concentram.',
   '"Abate".',
   'Achar que um incidente sem setor não vale — o setor é opcional.',
   'compliance',260,1,'publicado'),
  ('ehs.inc.col_situacao','/dashboard/ehs/incidentes','Incidentes','Coluna Situação',
   'Mostra se o incidente está registrado, em investigação ou concluído.',
   'Deixa claro o que ainda precisa de tratamento.',
   '"Em investigação".',
   'Deixar eventos graves parados em "registrado".',
   'compliance',270,1,'publicado'),
  ('ehs.inc.col_acoes','/dashboard/ehs/incidentes','Incidentes','Coluna Ações',
   'Editar abre o incidente, sua classificação e as testemunhas; Desativar tira o registro das listas sem apagar o histórico.',
   'Mantém o registro vivo sem perder o que já foi feito.',
   'Desativar um incidente lançado em duplicidade, informando o motivo.',
   'Apagar quando o certo é desativar (o histórico some).',
   'compliance',280,1,'publicado'),
  ('ehs.inc.editar','/dashboard/ehs/incidentes','Incidentes','Editar',
   'Abre o incidente para mudar a descrição, a classificação, a situação e as testemunhas.',
   'Deixa o registro sempre correto e completo para a investigação.',
   'Mudar a situação para "em investigação" e acrescentar uma testemunha.',
   'Criar outro incidente quando era só editar o atual.',
   'compliance',290,1,'publicado'),
  ('ehs.inc.desativar','/dashboard/ehs/incidentes','Incidentes','Desativar',
   'Tira o incidente das listas, com um motivo, sem apagar o histórico (exclusão rastreável — RD-98).',
   'Corrige um lançamento errado sem perder o registro.',
   'Desativar um incidente duplicado, informando "duplicado".',
   'Desativar sem informar o motivo e depois não lembrar por quê.',
   'compliance',300,1,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo, o_que_preencher=EXCLUDED.o_que_preencher,
  para_que_serve=EXCLUDED.para_que_serve, exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();

-- 5) Blueprint vivo — refletir o que esta fatia atende (RD-38: só o que realmente entregou) ─────────────
UPDATE public.blueprint_tela_requisito SET status_baseline='atendido'
 WHERE vertical='ehs' AND tela_num=12 AND requisito LIKE 'Classificação: Gravidade, tipo, parte do corpo, agente%';
UPDATE public.blueprint_tela_requisito SET status_baseline='parcial'
 WHERE vertical='ehs' AND tela_num=12 AND requisito LIKE 'Registro: Local no mapa, fotos, testemunhas%';

-- 6) SEED DE DEMONSTRAÇÃO — SÓ na DEMO EHS b0700000-...-000b (fictício; NUNCA cliente real) ────────────
INSERT INTO public.ehs_incidente (company_id, ocorrido_em, titulo, descricao, local_texto, setor, tipo, gravidade, parte_corpo, agente_causador, com_lesao, com_afastamento, dias_afastamento, vitima_nome, status)
SELECT 'b0700000-0000-4000-a000-00000000000b', now() - interval '2 days',
       'Corte na mão ao manusear faca de desossa',
       'Durante o corte, a faca escapou e atingiu a mão esquerda do operador. Encaminhado ao ambulatório.',
       'Sala de cortes — bancada 3','Abate','tipico','leve','Mão esquerda','Faca de desossa',
       true, false, 0, 'José da Silva', 'em_investigacao'
WHERE NOT EXISTS (SELECT 1 FROM public.ehs_incidente i
  WHERE i.company_id='b0700000-0000-4000-a000-00000000000b' AND lower(i.titulo)=lower('Corte na mão ao manusear faca de desossa'));

INSERT INTO public.ehs_incidente (company_id, ocorrido_em, titulo, descricao, local_texto, setor, tipo, gravidade, parte_corpo, agente_causador, com_lesao, com_afastamento, dias_afastamento, vitima_nome, status)
SELECT 'b0700000-0000-4000-a000-00000000000b', now() - interval '1 day',
       'Quase-acidente com empilhadeira na expedição',
       'Pedestre atravessou atrás da empilhadeira em manobra. O operador freou a tempo; ninguém se feriu.',
       'Doca de expedição','Expedição','quase_acidente','sem_lesao',NULL,'Empilhadeira',
       false, false, 0, NULL, 'registrado'
WHERE NOT EXISTS (SELECT 1 FROM public.ehs_incidente i
  WHERE i.company_id='b0700000-0000-4000-a000-00000000000b' AND lower(i.titulo)=lower('Quase-acidente com empilhadeira na expedição'));

-- Testemunhas fictícias (idempotente por incidente + nome)
INSERT INTO public.ehs_incidente_testemunha (company_id, incidente_id, nome, funcao, relato)
SELECT 'b0700000-0000-4000-a000-00000000000b', i.id, v.nome, v.funcao, v.relato
FROM public.ehs_incidente i
JOIN (VALUES
  ('Maria Souza','Operadora de serra','Vi a faca escapar quando ele puxou a peça com força.'),
  ('Ana Pereira','Auxiliar de produção','Estava ao lado e chamei o encarregado na hora.')
) AS v(nome, funcao, relato) ON true
WHERE i.company_id='b0700000-0000-4000-a000-00000000000b' AND lower(i.titulo)=lower('Corte na mão ao manusear faca de desossa')
  AND NOT EXISTS (SELECT 1 FROM public.ehs_incidente_testemunha t WHERE t.incidente_id=i.id AND t.nome=v.nome);

INSERT INTO public.ehs_incidente_testemunha (company_id, incidente_id, nome, funcao, relato)
SELECT 'b0700000-0000-4000-a000-00000000000b', i.id, v.nome, v.funcao, v.relato
FROM public.ehs_incidente i
JOIN (VALUES
  ('Carlos Lima','Operador de empilhadeira','Freei assim que vi o colega passar atrás; a buzina estava ligada.')
) AS v(nome, funcao, relato) ON true
WHERE i.company_id='b0700000-0000-4000-a000-00000000000b' AND lower(i.titulo)=lower('Quase-acidente com empilhadeira na expedição')
  AND NOT EXISTS (SELECT 1 FROM public.ehs_incidente_testemunha t WHERE t.incidente_id=i.id AND t.nome=v.nome);
