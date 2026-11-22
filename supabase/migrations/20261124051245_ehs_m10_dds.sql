-- PS EHS · EHS-7 / M10 — Campo digital: DDS (Diálogo Diário de Segurança)
--
-- Requisito do blueprint vivo (vertical 'ehs', M10 · onda E3/E7): "DDS: Tema, conteúdo, presença digital".
-- O líder registra o DDS do dia (tema, conteúdo, setor, duração) e marca a PRESENÇA de quem participou
-- (presença digital, sem papel). Esta fatia é independente da fatia 1 (#5692, modelos de inspeção) e não
-- toca nenhuma estrutura existente.
--
-- Company-scoped (RLS por empresa via get_user_company_ids(), igual a compliance_* e à fatia 1). ADITIVA:
-- 2 tabelas novas, RLS ligada, REVOKE anon, menu/tela 'completo' (gate #5114 — só DEMO/contratante vê),
-- ajuda (RD-95) e SEED FICTÍCIO só na DEMO EHS (b0700000-...-000b). Nada de dado de cliente real.

-- 1) Tabelas ─────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ehs_dds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  data          date NOT NULL DEFAULT CURRENT_DATE,
  tema          text NOT NULL,
  conteudo      text,
  setor         text,
  responsavel   text,
  duracao_min   integer NOT NULL DEFAULT 10 CHECK (duracao_min BETWEEN 1 AND 480),
  observacoes   text,
  ativo         boolean NOT NULL DEFAULT true,
  criado_por    uuid DEFAULT auth.uid(),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ehs_dds_presenca (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  dds_id           uuid NOT NULL REFERENCES public.ehs_dds(id) ON DELETE CASCADE,
  participante_nome text NOT NULL,
  funcao           text,
  presente         boolean NOT NULL DEFAULT true,
  registrado_em    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ehs_dds_empresa      ON public.ehs_dds (company_id, ativo, data DESC);
CREATE INDEX IF NOT EXISTS idx_ehs_dds_pres_dds     ON public.ehs_dds_presenca (dds_id);
CREATE INDEX IF NOT EXISTS idx_ehs_dds_pres_empresa ON public.ehs_dds_presenca (company_id);

-- 2) RLS por empresa (mesmo padrão das tabelas compliance_* / fatia 1: get_user_company_ids()) ──────────
ALTER TABLE public.ehs_dds          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ehs_dds_presenca ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ehs_dds_select ON public.ehs_dds;
DROP POLICY IF EXISTS ehs_dds_insert ON public.ehs_dds;
DROP POLICY IF EXISTS ehs_dds_update ON public.ehs_dds;
DROP POLICY IF EXISTS ehs_dds_delete ON public.ehs_dds;
CREATE POLICY ehs_dds_select ON public.ehs_dds FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_dds_insert ON public.ehs_dds FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_dds_update ON public.ehs_dds FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_dds_delete ON public.ehs_dds FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

DROP POLICY IF EXISTS ehs_dds_pres_select ON public.ehs_dds_presenca;
DROP POLICY IF EXISTS ehs_dds_pres_insert ON public.ehs_dds_presenca;
DROP POLICY IF EXISTS ehs_dds_pres_update ON public.ehs_dds_presenca;
DROP POLICY IF EXISTS ehs_dds_pres_delete ON public.ehs_dds_presenca;
CREATE POLICY ehs_dds_pres_select ON public.ehs_dds_presenca FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_dds_pres_insert ON public.ehs_dds_presenca FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_dds_pres_update ON public.ehs_dds_presenca FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_dds_pres_delete ON public.ehs_dds_presenca FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

REVOKE ALL ON public.ehs_dds          FROM anon;
REVOKE ALL ON public.ehs_dds_presenca FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ehs_dds          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ehs_dds_presenca TO authenticated;
GRANT ALL ON public.ehs_dds          TO service_role;
GRANT ALL ON public.ehs_dds_presenca TO service_role;

-- 3) Menu + tela (NASCE ehs_modulo='completo' — gate #5114; NULL vazaria p/ todos) ────────────────────
INSERT INTO public.module_catalog
  (id, nome, rota, ativo, grupo, icone, ordem, subgrupo, descricao, is_shared, so_ps, legacy, so_demo, diferencial, rbac_isento, dependencies, surface_in_groups, ehs_modulo)
VALUES
  ('ehs_dds', 'DDS (Diálogo de Segurança)', '/dashboard/ehs/dds', true, 'compliance', 'MessagesSquare', 23,
   'incidentes_riscos',
   'Registre o Diálogo Diário de Segurança (tema, conteúdo, duração) e a presença digital de quem participou.',
   true, false, false, false, false, false, ARRAY[]::text[], ARRAY[]::text[], 'completo')
ON CONFLICT (id) DO UPDATE SET ehs_modulo = EXCLUDED.ehs_modulo, rota = EXCLUDED.rota, ativo = EXCLUDED.ativo, nome = EXCLUDED.nome, descricao = EXCLUDED.descricao;

INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, auditavel_robo, estado_real, prioridade_monitoramento, auditada_ok)
VALUES
  ('dashboard.ehs_dds', '/dashboard/ehs/dds', 'compliance', 'DDS (Diálogo de Segurança)',
   'Registro de DDS (Diálogo Diário de Segurança): tema, conteúdo, duração e presença digital dos participantes, por empresa (M10). Piloto DEMO EHS.',
   true, 'desconhecida', 'alta', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, prioridade, descricao_executiva, descricao_tecnica)
VALUES ('F.ehs.dds', 'ehs_dds', 'compliance', 'DDS (Diálogo de Segurança)', 'pronto', 100, 'alta',
        'DDS com tema, conteúdo, duração e presença digital de quem participou.', 'ehs_dds + ehs_dds_presenca (RLS por empresa)')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.screen_route_features (screen_id, feature_id, peso)
VALUES ('dashboard.ehs_dds', 'F.ehs.dds', 1)
ON CONFLICT DO NOTHING;

-- 4) Ajuda de campo (RD-95) — uma chave por campo/coluna/ação da tela ─────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.dds.empresa','/dashboard/ehs/dds','DDS','Empresa',
   'Quando você cuida de mais de uma empresa, escolha aqui em qual vai registrar o DDS.',
   'Define em qual empresa o DDS é salvo e filtra a lista ao lado.',
   'Escolher a empresa certa antes de registrar o diálogo do dia.',
   'Registrar o DDS achando que está numa empresa e estar em outra.',
   'compliance',10,1,'publicado'),
  ('ehs.dds.busca','/dashboard/ehs/dds','DDS','Buscar',
   'Digite parte do tema ou do setor para filtrar a lista de DDS.',
   'Ajuda a achar rápido um diálogo quando há muitos registros.',
   '"altura" para achar o DDS sobre trabalho em altura.',
   'Esperar que a busca procure pelo nome do participante: ela filtra por tema e setor.',
   'compliance',20,1,'publicado'),
  ('ehs.dds.novo','/dashboard/ehs/dds','DDS','Novo DDS',
   'Registra um Diálogo Diário de Segurança novo para a empresa escolhida.',
   'Guarda o tema tratado e serve de base para marcar quem participou.',
   'Registrar o DDS de abertura do turno sobre uso do protetor auricular.',
   'Criar um DDS duplicado do mesmo dia em vez de editar o que já existe.',
   'compliance',30,1,'publicado'),
  ('ehs.dds.data','/dashboard/ehs/dds','DDS','Data',
   'Informe o dia em que o DDS foi realizado.',
   'Organiza os diálogos na linha do tempo e comprova a periodicidade (ex.: diário).',
   'A data de hoje, no início do turno.',
   'Deixar uma data futura ou de outro dia por engano.',
   'compliance',40,1,'publicado'),
  ('ehs.dds.tema','/dashboard/ehs/dds','DDS','Tema',
   'Escreva, em poucas palavras, o assunto de segurança tratado no diálogo.',
   'É o título do DDS na lista e o que identifica o diálogo depois.',
   '"Uso correto do protetor auricular"; "Atenção no trânsito de empilhadeiras".',
   'Tema genérico como "segurança" que não diz do que se falou.',
   'compliance',50,1,'publicado'),
  ('ehs.dds.conteudo','/dashboard/ehs/dds','DDS','Conteúdo',
   'Descreva os principais pontos abordados no diálogo com a equipe.',
   'Fica como registro do que foi orientado, útil em auditoria e investigação.',
   '"Reforçado o uso do protetor em toda a área de serras; mostrado como higienizar".',
   'Deixar em branco — sem conteúdo o DDS não comprova o que foi tratado.',
   'compliance',60,1,'publicado'),
  ('ehs.dds.setor','/dashboard/ehs/dds','DDS','Setor',
   'Opcional: informe o setor ou a equipe que participou do diálogo.',
   'Permite acompanhar a cobertura de DDS por setor.',
   '"Abate"; "Expedição"; "Manutenção".',
   'Misturar vários setores num só DDS quando cada um teve o seu.',
   'compliance',70,1,'publicado'),
  ('ehs.dds.responsavel','/dashboard/ehs/dds','DDS','Responsável',
   'Opcional: quem conduziu o diálogo (líder, encarregado, técnico de segurança).',
   'Registra quem ministrou o DDS, para referência e auditoria.',
   '"João, encarregado da linha"; "Técnico de SST".',
   'Confundir o responsável (quem conduziu) com os participantes (quem assistiu).',
   'compliance',80,1,'publicado'),
  ('ehs.dds.duracao_min','/dashboard/ehs/dds','DDS','Duração (min)',
   'Informe quantos minutos durou o diálogo.',
   'Comprova a dedicação de tempo ao tema e ajuda no indicador de horas de segurança.',
   '10 minutos para um DDS de abertura de turno.',
   'Colocar um número irreal (ex.: 0 ou várias horas) sem motivo.',
   'compliance',90,1,'publicado'),
  ('ehs.dds.observacoes','/dashboard/ehs/dds','DDS','Observações',
   'Opcional: anote algo relevante, como uma dúvida levantada ou um encaminhamento.',
   'Guarda pontos extras do diálogo que não cabem no conteúdo principal.',
   '"Equipe pediu mais protetores tipo concha — solicitado ao almoxarifado".',
   'Usar as observações como conteúdo principal e deixar o campo Conteúdo vazio.',
   'compliance',100,1,'publicado'),
  ('ehs.dds.presenca','/dashboard/ehs/dds','DDS','Presença',
   'Marque quem participou do diálogo, acrescentando o nome de cada participante.',
   'É a presença digital do DDS — comprova quem recebeu a orientação, sem papel.',
   'Adicionar os 8 operadores do turno que assistiram ao diálogo.',
   'Registrar o DDS sem marcar ninguém — fica sem comprovação de participação.',
   'compliance',110,1,'publicado'),
  ('ehs.dds.pres_nome','/dashboard/ehs/dds','DDS','Nome do participante',
   'Escreva o nome de quem participou do diálogo.',
   'Cada nome entra na lista de presença digital daquele DDS.',
   '"Maria Souza"; "José da Silva".',
   'Abreviar demais ("J.S.") a ponto de não dar para identificar depois.',
   'compliance',120,1,'publicado'),
  ('ehs.dds.pres_funcao','/dashboard/ehs/dds','DDS','Função do participante',
   'Opcional: a função ou o cargo do participante.',
   'Ajuda a identificar a pessoa e a ver que o DDS alcançou as funções certas.',
   '"Operador de serra"; "Auxiliar de expedição".',
   'Preencher com o setor em vez da função.',
   'compliance',130,1,'publicado'),
  ('ehs.dds.col_data','/dashboard/ehs/dds','DDS','Coluna Data',
   'Mostra o dia em que cada DDS foi realizado.',
   'Ordena os diálogos do mais recente para o mais antigo.',
   '"20/11/2026".',
   'Confundir a data do DDS com a data em que foi digitado.',
   'compliance',140,1,'publicado'),
  ('ehs.dds.col_tema','/dashboard/ehs/dds','DDS','Coluna Tema',
   'Mostra o tema de cada DDS.',
   'Identifica rapidamente o assunto de cada diálogo na lista.',
   '"Uso do protetor auricular".',
   'Ler o tema achando que é o conteúdo completo — abra o DDS para ver tudo.',
   'compliance',150,1,'publicado'),
  ('ehs.dds.col_setor','/dashboard/ehs/dds','DDS','Coluna Setor',
   'Mostra o setor/equipe de cada DDS (quando informado).',
   'Ajuda a ver a cobertura de diálogos por setor.',
   '"Abate".',
   'Achar que um DDS sem setor não vale — o setor é opcional.',
   'compliance',160,1,'publicado'),
  ('ehs.dds.col_presenca','/dashboard/ehs/dds','DDS','Coluna Presença',
   'Mostra quantos participantes foram registrados no DDS.',
   'Dá uma ideia do alcance do diálogo antes de abri-lo.',
   '"8 presentes".',
   'Achar que um DDS com 0 presentes está completo.',
   'compliance',170,1,'publicado'),
  ('ehs.dds.col_acoes','/dashboard/ehs/dds','DDS','Coluna Ações',
   'Editar abre o DDS, seu conteúdo e a presença; Desativar tira o DDS das listas sem apagar o histórico.',
   'Mantém o registro vivo sem perder o que já foi feito.',
   'Desativar um DDS lançado por engano, informando o motivo.',
   'Apagar quando o certo é desativar (o histórico some).',
   'compliance',180,1,'publicado'),
  ('ehs.dds.editar','/dashboard/ehs/dds','DDS','Editar',
   'Abre o DDS para mudar tema, conteúdo, setor, duração e a lista de presença.',
   'Deixa o registro sempre correto e completo.',
   'Acrescentar um participante que chegou atrasado ao diálogo.',
   'Criar outro DDS quando era só editar o atual.',
   'compliance',190,1,'publicado'),
  ('ehs.dds.desativar','/dashboard/ehs/dds','DDS','Desativar',
   'Tira o DDS das listas, com um motivo, sem apagar o histórico (exclusão rastreável — RD-98).',
   'Corrige um lançamento errado sem perder o registro.',
   'Desativar um DDS duplicado do mesmo dia, informando "duplicado".',
   'Desativar sem informar o motivo e depois não lembrar por quê.',
   'compliance',200,1,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo, o_que_preencher=EXCLUDED.o_que_preencher,
  para_que_serve=EXCLUDED.para_que_serve, exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();

-- 5) SEED DE DEMONSTRAÇÃO — SÓ na DEMO EHS b0700000-...-000b (fictício; NUNCA cliente real) ────────────
INSERT INTO public.ehs_dds (company_id, data, tema, conteudo, setor, responsavel, duracao_min, observacoes)
SELECT 'b0700000-0000-4000-a000-00000000000b', CURRENT_DATE,
       'Uso correto do protetor auricular',
       'Reforçado o uso do protetor em toda a área de serras. Mostrado como colocar e higienizar. Lembrete sobre a troca quando danificado.',
       'Abate','Técnico de SST',10,'Equipe pediu mais protetores tipo concha — encaminhado ao almoxarifado.'
WHERE NOT EXISTS (SELECT 1 FROM public.ehs_dds d
  WHERE d.company_id='b0700000-0000-4000-a000-00000000000b' AND d.data=CURRENT_DATE AND lower(d.tema)=lower('Uso correto do protetor auricular'));

INSERT INTO public.ehs_dds (company_id, data, tema, conteudo, setor, responsavel, duracao_min, observacoes)
SELECT 'b0700000-0000-4000-a000-00000000000b', CURRENT_DATE - 1,
       'Atenção no trânsito de empilhadeiras',
       'Orientação sobre rotas de pedestres, buzina em cruzamentos e velocidade na expedição. Ninguém atravessa atrás da empilhadeira.',
       'Expedição','Encarregado da Expedição',8,NULL
WHERE NOT EXISTS (SELECT 1 FROM public.ehs_dds d
  WHERE d.company_id='b0700000-0000-4000-a000-00000000000b' AND d.data=CURRENT_DATE - 1 AND lower(d.tema)=lower('Atenção no trânsito de empilhadeiras'));

-- Presença fictícia (idempotente por dds + nome)
INSERT INTO public.ehs_dds_presenca (company_id, dds_id, participante_nome, funcao, presente)
SELECT 'b0700000-0000-4000-a000-00000000000b', d.id, v.nome, v.funcao, true
FROM public.ehs_dds d
JOIN (VALUES
  ('Maria Souza','Operadora de serra'),
  ('José da Silva','Operador de serra'),
  ('Ana Pereira','Auxiliar de produção')
) AS v(nome, funcao) ON true
WHERE d.company_id='b0700000-0000-4000-a000-00000000000b' AND d.data=CURRENT_DATE AND lower(d.tema)=lower('Uso correto do protetor auricular')
  AND NOT EXISTS (SELECT 1 FROM public.ehs_dds_presenca p WHERE p.dds_id=d.id AND p.participante_nome=v.nome);

INSERT INTO public.ehs_dds_presenca (company_id, dds_id, participante_nome, funcao, presente)
SELECT 'b0700000-0000-4000-a000-00000000000b', d.id, v.nome, v.funcao, true
FROM public.ehs_dds d
JOIN (VALUES
  ('Carlos Lima','Operador de empilhadeira'),
  ('Rita Gomes','Auxiliar de expedição')
) AS v(nome, funcao) ON true
WHERE d.company_id='b0700000-0000-4000-a000-00000000000b' AND d.data=CURRENT_DATE - 1 AND lower(d.tema)=lower('Atenção no trânsito de empilhadeiras')
  AND NOT EXISTS (SELECT 1 FROM public.ehs_dds_presenca p WHERE p.dds_id=d.id AND p.participante_nome=v.nome);
