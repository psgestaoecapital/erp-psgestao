-- PS EHS · EHS-7 / M11 — Trabalhos de risco: fatia "Gestão de mudanças (MOC) — análise antes da mudança"
--
-- M11 cobre os trabalhos de alto risco. Esta fatia entrega a GESTÃO DE MUDANÇAS (Management of Change):
-- antes de mudar equipamento, processo, layout, material, procedimento ou pessoas-chave, a mudança é
-- registrada, tem o risco avaliado e ganha ações de controle a cumprir ANTES de implementar. É o requisito
-- "Gestão de mudanças: Análise antes da mudança" (blueprint vivo vertical ehs · M11 · onda E7, ausente).
--
-- Fatia INDEPENDENTE das demais de M11 (#5717 Permissão de Trabalho, #5749 APR): company-scoped
-- (RLS por empresa via get_user_company_ids(), igual a compliance_* e às fatias já aprovadas), não toca
-- nenhuma estrutura existente. ADITIVA: 2 tabelas novas, RLS ligada, REVOKE anon, menu/tela 'completo'
-- (gate #5114 — só DEMO/contratante vê), ajuda (RD-95) e SEED FICTÍCIO só na DEMO EHS
-- (b0700000-...-000b). Nada de dado de cliente real.

-- 1) Tabelas ─────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ehs_mudanca (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL,
  numero              text,
  titulo              text NOT NULL,
  tipo                text NOT NULL DEFAULT 'processo'
                        CHECK (tipo IN ('equipamento','processo','layout','material','procedimento','pessoas','outra')),
  descricao           text,
  motivo              text,
  area                text,
  local               text,
  solicitante         text,
  data_solicitacao    date,
  nivel_risco         text NOT NULL DEFAULT 'medio'
                        CHECK (nivel_risco IN ('baixo','medio','alto','critico')),
  avaliacao_risco     text,
  responsavel_analise text,
  data_implementacao  date,
  status              text NOT NULL DEFAULT 'rascunho'
                        CHECK (status IN ('rascunho','em_analise','aprovada','reprovada','implementada','cancelada')),
  observacoes         text,
  ativo               boolean NOT NULL DEFAULT true,
  criado_por          uuid DEFAULT auth.uid(),
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ehs_mudanca_acao (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  mudanca_id  uuid NOT NULL REFERENCES public.ehs_mudanca(id) ON DELETE CASCADE,
  ordem       integer NOT NULL DEFAULT 1,
  descricao   text NOT NULL,
  responsavel text,
  prazo       date,
  concluido   boolean NOT NULL DEFAULT false,
  ativo       boolean NOT NULL DEFAULT true,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ehs_mudanca_empresa      ON public.ehs_mudanca (company_id, ativo);
CREATE INDEX IF NOT EXISTS idx_ehs_mudanca_status       ON public.ehs_mudanca (company_id, status);
CREATE INDEX IF NOT EXISTS idx_ehs_mudanca_acao_mud     ON public.ehs_mudanca_acao (mudanca_id, ordem);
CREATE INDEX IF NOT EXISTS idx_ehs_mudanca_acao_empresa ON public.ehs_mudanca_acao (company_id);

-- 2) RLS por empresa (mesmo padrão compliance_* / ehs_permissao_trabalho #5717: get_user_company_ids()) ─
ALTER TABLE public.ehs_mudanca      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ehs_mudanca_acao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ehs_mudanca_select ON public.ehs_mudanca;
DROP POLICY IF EXISTS ehs_mudanca_insert ON public.ehs_mudanca;
DROP POLICY IF EXISTS ehs_mudanca_update ON public.ehs_mudanca;
DROP POLICY IF EXISTS ehs_mudanca_delete ON public.ehs_mudanca;
CREATE POLICY ehs_mudanca_select ON public.ehs_mudanca FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_mudanca_insert ON public.ehs_mudanca FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_mudanca_update ON public.ehs_mudanca FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_mudanca_delete ON public.ehs_mudanca FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

DROP POLICY IF EXISTS ehs_mudanca_acao_select ON public.ehs_mudanca_acao;
DROP POLICY IF EXISTS ehs_mudanca_acao_insert ON public.ehs_mudanca_acao;
DROP POLICY IF EXISTS ehs_mudanca_acao_update ON public.ehs_mudanca_acao;
DROP POLICY IF EXISTS ehs_mudanca_acao_delete ON public.ehs_mudanca_acao;
CREATE POLICY ehs_mudanca_acao_select ON public.ehs_mudanca_acao FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_mudanca_acao_insert ON public.ehs_mudanca_acao FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_mudanca_acao_update ON public.ehs_mudanca_acao FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_mudanca_acao_delete ON public.ehs_mudanca_acao FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

REVOKE ALL ON public.ehs_mudanca      FROM anon;
REVOKE ALL ON public.ehs_mudanca_acao FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ehs_mudanca      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ehs_mudanca_acao TO authenticated;
GRANT ALL ON public.ehs_mudanca      TO service_role;
GRANT ALL ON public.ehs_mudanca_acao TO service_role;

-- 3) Menu + tela (NASCE ehs_modulo='completo' — gate #5114; NULL vazaria p/ todos) ────────────────────
INSERT INTO public.module_catalog
  (id, nome, rota, ativo, grupo, icone, ordem, subgrupo, descricao, is_shared, so_ps, legacy, so_demo, diferencial, rbac_isento, dependencies, surface_in_groups, ehs_modulo)
VALUES
  ('ehs_gestao_mudancas', 'Gestão de mudanças', '/dashboard/ehs/trabalhos-risco/mudancas', true, 'compliance', 'GitBranch', 25,
   'incidentes_riscos',
   'Analise o risco de uma mudança (equipamento, processo, layout, material...) ANTES de implementar e registre as ações de controle a cumprir.',
   true, false, false, false, false, false, ARRAY[]::text[], ARRAY[]::text[], 'completo')
ON CONFLICT (id) DO UPDATE SET ehs_modulo = EXCLUDED.ehs_modulo, rota = EXCLUDED.rota, ativo = EXCLUDED.ativo, nome = EXCLUDED.nome, descricao = EXCLUDED.descricao;

INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, auditavel_robo, estado_real, prioridade_monitoramento, auditada_ok)
VALUES
  ('dashboard.ehs_gestao_mudancas', '/dashboard/ehs/trabalhos-risco/mudancas', 'compliance', 'Gestão de mudanças',
   'Gestão de mudanças (MOC): análise de risco antes de mudar equipamento, processo, layout, material, procedimento ou pessoas-chave, com ações de controle por empresa (M11). Piloto DEMO EHS.',
   true, 'desconhecida', 'alta', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, prioridade, descricao_executiva, descricao_tecnica)
VALUES ('F.ehs.gestao_mudancas', 'ehs_gestao_mudancas', 'compliance', 'Gestão de mudanças', 'pronto', 100, 'alta',
        'Análise de risco da mudança antes de implementar, com ações de controle e ciclo de status.', 'ehs_mudanca + ehs_mudanca_acao (RLS por empresa)')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.screen_route_features (screen_id, feature_id, peso)
VALUES ('dashboard.ehs_gestao_mudancas', 'F.ehs.gestao_mudancas', 1)
ON CONFLICT DO NOTHING;

-- 4) Ajuda de campo (RD-95) — uma chave por campo/coluna/ação da tela, 1:1 com a page ─────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.moc.empresa','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Empresa',
   'Quando você cuida de mais de uma empresa, escolha aqui em qual vai registrar a mudança.',
   'Define em qual empresa a mudança é salva e filtra a lista ao lado.',
   'Escolher a empresa da planta onde a mudança vai acontecer.',
   'Registrar a mudança numa empresa achando que está em outra.',
   'compliance',10,1,'publicado'),
  ('ehs.moc.busca','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Buscar',
   'Digite parte do número, do título ou da área para filtrar a lista.',
   'Ajuda a achar rápido uma mudança quando há muitas.',
   '"compressor" para achar a troca do compressor.',
   'Esperar que a busca procure dentro das ações: ela filtra número, título e área.',
   'compliance',20,1,'publicado'),
  ('ehs.moc.filtro_status','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Situação',
   'Filtre a lista por situação da mudança (rascunho, em análise, aprovada, reprovada, implementada, cancelada).',
   'Mostra só as mudanças na fase que você quer acompanhar.',
   'Deixar em "Em análise" para ver o que ainda falta avaliar.',
   'Esquecer o filtro ligado e achar que sumiram mudanças.',
   'compliance',30,1,'publicado'),
  ('ehs.moc.novo','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Nova mudança',
   'Registra uma mudança nova, do zero, para a empresa escolhida.',
   'Toda mudança relevante deve ser analisada ANTES de acontecer (gestão de mudanças / MOC).',
   'Registrar a troca de um produto químico por outro na linha.',
   'Fazer a mudança primeiro e só depois registrar a análise.',
   'compliance',40,1,'publicado'),
  ('ehs.moc.numero','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Número / identificação',
   'Opcional: um código para identificar a mudança no papel e no sistema.',
   'Facilita achar e citar a mudança em auditorias.',
   '"MOC-2026-007".',
   'Repetir o mesmo número em duas mudanças diferentes.',
   'compliance',50,1,'publicado'),
  ('ehs.moc.titulo','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Título da mudança',
   'Descreva em poucas palavras o que vai mudar.',
   'É como a mudança aparece na lista.',
   '"Troca do solvente da cabine de pintura".',
   'Título vago como "melhoria" que não diz o que muda.',
   'compliance',60,1,'publicado'),
  ('ehs.moc.tipo','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Tipo de mudança',
   'Escolha o que está mudando: equipamento, processo, layout, material, procedimento, pessoas-chave ou outra.',
   'Orienta que tipo de risco avaliar antes de aprovar.',
   'Trocar uma máquina = Equipamento; mudar o fluxo da linha = Processo.',
   'Classificar como "outra" uma mudança que é claramente de equipamento ou processo.',
   'compliance',70,1,'publicado'),
  ('ehs.moc.descricao','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','O que muda (descrição)',
   'Detalhe o que será alterado, de como está hoje para como vai ficar.',
   'Dá o contexto da mudança para quem analisa o risco.',
   '"Substituir o solvente X pelo Y, de menor inflamabilidade, na cabine 2".',
   'Deixar sem detalhe uma mudança complexa.',
   'compliance',80,1,'publicado'),
  ('ehs.moc.motivo','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Motivo',
   'Por que esta mudança é necessária.',
   'Justifica a mudança e ajuda na decisão de aprovar ou não.',
   '"Reduzir risco de incêndio e exposição química da equipe".',
   'Confundir o motivo (por quê) com a descrição (o quê).',
   'compliance',90,1,'publicado'),
  ('ehs.moc.area','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Área / setor',
   'Opcional: a área ou setor afetado pela mudança.',
   'Ajuda a organizar e direcionar a análise.',
   '"Pintura".',
   'Informar a área que pede a mudança no lugar da que é afetada.',
   'compliance',100,1,'publicado'),
  ('ehs.moc.local','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Local',
   'Opcional: onde a mudança acontece.',
   'Localiza a mudança na planta.',
   '"Cabine de pintura 2, galpão A".',
   'Local genérico demais que não ajuda a achar o ponto.',
   'compliance',110,1,'publicado'),
  ('ehs.moc.solicitante','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Solicitante',
   'Quem está pedindo a mudança.',
   'Registra a origem do pedido.',
   '"Supervisor de produção".',
   'Deixar sem solicitante e não saber a quem voltar com dúvidas.',
   'compliance',120,1,'publicado'),
  ('ehs.moc.data_solicitacao','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Data da solicitação',
   'Data em que a mudança foi pedida.',
   'Marca quando o processo de análise começou.',
   '21/11/2026.',
   'Deixar sem data e perder o prazo de análise.',
   'compliance',130,1,'publicado'),
  ('ehs.moc.nivel_risco','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Nível de risco',
   'Classifique o risco da mudança: baixo, médio, alto ou crítico.',
   'Prioriza a análise e as ações de controle; mudança crítica exige mais cuidado antes de aprovar.',
   'Troca de produto inflamável por outro = risco alto.',
   'Subestimar o risco para aprovar a mudança mais rápido.',
   'compliance',140,1,'publicado'),
  ('ehs.moc.avaliacao_risco','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Avaliação de risco',
   'Descreva os riscos novos que a mudança introduz e o que precisa ser controlado.',
   'É o coração da gestão de mudanças: analisar ANTES de implementar.',
   '"O novo solvente é menos inflamável, mas exige nova ventilação e EPI respiratório".',
   'Aprovar a mudança sem nenhuma avaliação de risco escrita.',
   'compliance',150,1,'publicado'),
  ('ehs.moc.responsavel_analise','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Responsável pela análise',
   'Quem analisa e responde pela mudança (normalmente SST, engenharia ou produção).',
   'Registra quem avaliou o risco da mudança.',
   '"Engenheiro de Segurança".',
   'Deixar sem responsável uma mudança que precisa de parecer técnico.',
   'compliance',160,1,'publicado'),
  ('ehs.moc.data_implementacao','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Data de implementação',
   'Data prevista (ou realizada) para a mudança entrar em vigor.',
   'Controla quando a mudança passa a valer, após aprovada e com as ações cumpridas.',
   '28/11/2026.',
   'Implementar antes de concluir as ações de controle.',
   'compliance',170,1,'publicado'),
  ('ehs.moc.status','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Situação',
   'Fase da mudança: rascunho, em análise, aprovada, reprovada, implementada ou cancelada.',
   'Mostra em que ponto do ciclo a mudança está.',
   'Passar para "aprovada" só depois da avaliação de risco e das ações definidas.',
   'Marcar "implementada" sem ter passado pela análise.',
   'compliance',180,1,'publicado'),
  ('ehs.moc.observacoes','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Observações',
   'Opcional: anotações sobre condições, restrições ou decisões da mudança.',
   'Guarda informações que não cabem nos demais campos.',
   '"Aprovada em comitê de SST em 20/11".',
   'Escrever aqui uma ação de controle que deveria estar na lista abaixo.',
   'compliance',190,1,'publicado'),
  ('ehs.moc.acoes','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Ações de controle',
   'Liste as ações que precisam ser feitas ANTES de implementar a mudança com segurança.',
   'Garante que o risco está tratado antes de a mudança entrar em vigor.',
   '"Instalar exaustão"; "Treinar a equipe no novo produto"; "Revisar a APR".',
   'Implementar a mudança com ações essenciais ainda em aberto.',
   'compliance',200,1,'publicado'),
  ('ehs.moc.acao_descricao','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Ação',
   'Escreva a ação de controle de forma objetiva, que dê para marcar como concluída.',
   'Cada ação vira um item conferível da mudança.',
   '"Revisar a ficha de segurança (FISPQ) do novo produto".',
   'Juntar várias ações numa só linha e não conseguir conferir uma a uma.',
   'compliance',210,1,'publicado'),
  ('ehs.moc.acao_responsavel','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Responsável pela ação',
   'Opcional: quem vai executar esta ação.',
   'Deixa claro de quem é a ação de controle.',
   '"Manutenção".',
   'Ação sem dono e ninguém executa.',
   'compliance',220,1,'publicado'),
  ('ehs.moc.acao_prazo','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Prazo da ação',
   'Opcional: a data-limite para concluir esta ação.',
   'Ajuda a cobrar as ações antes da implementação.',
   '27/11/2026.',
   'Prazo depois da data de implementação da mudança.',
   'compliance',230,1,'publicado'),
  ('ehs.moc.acao_concluido','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Concluída',
   'Marque quando a ação de controle estiver cumprida.',
   'Mostra o quanto das ações já foi feito antes de implementar.',
   'Marcar "Treinar a equipe" depois do treinamento realizado.',
   'Marcar como concluída uma ação que ainda não foi feita de verdade.',
   'compliance',240,1,'publicado'),
  ('ehs.moc.col_numero','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Coluna Mudança',
   'Mostra o número (se houver) e o título de cada mudança.',
   'Identifica a mudança na lista.',
   '"MOC-2026-007 · Troca do solvente".',
   'Confundir duas mudanças de título parecido.',
   'compliance',250,1,'publicado'),
  ('ehs.moc.col_tipo','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Coluna Tipo',
   'Mostra o tipo da mudança (equipamento, processo, layout...).',
   'Ajuda a agrupar e achar a mudança certa.',
   '"Material"; "Processo".',
   'Ler o tipo achando que é o risco.',
   'compliance',260,1,'publicado'),
  ('ehs.moc.col_area','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Coluna Área',
   'Mostra a área/setor afetado pela mudança.',
   'Localiza a mudança na lista.',
   '"Pintura".',
   'Achar que a mudança sem área informada não afeta ninguém.',
   'compliance',270,1,'publicado'),
  ('ehs.moc.col_risco','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Coluna Risco',
   'Mostra o nível de risco classificado da mudança.',
   'Deixa ver de relance o que exige mais atenção.',
   'Selo "Alto" nas mudanças de maior risco.',
   'Ignorar o risco alto e tratar todas as mudanças igual.',
   'compliance',280,1,'publicado'),
  ('ehs.moc.col_status','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Coluna Situação',
   'Mostra a fase da mudança (rascunho, em análise, aprovada...).',
   'Dá o andamento de cada mudança na lista.',
   'Selo "Aprovada" nas mudanças liberadas para implementar.',
   'Confundir "implementada" com "aprovada".',
   'compliance',290,1,'publicado'),
  ('ehs.moc.col_acoes','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Coluna Ações',
   'Editar abre a mudança e suas ações; Desativar tira a mudança das listas sem apagar o histórico.',
   'Mantém o registro vivo sem perder o que já foi analisado.',
   'Desativar uma mudança lançada por engano.',
   'Apagar quando o certo é desativar (o histórico some).',
   'compliance',300,1,'publicado'),
  ('ehs.moc.editar','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Editar',
   'Abre a mudança para mudar tipo, descrição, avaliação de risco, ações e situação.',
   'Deixa a mudança sempre atualizada sem criar outra do zero.',
   'Mudar o status para "aprovada" depois da análise.',
   'Criar uma mudança nova quando era só editar a atual.',
   'compliance',310,1,'publicado'),
  ('ehs.moc.desativar','/dashboard/ehs/trabalhos-risco/mudancas','Gestão de mudanças','Desativar',
   'Tira a mudança das listas, com um motivo, sem apagar o histórico (exclusão rastreável — RD-98).',
   'Aposenta um registro errado ou obsoleto preservando o rastro.',
   'Desativar "mudança lançada em duplicidade".',
   'Desativar sem informar o motivo e depois não lembrar por quê.',
   'compliance',320,1,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo, o_que_preencher=EXCLUDED.o_que_preencher,
  para_que_serve=EXCLUDED.para_que_serve, exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();

-- 5) blueprint vivo — marca só o requisito de M11 realmente entregue nesta fatia (RD-38) ───────────────
UPDATE public.blueprint_tela_requisito
   SET status_baseline='atendido',
       evidencia_baseline='Gestão de mudanças (MOC): tabela ehs_mudanca + ehs_mudanca_acao, tela /dashboard/ehs/trabalhos-risco/mudancas'
 WHERE vertical='ehs' AND tela_num=11
   AND requisito ILIKE 'Gestão de mudanças%';

-- 6) SEED DE DEMONSTRAÇÃO — SÓ na DEMO EHS b0700000-...-000b (fictício; NUNCA cliente real) ────────────
-- MOC 1: troca de solvente na pintura (alto risco, em análise)
INSERT INTO public.ehs_mudanca
  (company_id, numero, titulo, tipo, descricao, motivo, area, local, solicitante, data_solicitacao,
   nivel_risco, avaliacao_risco, responsavel_analise, status)
SELECT 'b0700000-0000-4000-a000-00000000000b','MOC-DEMO-001',
       'Troca do solvente da cabine de pintura','material',
       'Substituir o solvente atual por um de menor inflamabilidade e menor toxicidade na cabine 2.',
       'Reduzir o risco de incêndio e a exposição química da equipe de pintura.',
       'Pintura','Cabine 2, galpão A','Supervisor de produção', current_date,
       'alto','O novo solvente é menos inflamável, mas exige revisão da ventilação/exaustão, novo EPI respiratório e atualização da APR e da FISPQ.',
       'Engenheiro de Segurança','em_analise'
WHERE NOT EXISTS (SELECT 1 FROM public.ehs_mudanca m
  WHERE m.company_id='b0700000-0000-4000-a000-00000000000b' AND m.numero='MOC-DEMO-001');

-- MOC 2: novo layout da expedição (médio risco, aprovada)
INSERT INTO public.ehs_mudanca
  (company_id, numero, titulo, tipo, descricao, motivo, area, local, solicitante, data_solicitacao,
   nivel_risco, avaliacao_risco, responsavel_analise, data_implementacao, status)
SELECT 'b0700000-0000-4000-a000-00000000000b','MOC-DEMO-002',
       'Novo layout do fluxo de empilhadeiras na expedição','layout',
       'Separar as rotas de pedestres e de empilhadeiras com nova sinalização e faixas no piso.',
       'Eliminar o cruzamento de pedestres com empilhadeiras após quase-acidente.',
       'Logística','Expedição','Coordenador de logística', current_date - 5,
       'medio','Reduz o risco de atropelamento; exige sinalização, treinamento e período de adaptação com monitoramento.',
       'Técnico de Segurança', current_date + 7,'aprovada'
WHERE NOT EXISTS (SELECT 1 FROM public.ehs_mudanca m
  WHERE m.company_id='b0700000-0000-4000-a000-00000000000b' AND m.numero='MOC-DEMO-002');

-- Ações da MOC 1 (idempotentes por mudança + descrição)
INSERT INTO public.ehs_mudanca_acao (company_id, mudanca_id, ordem, descricao, responsavel, prazo, concluido)
SELECT 'b0700000-0000-4000-a000-00000000000b', m.id, v.ordem, v.descricao, v.responsavel, v.prazo, v.concluido
FROM public.ehs_mudanca m
JOIN (VALUES
  (1,'Revisar a ficha de segurança (FISPQ) do novo solvente','SST', current_date + 3, false),
  (2,'Avaliar e adequar a ventilação/exaustão da cabine','Manutenção', current_date + 7, false),
  (3,'Definir e providenciar o novo EPI respiratório','SST', current_date + 5, false),
  (4,'Treinar a equipe de pintura no novo produto','SST', current_date + 10, false)
) AS v(ordem, descricao, responsavel, prazo, concluido) ON true
WHERE m.company_id='b0700000-0000-4000-a000-00000000000b' AND m.numero='MOC-DEMO-001'
  AND NOT EXISTS (SELECT 1 FROM public.ehs_mudanca_acao a WHERE a.mudanca_id=m.id AND a.descricao=v.descricao);

-- Ações da MOC 2
INSERT INTO public.ehs_mudanca_acao (company_id, mudanca_id, ordem, descricao, responsavel, prazo, concluido)
SELECT 'b0700000-0000-4000-a000-00000000000b', m.id, v.ordem, v.descricao, v.responsavel, v.prazo, v.concluido
FROM public.ehs_mudanca m
JOIN (VALUES
  (1,'Pintar as faixas de pedestre e demarcar as rotas de empilhadeira','Manutenção', current_date + 2, true),
  (2,'Instalar a sinalização de segurança nos cruzamentos','Manutenção', current_date + 4, false),
  (3,'Treinar operadores e equipe sobre o novo fluxo','SST', current_date + 6, false)
) AS v(ordem, descricao, responsavel, prazo, concluido) ON true
WHERE m.company_id='b0700000-0000-4000-a000-00000000000b' AND m.numero='MOC-DEMO-002'
  AND NOT EXISTS (SELECT 1 FROM public.ehs_mudanca_acao a WHERE a.mudanca_id=m.id AND a.descricao=v.descricao);
