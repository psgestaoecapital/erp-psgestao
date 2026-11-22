-- PS EHS · EHS-7 / M11 — Trabalhos de risco: fatia "APR — Análise Preliminar de Risco por tarefa"
--
-- M11 é o campo dos trabalhos de alto risco. Esta fatia entrega a APR (Análise Preliminar de Risco): antes de
-- começar um serviço, a tarefa é quebrada em ETAPAS e, para cada etapa, levanta-se o PERIGO, o RISCO associado,
-- a MEDIDA DE CONTROLE e a SEVERIDADE. É a análise que sustenta a Permissão de Trabalho (#5717) e o DDS/inspeções.
-- As outras fatias de M11 (Permissão de Trabalho #5717, bloqueio de energias NR-12 / LOTO, gestão de mudanças,
-- aptidão na hora) são independentes desta.
--
-- Company-scoped (RLS por empresa via get_user_company_ids(), igual a compliance_* e ao padrão aprovado #5717).
-- ADITIVA: 2 tabelas novas, RLS ligada, REVOKE anon, menu/tela 'completo' (gate #5114 — só DEMO/contratante vê),
-- ajuda (RD-95) e SEED FICTÍCIO só na DEMO EHS (b0700000-...-000b). Nada de dado de cliente real.

-- 1) Tabelas ─────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ehs_apr (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  numero        text,
  tarefa        text NOT NULL,
  setor         text,
  local         text,
  data_analise  date,
  responsavel   text,
  equipe        text,
  status        text NOT NULL DEFAULT 'rascunho'
                  CHECK (status IN ('rascunho','em_analise','aprovada','revisar','encerrada')),
  observacoes   text,
  ativo         boolean NOT NULL DEFAULT true,
  criado_por    uuid DEFAULT auth.uid(),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ehs_apr_etapa (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  apr_id          uuid NOT NULL REFERENCES public.ehs_apr(id) ON DELETE CASCADE,
  ordem           integer NOT NULL DEFAULT 1,
  etapa           text NOT NULL,
  perigo          text,
  risco           text,
  medida_controle text,
  severidade      text NOT NULL DEFAULT 'media'
                    CHECK (severidade IN ('baixa','media','alta','critica')),
  ativo           boolean NOT NULL DEFAULT true,
  criado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ehs_apr_empresa       ON public.ehs_apr (company_id, ativo);
CREATE INDEX IF NOT EXISTS idx_ehs_apr_status        ON public.ehs_apr (company_id, status);
CREATE INDEX IF NOT EXISTS idx_ehs_apr_etapa_apr     ON public.ehs_apr_etapa (apr_id, ordem);
CREATE INDEX IF NOT EXISTS idx_ehs_apr_etapa_empresa ON public.ehs_apr_etapa (company_id);

-- 2) RLS por empresa (mesmo padrão das tabelas compliance_* / #5717: get_user_company_ids()) ───────────
ALTER TABLE public.ehs_apr       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ehs_apr_etapa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ehs_apr_select ON public.ehs_apr;
DROP POLICY IF EXISTS ehs_apr_insert ON public.ehs_apr;
DROP POLICY IF EXISTS ehs_apr_update ON public.ehs_apr;
DROP POLICY IF EXISTS ehs_apr_delete ON public.ehs_apr;
CREATE POLICY ehs_apr_select ON public.ehs_apr FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_apr_insert ON public.ehs_apr FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_apr_update ON public.ehs_apr FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_apr_delete ON public.ehs_apr FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

DROP POLICY IF EXISTS ehs_apr_etapa_select ON public.ehs_apr_etapa;
DROP POLICY IF EXISTS ehs_apr_etapa_insert ON public.ehs_apr_etapa;
DROP POLICY IF EXISTS ehs_apr_etapa_update ON public.ehs_apr_etapa;
DROP POLICY IF EXISTS ehs_apr_etapa_delete ON public.ehs_apr_etapa;
CREATE POLICY ehs_apr_etapa_select ON public.ehs_apr_etapa FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_apr_etapa_insert ON public.ehs_apr_etapa FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_apr_etapa_update ON public.ehs_apr_etapa FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_apr_etapa_delete ON public.ehs_apr_etapa FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

REVOKE ALL ON public.ehs_apr       FROM anon;
REVOKE ALL ON public.ehs_apr_etapa FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ehs_apr       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ehs_apr_etapa TO authenticated;
GRANT ALL ON public.ehs_apr       TO service_role;
GRANT ALL ON public.ehs_apr_etapa TO service_role;

-- 3) Menu + tela (NASCE ehs_modulo='completo' — gate #5114; NULL vazaria p/ todos) ────────────────────
INSERT INTO public.module_catalog
  (id, nome, rota, ativo, grupo, icone, ordem, subgrupo, descricao, is_shared, so_ps, legacy, so_demo, diferencial, rbac_isento, dependencies, surface_in_groups, ehs_modulo)
VALUES
  ('ehs_apr', 'Análise Preliminar de Risco (APR)', '/dashboard/ehs/trabalhos-risco/apr', true, 'compliance', 'ClipboardList', 24,
   'incidentes_riscos',
   'Antes do serviço, quebre a tarefa em etapas e levante perigo, risco, medida de controle e severidade de cada uma (APR).',
   true, false, false, false, false, false, ARRAY[]::text[], ARRAY[]::text[], 'completo')
ON CONFLICT (id) DO UPDATE SET ehs_modulo = EXCLUDED.ehs_modulo, rota = EXCLUDED.rota, ativo = EXCLUDED.ativo, nome = EXCLUDED.nome, descricao = EXCLUDED.descricao;

INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, auditavel_robo, estado_real, prioridade_monitoramento, auditada_ok)
VALUES
  ('dashboard.ehs_apr', '/dashboard/ehs/trabalhos-risco/apr', 'compliance', 'Análise Preliminar de Risco (APR)',
   'Análise Preliminar de Risco por tarefa: etapas do serviço com perigo, risco, medida de controle e severidade por empresa (M11). Piloto DEMO EHS.',
   true, 'desconhecida', 'alta', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, prioridade, descricao_executiva, descricao_tecnica)
VALUES ('F.ehs.apr', 'ehs_apr', 'compliance', 'Análise Preliminar de Risco (APR)', 'pronto', 100, 'alta',
        'APR por tarefa: etapas do serviço com perigo, risco, medida de controle e severidade.', 'ehs_apr + ehs_apr_etapa (RLS por empresa)')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.screen_route_features (screen_id, feature_id, peso)
VALUES ('dashboard.ehs_apr', 'F.ehs.apr', 1)
ON CONFLICT DO NOTHING;

-- 4) Ajuda de campo (RD-95) — uma chave por campo/coluna/ação da tela, 1:1 com a page ─────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.apr.empresa','/dashboard/ehs/trabalhos-risco/apr','APR','Empresa',
   'Quando você cuida de mais de uma empresa, escolha aqui em qual a APR vai ser registrada.',
   'Define em qual empresa a análise é salva e filtra a lista ao lado.',
   'Escolher a empresa da planta onde o serviço vai acontecer.',
   'Registrar a APR numa empresa achando que está em outra.',
   'compliance',10,1,'publicado'),
  ('ehs.apr.busca','/dashboard/ehs/trabalhos-risco/apr','APR','Buscar',
   'Digite parte do número, da tarefa ou do local para filtrar a lista.',
   'Ajuda a achar rápido uma APR quando há muitas.',
   '"telhado" para achar a análise do serviço na cobertura.',
   'Esperar que a busca procure dentro das etapas: ela filtra número, tarefa e local.',
   'compliance',20,1,'publicado'),
  ('ehs.apr.filtro_status','/dashboard/ehs/trabalhos-risco/apr','APR','Situação',
   'Filtre a lista por situação da APR (rascunho, em análise, aprovada, revisar, encerrada).',
   'Mostra só as análises na fase que você quer acompanhar.',
   'Deixar em "Aprovada" para ver o que já está liberado para servir de base à PT.',
   'Esquecer o filtro ligado e achar que sumiram APRs.',
   'compliance',30,1,'publicado'),
  ('ehs.apr.novo','/dashboard/ehs/trabalhos-risco/apr','APR','Nova APR',
   'Cria uma Análise Preliminar de Risco nova, do zero, para a empresa escolhida.',
   'A APR quebra a tarefa em etapas e levanta perigo, risco e medida de controle de cada uma.',
   'Analisar uma troca de telha na cobertura antes de liberar a Permissão de Trabalho.',
   'Começar o serviço de risco sem fazer a APR antes.',
   'compliance',40,1,'publicado'),
  ('ehs.apr.numero','/dashboard/ehs/trabalhos-risco/apr','APR','Número / identificação',
   'Opcional: um código para identificar a APR no papel e no sistema.',
   'Facilita achar e citar a análise em auditorias e na Permissão de Trabalho.',
   '"APR-2026-031".',
   'Repetir o mesmo número em duas análises diferentes.',
   'compliance',50,1,'publicado'),
  ('ehs.apr.tarefa','/dashboard/ehs/trabalhos-risco/apr','APR','Tarefa analisada',
   'Descreva em poucas palavras o serviço que está sendo analisado.',
   'É como a APR aparece na lista e na Permissão de Trabalho.',
   '"Troca de telhas na cobertura do galpão B".',
   'Tarefa vaga como "manutenção" que não diz o que será feito.',
   'compliance',60,1,'publicado'),
  ('ehs.apr.setor','/dashboard/ehs/trabalhos-risco/apr','APR','Setor',
   'Opcional: o setor ou área responsável pelo serviço analisado.',
   'Ajuda a organizar as APRs por área da planta.',
   '"Manutenção industrial".',
   'Confundir o setor que executa com o setor dono do local.',
   'compliance',70,1,'publicado'),
  ('ehs.apr.local','/dashboard/ehs/trabalhos-risco/apr','APR','Local',
   'Informe onde o serviço será executado.',
   'Localiza o trabalho analisado para a equipe e para a fiscalização.',
   '"Cobertura do galpão B, lado leste".',
   'Local genérico demais ("na fábrica") que não ajuda a achar o ponto.',
   'compliance',80,1,'publicado'),
  ('ehs.apr.data','/dashboard/ehs/trabalhos-risco/apr','APR','Data da análise',
   'A data em que a análise foi feita (ou será revisada).',
   'Registra quando a APR foi elaborada, para controle de validade e revisões.',
   '21/11/2026.',
   'Deixar sem data uma análise que precisa ser revisada periodicamente.',
   'compliance',90,1,'publicado'),
  ('ehs.apr.responsavel','/dashboard/ehs/trabalhos-risco/apr','APR','Responsável pela análise',
   'Quem elaborou e responde pela APR (normalmente SST ou supervisor).',
   'Registra quem conduziu a análise de risco.',
   '"João Silva — Técnico de Segurança".',
   'Deixar sem responsável uma análise que precisa de aval técnico.',
   'compliance',100,1,'publicado'),
  ('ehs.apr.equipe','/dashboard/ehs/trabalhos-risco/apr','APR','Equipe envolvida',
   'Nomes de quem participa da tarefa analisada.',
   'Deixa claro quem está envolvido no serviço coberto pela APR.',
   '"Carlos (telhadista), Pedro (ajudante)".',
   'Esquecer de listar quem vai executar o serviço.',
   'compliance',110,1,'publicado'),
  ('ehs.apr.status','/dashboard/ehs/trabalhos-risco/apr','APR','Situação',
   'Fase da APR: rascunho (montando), em análise, aprovada (liberada), revisar (precisa rever) ou encerrada.',
   'Mostra em que ponto do ciclo a análise está.',
   'Passar de "em análise" para "aprovada" quando o responsável valida.',
   'Deixar como "rascunho" uma APR que já foi aprovada e está em uso.',
   'compliance',120,1,'publicado'),
  ('ehs.apr.observacoes','/dashboard/ehs/trabalhos-risco/apr','APR','Observações',
   'Opcional: anotações gerais sobre a análise, restrições ou condições.',
   'Guarda informações que não cabem nas etapas.',
   '"Revisar a análise se o método de acesso mudar".',
   'Escrever aqui um perigo que deveria estar numa etapa abaixo.',
   'compliance',130,1,'publicado'),
  ('ehs.apr.etapas','/dashboard/ehs/trabalhos-risco/apr','APR','Etapas da tarefa',
   'Quebre a tarefa em etapas e, para cada uma, levante o perigo, o risco e a medida de controle.',
   'É o coração da APR: cada etapa do serviço com seu risco controlado.',
   '"Subir à cobertura"; "Remover telhas"; "Descer o material".',
   'Juntar a tarefa inteira numa etapa só e perder os perigos de cada passo.',
   'compliance',140,1,'publicado'),
  ('ehs.apr.etapa_descricao','/dashboard/ehs/trabalhos-risco/apr','APR','Etapa',
   'Descreva o passo da tarefa de forma objetiva.',
   'Cada passo vira uma linha com seu próprio perigo e controle.',
   '"Transitar sobre o telhado até o ponto de troca".',
   'Etapa genérica que não deixa ver o perigo específico dela.',
   'compliance',150,1,'publicado'),
  ('ehs.apr.etapa_perigo','/dashboard/ehs/trabalhos-risco/apr','APR','Perigo',
   'A fonte do dano nesta etapa (o que pode causar o acidente).',
   'Identifica a origem do risco para então controlá-la.',
   '"Trabalho em altura sem proteção coletiva".',
   'Confundir o perigo (a fonte) com o risco (a consequência).',
   'compliance',160,1,'publicado'),
  ('ehs.apr.etapa_risco','/dashboard/ehs/trabalhos-risco/apr','APR','Risco / consequência',
   'O que pode acontecer com a pessoa por causa do perigo.',
   'Mede a gravidade possível da etapa.',
   '"Queda de altura com lesão grave ou fatal".',
   'Descrever de novo o perigo em vez da consequência.',
   'compliance',170,1,'publicado'),
  ('ehs.apr.etapa_medida','/dashboard/ehs/trabalhos-risco/apr','APR','Medida de controle',
   'O que será feito para eliminar ou reduzir o risco desta etapa.',
   'É a ação de segurança que torna a etapa aceitável.',
   '"Linha de vida ancorada + cinto paraquedista + guarda-corpo".',
   'Listar EPI quando cabe uma medida coletiva mais eficaz.',
   'compliance',180,1,'publicado'),
  ('ehs.apr.etapa_severidade','/dashboard/ehs/trabalhos-risco/apr','APR','Severidade',
   'O quão grave é o risco desta etapa: baixa, média, alta ou crítica.',
   'Prioriza as etapas que exigem mais controle e atenção.',
   'Trabalho em altura sem proteção = Crítica.',
   'Marcar como baixa uma etapa que pode causar lesão grave.',
   'compliance',190,1,'publicado'),
  ('ehs.apr.col_tarefa','/dashboard/ehs/trabalhos-risco/apr','APR','Coluna APR / Tarefa',
   'Mostra o número (se houver) e a tarefa de cada análise.',
   'Identifica a APR na lista.',
   '"APR-2026-031 · Troca de telhas na cobertura".',
   'Confundir duas APRs de tarefa parecida.',
   'compliance',200,1,'publicado'),
  ('ehs.apr.col_setor','/dashboard/ehs/trabalhos-risco/apr','APR','Coluna Setor / Local',
   'Mostra o setor e o local do serviço analisado.',
   'Localiza a análise na lista.',
   '"Manutenção · Cobertura do galpão B".',
   'Achar que a APR sem local informado não tem local de verdade.',
   'compliance',210,1,'publicado'),
  ('ehs.apr.col_data','/dashboard/ehs/trabalhos-risco/apr','APR','Coluna Data',
   'Mostra a data em que a análise foi feita.',
   'Deixa ver de relance a validade e quando foi revisada.',
   '"21/11/2026".',
   'Ignorar a data e usar uma APR antiga que já mudou de método.',
   'compliance',220,1,'publicado'),
  ('ehs.apr.col_etapas','/dashboard/ehs/trabalhos-risco/apr','APR','Coluna Etapas',
   'Mostra quantas etapas a APR tem e a maior severidade entre elas.',
   'Dá uma ideia rápida do tamanho e do risco da análise.',
   '"4 etapas · Crítica".',
   'Achar que uma APR com poucas etapas é sempre de baixo risco.',
   'compliance',230,1,'publicado'),
  ('ehs.apr.col_status','/dashboard/ehs/trabalhos-risco/apr','APR','Coluna Situação',
   'Mostra a fase da APR (rascunho, em análise, aprovada, revisar, encerrada).',
   'Dá o andamento de cada análise na lista.',
   'Selo "Aprovada" nas APRs liberadas.',
   'Confundir "encerrada" (concluída) com "revisar".',
   'compliance',240,1,'publicado'),
  ('ehs.apr.col_acoes','/dashboard/ehs/trabalhos-risco/apr','APR','Coluna Ações',
   'Editar abre a APR e suas etapas; Desativar tira a APR das listas sem apagar o histórico.',
   'Mantém o registro vivo sem perder o que já foi analisado.',
   'Desativar uma APR lançada por engano.',
   'Apagar quando o certo é desativar (o histórico some).',
   'compliance',250,1,'publicado'),
  ('ehs.apr.editar','/dashboard/ehs/trabalhos-risco/apr','APR','Editar',
   'Abre a APR para mudar tarefa, local, responsável, etapas e situação.',
   'Deixa a análise sempre atualizada sem criar outra do zero.',
   'Mudar o status para "aprovada" quando o responsável valida.',
   'Criar uma APR nova quando era só editar a atual.',
   'compliance',260,1,'publicado'),
  ('ehs.apr.desativar','/dashboard/ehs/trabalhos-risco/apr','APR','Desativar',
   'Tira a APR das listas, com um motivo, sem apagar o histórico (exclusão rastreável — RD-98).',
   'Aposenta um registro errado ou obsoleto preservando o rastro.',
   'Desativar "APR lançada em duplicidade".',
   'Desativar sem informar o motivo e depois não lembrar por quê.',
   'compliance',270,1,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo, o_que_preencher=EXCLUDED.o_que_preencher,
  para_que_serve=EXCLUDED.para_que_serve, exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();

-- 5) blueprint vivo — marca só o requisito de M11 realmente entregue nesta fatia (RD-38) ───────────────
UPDATE public.blueprint_tela_requisito
   SET status_baseline='atendido',
       evidencia_baseline='APR: tabela ehs_apr + ehs_apr_etapa, tela /dashboard/ehs/trabalhos-risco/apr (etapa × perigo × risco × medida × severidade)'
 WHERE vertical='ehs' AND tela_num=11
   AND requisito ILIKE 'APR%';

-- 6) SEED DE DEMONSTRAÇÃO — SÓ na DEMO EHS b0700000-...-000b (fictício; NUNCA cliente real) ────────────
-- APR 1: Troca de telhas na cobertura (trabalho em altura)
INSERT INTO public.ehs_apr
  (company_id, numero, tarefa, setor, local, data_analise, responsavel, equipe, status, observacoes)
SELECT 'b0700000-0000-4000-a000-00000000000b','APR-DEMO-001',
       'Troca de telhas danificadas na cobertura','Manutenção industrial','Cobertura do galpão B',
       CURRENT_DATE,'Técnico de Segurança do Trabalho','Telhadista e ajudante','aprovada',
       'Revisar a análise se o método de acesso à cobertura mudar.'
WHERE NOT EXISTS (SELECT 1 FROM public.ehs_apr a
  WHERE a.company_id='b0700000-0000-4000-a000-00000000000b' AND a.numero='APR-DEMO-001');

-- APR 2: Manutenção em painel elétrico (NR-10)
INSERT INTO public.ehs_apr
  (company_id, numero, tarefa, setor, local, data_analise, responsavel, equipe, status, observacoes)
SELECT 'b0700000-0000-4000-a000-00000000000b','APR-DEMO-002',
       'Manutenção preventiva em painel elétrico de média tensão','Elétrica','Subestação interna',
       CURRENT_DATE,'Engenheiro Eletricista','Eletricista habilitado NR-10','em_analise',
       'Depende do bloqueio e etiquetagem das energias (LOTO) antes de iniciar.'
WHERE NOT EXISTS (SELECT 1 FROM public.ehs_apr a
  WHERE a.company_id='b0700000-0000-4000-a000-00000000000b' AND a.numero='APR-DEMO-002');

-- Etapas da APR 1 (idempotentes por apr + etapa)
INSERT INTO public.ehs_apr_etapa (company_id, apr_id, ordem, etapa, perigo, risco, medida_controle, severidade)
SELECT 'b0700000-0000-4000-a000-00000000000b', a.id, v.ordem, v.etapa, v.perigo, v.risco, v.medida, v.sev
FROM public.ehs_apr a
JOIN (VALUES
  (1,'Acesso à cobertura pela escada','Escada mal apoiada ou em mau estado','Queda durante a subida','Escada inspecionada, amarrada e com apoio antiderrapante','alta'),
  (2,'Trânsito e trabalho sobre o telhado','Trabalho em altura sem proteção coletiva','Queda de altura com lesão grave ou fatal','Linha de vida ancorada, cinto paraquedista e guarda-corpo na borda','critica'),
  (3,'Remoção e substituição das telhas','Queda de material e telha quebradiça','Lesão a quem está abaixo e perfuração do telhado','Isolar a área abaixo, usar tábuas de distribuição de carga e capacete','alta'),
  (4,'Descida do material','Esforço e queda de ferramentas','Lesão lombar e queda de objetos','Içamento com corda-guia, ferramentas amarradas e rodízio da equipe','media')
) AS v(ordem, etapa, perigo, risco, medida, sev) ON true
WHERE a.company_id='b0700000-0000-4000-a000-00000000000b' AND a.numero='APR-DEMO-001'
  AND NOT EXISTS (SELECT 1 FROM public.ehs_apr_etapa e WHERE e.apr_id=a.id AND e.etapa=v.etapa);

-- Etapas da APR 2
INSERT INTO public.ehs_apr_etapa (company_id, apr_id, ordem, etapa, perigo, risco, medida_controle, severidade)
SELECT 'b0700000-0000-4000-a000-00000000000b', a.id, v.ordem, v.etapa, v.perigo, v.risco, v.medida, v.sev
FROM public.ehs_apr a
JOIN (VALUES
  (1,'Desenergização do painel','Energia elétrica de média tensão','Choque elétrico e arco voltaico','Bloqueio e etiquetagem (LOTO) e teste de ausência de tensão','critica'),
  (2,'Limpeza e inspeção dos componentes','Partes energizadas residuais e poeira condutiva','Choque e curto-circuito','Aterramento temporário e EPI para risco elétrico','alta'),
  (3,'Reaperto de conexões','Ferramenta inadequada e torque errado','Falha e reignição de arco','Ferramenta isolada e seguir o plano de manutenção','media'),
  (4,'Reenergização e teste','Religamento indevido durante o serviço','Acidente com a equipe','Religar só após liberação formal e retirada do bloqueio pelo executante','alta')
) AS v(ordem, etapa, perigo, risco, medida, sev) ON true
WHERE a.company_id='b0700000-0000-4000-a000-00000000000b' AND a.numero='APR-DEMO-002'
  AND NOT EXISTS (SELECT 1 FROM public.ehs_apr_etapa e WHERE e.apr_id=a.id AND e.etapa=v.etapa);
