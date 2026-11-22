-- PS EHS · EHS-7 / M11 — Trabalhos de risco: fatia 1 "Permissão de Trabalho (PT)"
--
-- M11 é o campo dos trabalhos de alto risco. Esta fatia entrega a PERMISSÃO DE TRABALHO (PT): o documento
-- que libera, com responsável, período e medidas de controle conferidas, um trabalho perigoso — altura (NR-35),
-- espaço confinado (NR-33), eletricidade (NR-10), inflamáveis (NR-20), trabalho a quente, içamento, escavação.
-- As próximas fatias de M11 (APR por tarefa, bloqueio de energias NR-12 / LOTO, gestão de mudanças, aptidão na
-- hora por ASO/treinamento/EPI) são independentes desta.
--
-- Company-scoped (RLS por empresa via get_user_company_ids(), igual a compliance_* e ehs_inspecao_* #5692).
-- ADITIVA: 2 tabelas novas, RLS ligada, REVOKE anon, menu/tela 'completo' (gate #5114 — só DEMO/contratante vê),
-- ajuda (RD-95) e SEED FICTÍCIO só na DEMO EHS (b0700000-...-000b). Nada de dado de cliente real.

-- 1) Tabelas ─────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ehs_permissao_trabalho (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL,
  numero              text,
  tipo                text NOT NULL DEFAULT 'geral'
                        CHECK (tipo IN ('altura','espaco_confinado','eletricidade','inflamaveis',
                                        'trabalho_quente','icamento','escavacao','geral')),
  titulo              text NOT NULL,
  descricao           text,
  local               text,
  setor               text,
  data_inicio         timestamptz,
  data_fim            timestamptz,
  responsavel_emissao text,
  executantes         text,
  status              text NOT NULL DEFAULT 'rascunho'
                        CHECK (status IN ('rascunho','emitida','em_andamento','encerrada','cancelada')),
  observacoes         text,
  ativo               boolean NOT NULL DEFAULT true,
  criado_por          uuid DEFAULT auth.uid(),
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ehs_pt_medida (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  pt_id      uuid NOT NULL REFERENCES public.ehs_permissao_trabalho(id) ON DELETE CASCADE,
  ordem      integer NOT NULL DEFAULT 1,
  descricao  text NOT NULL,
  atendido   boolean NOT NULL DEFAULT false,
  ativo      boolean NOT NULL DEFAULT true,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ehs_pt_empresa        ON public.ehs_permissao_trabalho (company_id, ativo);
CREATE INDEX IF NOT EXISTS idx_ehs_pt_status         ON public.ehs_permissao_trabalho (company_id, status);
CREATE INDEX IF NOT EXISTS idx_ehs_pt_medida_pt      ON public.ehs_pt_medida (pt_id, ordem);
CREATE INDEX IF NOT EXISTS idx_ehs_pt_medida_empresa ON public.ehs_pt_medida (company_id);

-- 2) RLS por empresa (mesmo padrão das tabelas compliance_* / ehs_inspecao_*: get_user_company_ids()) ──
ALTER TABLE public.ehs_permissao_trabalho ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ehs_pt_medida          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ehs_pt_select ON public.ehs_permissao_trabalho;
DROP POLICY IF EXISTS ehs_pt_insert ON public.ehs_permissao_trabalho;
DROP POLICY IF EXISTS ehs_pt_update ON public.ehs_permissao_trabalho;
DROP POLICY IF EXISTS ehs_pt_delete ON public.ehs_permissao_trabalho;
CREATE POLICY ehs_pt_select ON public.ehs_permissao_trabalho FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_pt_insert ON public.ehs_permissao_trabalho FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_pt_update ON public.ehs_permissao_trabalho FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_pt_delete ON public.ehs_permissao_trabalho FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

DROP POLICY IF EXISTS ehs_pt_medida_select ON public.ehs_pt_medida;
DROP POLICY IF EXISTS ehs_pt_medida_insert ON public.ehs_pt_medida;
DROP POLICY IF EXISTS ehs_pt_medida_update ON public.ehs_pt_medida;
DROP POLICY IF EXISTS ehs_pt_medida_delete ON public.ehs_pt_medida;
CREATE POLICY ehs_pt_medida_select ON public.ehs_pt_medida FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_pt_medida_insert ON public.ehs_pt_medida FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_pt_medida_update ON public.ehs_pt_medida FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_pt_medida_delete ON public.ehs_pt_medida FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

REVOKE ALL ON public.ehs_permissao_trabalho FROM anon;
REVOKE ALL ON public.ehs_pt_medida          FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ehs_permissao_trabalho TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ehs_pt_medida          TO authenticated;
GRANT ALL ON public.ehs_permissao_trabalho TO service_role;
GRANT ALL ON public.ehs_pt_medida          TO service_role;

-- 3) Menu + tela (NASCE ehs_modulo='completo' — gate #5114; NULL vazaria p/ todos) ────────────────────
INSERT INTO public.module_catalog
  (id, nome, rota, ativo, grupo, icone, ordem, subgrupo, descricao, is_shared, so_ps, legacy, so_demo, diferencial, rbac_isento, dependencies, surface_in_groups, ehs_modulo)
VALUES
  ('ehs_permissao_trabalho', 'Permissões de trabalho', '/dashboard/ehs/trabalhos-risco/permissoes', true, 'compliance', 'ShieldCheck', 23,
   'incidentes_riscos',
   'Libere trabalhos de alto risco (altura, confinado, elétrica, a quente...) com responsável, período e medidas de controle conferidas.',
   true, false, false, false, false, false, ARRAY[]::text[], ARRAY[]::text[], 'completo')
ON CONFLICT (id) DO UPDATE SET ehs_modulo = EXCLUDED.ehs_modulo, rota = EXCLUDED.rota, ativo = EXCLUDED.ativo, nome = EXCLUDED.nome, descricao = EXCLUDED.descricao;

INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, auditavel_robo, estado_real, prioridade_monitoramento, auditada_ok)
VALUES
  ('dashboard.ehs_permissao_trabalho', '/dashboard/ehs/trabalhos-risco/permissoes', 'compliance', 'Permissões de trabalho',
   'Emissão e controle de Permissões de Trabalho (PT) para serviços de alto risco por empresa, com medidas de controle conferidas (M11). Piloto DEMO EHS.',
   true, 'desconhecida', 'alta', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, prioridade, descricao_executiva, descricao_tecnica)
VALUES ('F.ehs.permissao_trabalho', 'ehs_permissao_trabalho', 'compliance', 'Permissões de trabalho', 'pronto', 100, 'alta',
        'Permissão de Trabalho para serviços de alto risco, com medidas de controle conferidas e ciclo de status.', 'ehs_permissao_trabalho + ehs_pt_medida (RLS por empresa)')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.screen_route_features (screen_id, feature_id, peso)
VALUES ('dashboard.ehs_permissao_trabalho', 'F.ehs.permissao_trabalho', 1)
ON CONFLICT DO NOTHING;

-- 4) Ajuda de campo (RD-95) — uma chave por campo/coluna/ação da tela, 1:1 com a page ─────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.pt.empresa','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Empresa',
   'Quando você cuida de mais de uma empresa, escolha aqui em qual vai emitir a permissão de trabalho.',
   'Define em qual empresa a PT é salva e filtra a lista ao lado.',
   'Escolher a empresa da planta onde o serviço vai acontecer.',
   'Emitir a PT numa empresa achando que está em outra.',
   'compliance',10,1,'publicado'),
  ('ehs.pt.busca','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Buscar',
   'Digite parte do número, da tarefa ou do local para filtrar a lista.',
   'Ajuda a achar rápido uma PT quando há muitas.',
   '"solda" para achar as permissões de trabalho a quente.',
   'Esperar que a busca procure dentro das medidas: ela filtra número, tarefa e local.',
   'compliance',20,1,'publicado'),
  ('ehs.pt.filtro_status','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Situação',
   'Filtre a lista por situação da PT (rascunho, emitida, em andamento, encerrada, cancelada).',
   'Mostra só as permissões na fase que você quer acompanhar.',
   'Deixar em "Emitida" para ver o que está liberado para começar.',
   'Esquecer o filtro ligado e achar que sumiram PTs.',
   'compliance',30,1,'publicado'),
  ('ehs.pt.novo','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Nova permissão',
   'Cria uma permissão de trabalho nova, do zero, para a empresa escolhida.',
   'A PT registra quem libera, o período e as medidas de controle do serviço de risco.',
   'Emitir a PT de uma solda em altura na cobertura do galpão.',
   'Começar o serviço de risco sem emitir a PT antes.',
   'compliance',40,1,'publicado'),
  ('ehs.pt.numero','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Número / identificação',
   'Opcional: um código para identificar a PT no papel e no sistema.',
   'Facilita achar e citar a permissão em auditorias e no campo.',
   '"PT-2026-014".',
   'Repetir o mesmo número em duas permissões diferentes.',
   'compliance',50,1,'publicado'),
  ('ehs.pt.tipo','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Tipo de trabalho',
   'Escolha o tipo de risco: altura, espaço confinado, eletricidade, inflamáveis, trabalho a quente, içamento, escavação ou geral.',
   'Define a norma aplicável (NR-35, NR-33, NR-10, NR-20...) e as medidas de controle esperadas.',
   'Serviço de solda = Trabalho a quente; entrada em tanque = Espaço confinado.',
   'Classificar um trabalho em altura como "geral" e perder a exigência da NR-35.',
   'compliance',60,1,'publicado'),
  ('ehs.pt.titulo','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Tarefa',
   'Descreva em poucas palavras o serviço que está sendo liberado.',
   'É como a PT aparece na lista e no campo.',
   '"Solda de estrutura metálica na cobertura".',
   'Título vago como "manutenção" que não diz o que será feito.',
   'compliance',70,1,'publicado'),
  ('ehs.pt.descricao','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Descrição do serviço',
   'Opcional: detalhe o que será feito, como e com quais equipamentos.',
   'Dá o contexto do serviço para quem libera e quem executa.',
   '"Corte e solda de perfis a 6 m de altura, com uso de andaime e cinto".',
   'Deixar sem detalhe um serviço complexo de alto risco.',
   'compliance',80,1,'publicado'),
  ('ehs.pt.local','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Local',
   'Informe onde o serviço será executado.',
   'Localiza o trabalho de risco para a equipe e para a fiscalização.',
   '"Cobertura do galpão B, lado leste".',
   'Local genérico demais ("na fábrica") que não ajuda a achar o ponto.',
   'compliance',90,1,'publicado'),
  ('ehs.pt.setor','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Setor',
   'Opcional: o setor ou área responsável pelo local do serviço.',
   'Ajuda a organizar as PTs por área da planta.',
   '"Manutenção industrial".',
   'Confundir o setor que executa com o setor dono do local.',
   'compliance',100,1,'publicado'),
  ('ehs.pt.data_inicio','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Início da validade',
   'Data e hora em que o serviço pode começar com a PT.',
   'Define a partir de quando a liberação vale.',
   '21/11/2026 08:00.',
   'Emitir a PT para começar antes das medidas de controle estarem conferidas.',
   'compliance',110,1,'publicado'),
  ('ehs.pt.data_fim','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Fim da validade',
   'Data e hora em que a liberação expira. PT vencida deve ser renovada antes de continuar.',
   'Limita a janela em que o trabalho de risco está autorizado.',
   '21/11/2026 17:00 (validade de um turno).',
   'Deixar a PT sem fim e o serviço seguir sem reavaliação.',
   'compliance',120,1,'publicado'),
  ('ehs.pt.responsavel','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Responsável pela emissão',
   'Quem emite e responde pela liberação da PT (normalmente SST ou supervisor habilitado).',
   'Registra quem autorizou o trabalho de risco.',
   '"João Silva — Técnico de Segurança".',
   'Deixar sem responsável uma permissão que precisa de aprovação técnica.',
   'compliance',130,1,'publicado'),
  ('ehs.pt.executantes','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Executantes',
   'Nomes de quem vai executar o serviço coberto pela PT.',
   'Deixa claro quem está autorizado a trabalhar sob esta permissão.',
   '"Carlos (soldador), Pedro (ajudante)".',
   'Liberar a PT sem dizer quem pode executar o serviço.',
   'compliance',140,1,'publicado'),
  ('ehs.pt.status','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Situação',
   'Fase da PT: rascunho (montando), emitida (liberada), em andamento (serviço rolando), encerrada (concluída) ou cancelada.',
   'Mostra em que ponto do ciclo a permissão está.',
   'Passar de "emitida" para "em andamento" quando a equipe inicia.',
   'Deixar como "em andamento" um serviço que já acabou.',
   'compliance',150,1,'publicado'),
  ('ehs.pt.observacoes','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Observações',
   'Opcional: anotações sobre condições, restrições ou ocorrências da liberação.',
   'Guarda informações que não cabem nos demais campos.',
   '"Suspender em caso de chuva ou vento forte".',
   'Escrever aqui uma medida de controle que deveria estar na lista abaixo.',
   'compliance',160,1,'publicado'),
  ('ehs.pt.medidas','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Medidas de controle',
   'Liste as medidas de segurança que precisam estar atendidas antes e durante o serviço.',
   'É a checklist que garante que o risco está controlado antes de liberar.',
   '"Área isolada e sinalizada"; "Teste de gases feito"; "Cinto e talabarte inspecionados".',
   'Emitir a PT com medidas essenciais ainda não atendidas.',
   'compliance',170,1,'publicado'),
  ('ehs.pt.medida_descricao','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Medida',
   'Escreva a medida de controle de forma objetiva, que dê para marcar como atendida ou não.',
   'Cada medida vira um item conferível da liberação.',
   '"Extintor de incêndio no local durante a solda".',
   'Juntar várias medidas numa só linha e não conseguir conferir uma a uma.',
   'compliance',180,1,'publicado'),
  ('ehs.pt.medida_atendido','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Atendida',
   'Marque quando a medida de controle estiver cumprida e conferida.',
   'Mostra o quanto da checklist de segurança já está atendido antes de liberar.',
   'Marcar "Área isolada" depois de isolar e sinalizar o local.',
   'Marcar como atendida uma medida que ainda não foi feita de verdade.',
   'compliance',190,1,'publicado'),
  ('ehs.pt.col_numero','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Coluna PT / Tarefa',
   'Mostra o número (se houver) e a tarefa de cada permissão.',
   'Identifica a PT na lista.',
   '"PT-2026-014 · Solda na cobertura".',
   'Confundir duas PTs de tarefa parecida.',
   'compliance',200,1,'publicado'),
  ('ehs.pt.col_tipo','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Coluna Tipo',
   'Mostra o tipo de trabalho de risco da PT.',
   'Ajuda a agrupar e achar o serviço certo.',
   '"Trabalho a quente"; "Altura".',
   'Ler o tipo achando que é a norma.',
   'compliance',210,1,'publicado'),
  ('ehs.pt.col_local','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Coluna Local',
   'Mostra onde o serviço da PT acontece.',
   'Localiza o trabalho na lista.',
   '"Cobertura do galpão B".',
   'Achar que a PT sem local informado não tem local de verdade.',
   'compliance',220,1,'publicado'),
  ('ehs.pt.col_periodo','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Coluna Período',
   'Mostra o início e o fim da validade da PT.',
   'Deixa ver de relance se a liberação ainda está na janela.',
   '"21/11 08:00 → 17:00".',
   'Ignorar o fim e deixar continuar um serviço com PT vencida.',
   'compliance',230,1,'publicado'),
  ('ehs.pt.col_status','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Coluna Situação',
   'Mostra a fase da PT (rascunho, emitida, em andamento, encerrada, cancelada).',
   'Dá o andamento de cada permissão na lista.',
   'Selo "Emitida" nas PTs liberadas.',
   'Confundir "encerrada" (concluída) com "cancelada".',
   'compliance',240,1,'publicado'),
  ('ehs.pt.col_acoes','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Coluna Ações',
   'Editar abre a PT e suas medidas; Desativar tira a PT das listas sem apagar o histórico.',
   'Mantém o registro vivo sem perder o que já foi emitido.',
   'Desativar uma PT lançada por engano.',
   'Apagar quando o certo é desativar (o histórico some).',
   'compliance',250,1,'publicado'),
  ('ehs.pt.editar','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Editar',
   'Abre a PT para mudar tipo, tarefa, período, responsável, executantes, medidas e situação.',
   'Deixa a permissão sempre atualizada sem criar outra do zero.',
   'Mudar o status para "em andamento" quando a equipe começa.',
   'Criar uma PT nova quando era só editar a atual.',
   'compliance',260,1,'publicado'),
  ('ehs.pt.desativar','/dashboard/ehs/trabalhos-risco/permissoes','Permissões de trabalho','Desativar',
   'Tira a PT das listas, com um motivo, sem apagar o histórico (exclusão rastreável — RD-98).',
   'Aposenta um registro errado ou obsoleto preservando o rastro.',
   'Desativar "PT lançada em duplicidade".',
   'Desativar sem informar o motivo e depois não lembrar por quê.',
   'compliance',270,1,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo, o_que_preencher=EXCLUDED.o_que_preencher,
  para_que_serve=EXCLUDED.para_que_serve, exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();

-- 5) blueprint vivo — marca só os requisitos de M11 realmente entregues nesta fatia (RD-38) ────────────
UPDATE public.blueprint_tela_requisito
   SET status_baseline='atendido',
       evidencia_baseline='PT: tabela ehs_permissao_trabalho + ehs_pt_medida, tela /dashboard/ehs/trabalhos-risco/permissoes (fatia 1)'
 WHERE vertical='ehs' AND tela_num=11
   AND requisito ILIKE 'Permissão de trabalho%';

-- 6) SEED DE DEMONSTRAÇÃO — SÓ na DEMO EHS b0700000-...-000b (fictício; NUNCA cliente real) ────────────
-- PT 1: Solda em altura (trabalho a quente)
INSERT INTO public.ehs_permissao_trabalho
  (company_id, numero, tipo, titulo, descricao, local, setor, data_inicio, data_fim, responsavel_emissao, executantes, status)
SELECT 'b0700000-0000-4000-a000-00000000000b','PT-DEMO-001','trabalho_quente',
       'Solda de estrutura metálica na cobertura',
       'Corte e solda de perfis a cerca de 6 m de altura, com andaime e sistema de ancoragem.',
       'Cobertura do galpão B','Manutenção industrial',
       now(), now() + interval '8 hours',
       'Técnico de Segurança do Trabalho','Soldador e ajudante da equipe de manutenção','emitida'
WHERE NOT EXISTS (SELECT 1 FROM public.ehs_permissao_trabalho p
  WHERE p.company_id='b0700000-0000-4000-a000-00000000000b' AND p.numero='PT-DEMO-001');

-- PT 2: Entrada em espaço confinado
INSERT INTO public.ehs_permissao_trabalho
  (company_id, numero, tipo, titulo, descricao, local, setor, data_inicio, data_fim, responsavel_emissao, executantes, status)
SELECT 'b0700000-0000-4000-a000-00000000000b','PT-DEMO-002','espaco_confinado',
       'Limpeza interna de tanque de armazenamento',
       'Entrada e limpeza interna do tanque TQ-02 com monitoramento contínuo de gases e vigia externo.',
       'Pátio de tanques','Operação',
       now() + interval '1 day', now() + interval '1 day 6 hours',
       'Técnico de Segurança do Trabalho','Operador habilitado e vigia','rascunho'
WHERE NOT EXISTS (SELECT 1 FROM public.ehs_permissao_trabalho p
  WHERE p.company_id='b0700000-0000-4000-a000-00000000000b' AND p.numero='PT-DEMO-002');

-- Medidas da PT 1 (idempotentes por pt + descrição)
INSERT INTO public.ehs_pt_medida (company_id, pt_id, ordem, descricao, atendido)
SELECT 'b0700000-0000-4000-a000-00000000000b', p.id, v.ordem, v.descricao, v.atendido
FROM public.ehs_permissao_trabalho p
JOIN (VALUES
  (1,'Área isolada e sinalizada abaixo da frente de solda',true),
  (2,'Extintor de incêndio adequado disponível no local',true),
  (3,'Cinto de segurança e talabarte inspecionados e ancorados',true),
  (4,'Material combustível removido do raio de respingos',false)
) AS v(ordem, descricao, atendido) ON true
WHERE p.company_id='b0700000-0000-4000-a000-00000000000b' AND p.numero='PT-DEMO-001'
  AND NOT EXISTS (SELECT 1 FROM public.ehs_pt_medida m WHERE m.pt_id=p.id AND m.descricao=v.descricao);

-- Medidas da PT 2
INSERT INTO public.ehs_pt_medida (company_id, pt_id, ordem, descricao, atendido)
SELECT 'b0700000-0000-4000-a000-00000000000b', p.id, v.ordem, v.descricao, v.atendido
FROM public.ehs_permissao_trabalho p
JOIN (VALUES
  (1,'Teste de atmosfera (O2, gases inflamáveis e tóxicos) realizado',false),
  (2,'Bloqueio e etiquetagem das energias do tanque (LOTO)',false),
  (3,'Vigia posicionado na entrada durante toda a tarefa',false),
  (4,'Equipamento de resgate e comunicação disponível',false)
) AS v(ordem, descricao, atendido) ON true
WHERE p.company_id='b0700000-0000-4000-a000-00000000000b' AND p.numero='PT-DEMO-002'
  AND NOT EXISTS (SELECT 1 FROM public.ehs_pt_medida m WHERE m.pt_id=p.id AND m.descricao=v.descricao);
