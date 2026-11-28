-- PS EHS · EHS-7 / M10 — Campo digital: RELATO DE QUASE-ACIDENTE (near-miss)
--
-- Requisito do blueprint vivo (vertical 'ehs', M10 · onda E3/E7):
--   "Relato de quase-acidente: App, WhatsApp ou QR em 30 s, anônimo opcional".
-- Qualquer pessoa da operação registra, em poucos toques, um quase-acidente / condição insegura / ato
-- inseguro (o que quase deu errado), opcionalmente de forma ANÔNIMA (sem registrar o nome de quem relatou).
-- O time de SST trata o relato (status aberto → em análise → tratado → encerrado). A geração automática de
-- plano de ação a partir do relato é a PRÓXIMA fatia (reusa o plano de ação do M10/M12); por isso o
-- blueprint fica 'parcial'. O relato público SEM login (QR/WhatsApp de visitante) também é fatia futura
-- (precisa de RPC pública/edge) — aqui o relato anônimo é registrado por um usuário logado em nome de quem
-- não quer se identificar, e o QR abre o formulário rápido já autenticado.
--
-- Company-scoped (RLS por empresa via get_user_company_ids(), igual a ehs_dds / compliance_*). ADITIVA:
-- 1 tabela nova, RLS ligada, REVOKE anon, menu/tela 'completo' (gate #5114 — só DEMO/contratante vê),
-- ajuda (RD-95), exclusão rastreável COM motivo (RD-98 p4) e SEED FICTÍCIO só na DEMO EHS
-- (b0700000-...-000b). Nada de dado de cliente real. Não toca nenhuma estrutura existente.

-- 1) Tabela ──────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ehs_relato_quase_acidente (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL,
  data_ocorrencia    date NOT NULL DEFAULT CURRENT_DATE,
  hora_ocorrencia    time,
  local              text,
  setor              text,
  tipo               text NOT NULL DEFAULT 'quase_acidente'
                       CHECK (tipo IN ('quase_acidente','condicao_insegura','ato_inseguro','outro')),
  gravidade_potencial text CHECK (gravidade_potencial IN ('baixa','media','alta')),
  descricao          text NOT NULL,
  acao_imediata      text,
  anonimo            boolean NOT NULL DEFAULT false,
  relator_nome       text,
  relator_contato    text,
  origem             text NOT NULL DEFAULT 'app'
                       CHECK (origem IN ('app','qr','whatsapp')),
  status             text NOT NULL DEFAULT 'aberto'
                       CHECK (status IN ('aberto','em_analise','tratado','encerrado')),
  observacoes        text,
  ativo              boolean NOT NULL DEFAULT true,
  excluido_em        timestamptz,
  excluido_por       uuid,
  excluido_motivo    text,
  criado_por         uuid DEFAULT auth.uid(),
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);

-- Anônimo nunca grava nome do relator (garantia no banco, não só na tela)
ALTER TABLE public.ehs_relato_quase_acidente
  DROP CONSTRAINT IF EXISTS chk_ehs_relato_anonimo;
ALTER TABLE public.ehs_relato_quase_acidente
  ADD CONSTRAINT chk_ehs_relato_anonimo CHECK (NOT anonimo OR relator_nome IS NULL);

CREATE INDEX IF NOT EXISTS idx_ehs_relato_empresa
  ON public.ehs_relato_quase_acidente (company_id, ativo, data_ocorrencia DESC);
CREATE INDEX IF NOT EXISTS idx_ehs_relato_status
  ON public.ehs_relato_quase_acidente (company_id, status) WHERE ativo;

-- 2) RLS por empresa (mesmo padrão de ehs_dds / compliance_*: get_user_company_ids()) ──────────────────
ALTER TABLE public.ehs_relato_quase_acidente ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ehs_relato_select ON public.ehs_relato_quase_acidente;
DROP POLICY IF EXISTS ehs_relato_insert ON public.ehs_relato_quase_acidente;
DROP POLICY IF EXISTS ehs_relato_update ON public.ehs_relato_quase_acidente;
DROP POLICY IF EXISTS ehs_relato_delete ON public.ehs_relato_quase_acidente;
CREATE POLICY ehs_relato_select ON public.ehs_relato_quase_acidente FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_relato_insert ON public.ehs_relato_quase_acidente FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_relato_update ON public.ehs_relato_quase_acidente FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_relato_delete ON public.ehs_relato_quase_acidente FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

REVOKE ALL ON public.ehs_relato_quase_acidente FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ehs_relato_quase_acidente TO authenticated;
GRANT ALL ON public.ehs_relato_quase_acidente TO service_role;

-- 3) Menu + tela (NASCE ehs_modulo='completo' — gate #5114; NULL vazaria p/ todos) ─────────────────────
INSERT INTO public.module_catalog
  (id, nome, rota, ativo, grupo, icone, ordem, subgrupo, descricao, is_shared, so_ps, legacy, so_demo, diferencial, rbac_isento, dependencies, surface_in_groups, ehs_modulo)
VALUES
  ('ehs_relato_quase_acidente', 'Relato de quase-acidente', '/dashboard/ehs/relato-quase-acidente', true, 'compliance', 'TriangleAlert', 24,
   'incidentes_riscos',
   'Registre em poucos toques um quase-acidente, condição ou ato inseguro — anônimo se quiser — e acompanhe o tratamento.',
   true, false, false, false, false, false, ARRAY[]::text[], ARRAY[]::text[], 'completo')
ON CONFLICT (id) DO UPDATE SET ehs_modulo = EXCLUDED.ehs_modulo, rota = EXCLUDED.rota, ativo = EXCLUDED.ativo, nome = EXCLUDED.nome, descricao = EXCLUDED.descricao;

INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, auditavel_robo, estado_real, prioridade_monitoramento, auditada_ok)
VALUES
  ('dashboard.ehs_relato_quase_acidente', '/dashboard/ehs/relato-quase-acidente', 'compliance', 'Relato de quase-acidente',
   'Relato rápido de quase-acidente / condição insegura / ato inseguro (M10), anônimo opcional, com acompanhamento do tratamento (aberto→em análise→tratado→encerrado), por empresa. Piloto DEMO EHS.',
   true, 'desconhecida', 'alta', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, prioridade, descricao_executiva, descricao_tecnica)
VALUES ('F.ehs.relato_quase_acidente', 'ehs_relato_quase_acidente', 'compliance', 'Relato de quase-acidente', 'pronto', 100, 'alta',
        'Relato rápido de quase-acidente, anônimo opcional, com tratamento por status.', 'ehs_relato_quase_acidente (RLS por empresa; exclusão rastreável RD-98)')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.screen_route_features (screen_id, feature_id, peso)
VALUES ('dashboard.ehs_relato_quase_acidente', 'F.ehs.relato_quase_acidente', 1)
ON CONFLICT DO NOTHING;

-- 4) Ajuda de campo (RD-95) — uma chave por campo/coluna/ação da tela ──────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.relato.empresa','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Empresa',
   'Quando você cuida de mais de uma empresa, escolha aqui em qual vai registrar o relato.',
   'Define em qual empresa o relato é salvo e filtra a lista ao lado.',
   'Escolher a empresa onde o quase-acidente aconteceu.',
   'Registrar o relato achando que está numa empresa e estar em outra.',
   'compliance',10,1,'publicado'),
  ('ehs.relato.busca','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Buscar',
   'Digite parte da descrição, do local ou do setor para filtrar a lista.',
   'Ajuda a achar rápido um relato quando há muitos registros.',
   '"empilhadeira" para achar os relatos perto da empilhadeira.',
   'Esperar que a busca procure pelo nome de quem relatou (relatos anônimos não têm nome).',
   'compliance',20,1,'publicado'),
  ('ehs.relato.filtro_status','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Filtrar por situação',
   'Escolha para ver só os relatos em uma situação (aberto, em análise, tratado, encerrado).',
   'Deixa à vista o que ainda precisa de ação.',
   'Filtrar por "Aberto" para ver o que falta tratar.',
   'Esquecer o filtro ligado e achar que não há relatos novos.',
   'compliance',30,1,'publicado'),
  ('ehs.relato.novo','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Novo relato',
   'Abre o formulário rápido para registrar um quase-acidente, condição ou ato inseguro.',
   'Guarda o que quase deu errado para que a SST possa agir antes do acidente.',
   'Registrar que uma caixa quase caiu de uma prateleira solta.',
   'Deixar de relatar porque "não houve acidente" — o quase-acidente é justamente o que se quer saber.',
   'compliance',40,1,'publicado'),
  ('ehs.relato.qr','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','QR do relato rápido',
   'Mostra um QR que abre direto o formulário de relato rápido no celular.',
   'Cole o QR no mural/chão de fábrica: qualquer um aponta a câmera e relata em segundos.',
   'Imprimir o QR e fixar na entrada de cada setor.',
   'Esperar que o QR funcione sem o trabalhador estar logado — por enquanto ele abre o app já autenticado.',
   'compliance',50,1,'publicado'),
  ('ehs.relato.data_ocorrencia','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Data da ocorrência',
   'Informe o dia em que o quase-acidente aconteceu.',
   'Organiza os relatos na linha do tempo e ajuda a investigar.',
   'A data de hoje, se acabou de acontecer.',
   'Colocar a data em que você está digitando quando a ocorrência foi em outro dia.',
   'compliance',60,1,'publicado'),
  ('ehs.relato.hora_ocorrencia','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Hora',
   'Opcional: a hora aproximada em que aconteceu.',
   'Ajuda a cruzar com turno, escala e outras ocorrências.',
   '"14:30", logo após o almoço.',
   'Gastar tempo buscando o minuto exato — a hora aproximada já ajuda.',
   'compliance',70,1,'publicado'),
  ('ehs.relato.local','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Local',
   'Onde aconteceu (ponto, máquina, corredor, área).',
   'Permite ir ao ponto exato e tratar o risco onde ele está.',
   '"Corredor da expedição, perto da doca 2".',
   'Descrever o local de forma vaga ("lá no fundo") que ninguém acha depois.',
   'compliance',80,1,'publicado'),
  ('ehs.relato.setor','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Setor',
   'Opcional: o setor ou a equipe onde aconteceu.',
   'Permite acompanhar os relatos por setor e ver onde se concentram.',
   '"Abate"; "Expedição"; "Manutenção".',
   'Deixar em branco quando o setor ajudaria a priorizar.',
   'compliance',90,1,'publicado'),
  ('ehs.relato.tipo','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Tipo',
   'Escolha o que melhor descreve: quase-acidente, condição insegura, ato inseguro ou outro.',
   'Classifica o relato para medir e priorizar por tipo.',
   '"Condição insegura" para uma guarda de máquina faltando.',
   'Marcar tudo como "outro" — a classificação perde valor.',
   'compliance',100,1,'publicado'),
  ('ehs.relato.gravidade_potencial','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Gravidade potencial',
   'O quanto PODERIA ter sido grave se tivesse virado acidente (baixa, média, alta).',
   'Ajuda a tratar primeiro o que tem maior potencial de dano.',
   '"Alta" para algo que quase causou uma queda de altura.',
   'Avaliar pelo que aconteceu (nada) em vez do que poderia ter acontecido.',
   'compliance',110,1,'publicado'),
  ('ehs.relato.descricao','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','O que aconteceu',
   'Conte, com suas palavras, o que quase deu errado.',
   'É o coração do relato: o que a SST vai analisar e tratar.',
   '"Uma caixa escorregou da prateleira e caiu a 1 m de um colega".',
   'Escrever só "quase caiu" sem dizer o quê, onde e o risco.',
   'compliance',120,1,'publicado'),
  ('ehs.relato.acao_imediata','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Ação imediata tomada',
   'Opcional: o que já foi feito na hora (isolou a área, avisou o líder, retirou o objeto).',
   'Registra a resposta imediata e evita que o risco siga ativo.',
   '"Isolei o corredor e avisei o encarregado".',
   'Confundir a ação imediata com o plano de ação definitivo (esse vem depois).',
   'compliance',130,1,'publicado'),
  ('ehs.relato.anonimo','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Relato anônimo',
   'Marque se quem relatou prefere não se identificar.',
   'Dá segurança para relatar sem medo — o nome não é guardado quando marcado.',
   'Marcar ao registrar em nome de um colega que pediu sigilo.',
   'Marcar anônimo e mesmo assim tentar preencher o nome (o sistema não guarda o nome).',
   'compliance',140,1,'publicado'),
  ('ehs.relato.relator_nome','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Nome de quem relatou',
   'Opcional (e desabilitado quando o relato é anônimo): o nome de quem relatou.',
   'Permite dar retorno a quem relatou e reconhecer a atitude.',
   '"Maria Souza".',
   'Preencher o nome e marcar anônimo ao mesmo tempo.',
   'compliance',150,1,'publicado'),
  ('ehs.relato.relator_contato','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Contato de quem relatou',
   'Opcional (desabilitado se anônimo): telefone/ramal/e-mail para retorno.',
   'Permite voltar com dúvidas ou dar o retorno do tratamento.',
   'Ramal 2045 ou o WhatsApp do relator.',
   'Pedir contato num relato anônimo.',
   'compliance',160,1,'publicado'),
  ('ehs.relato.origem','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Origem',
   'Como o relato chegou: pelo app, por QR ou por WhatsApp.',
   'Ajuda a ver por onde as pessoas mais relatam e incentivar o canal.',
   '"QR" quando a pessoa apontou a câmera no cartaz.',
   'Trocar a origem depois achando que muda o canal real.',
   'compliance',170,1,'publicado'),
  ('ehs.relato.status','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Situação',
   'A situação do tratamento: aberto, em análise, tratado ou encerrado.',
   'Mostra o que ainda precisa de ação e o que já foi resolvido.',
   'Passar para "Tratado" quando o risco foi eliminado.',
   'Encerrar sem tratar — o risco segue ativo.',
   'compliance',180,1,'publicado'),
  ('ehs.relato.observacoes','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Observações',
   'Opcional: anotações da SST durante a análise e o tratamento.',
   'Guarda o histórico de análise que não cabe na descrição.',
   '"Verificado com a manutenção; prateleira trocada em 22/11".',
   'Apagar a descrição original do relator para escrever a análise no lugar.',
   'compliance',190,1,'publicado'),
  ('ehs.relato.col_data','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Coluna Data',
   'Mostra o dia da ocorrência de cada relato.',
   'Ordena do mais recente para o mais antigo.',
   '"20/11/2026".',
   'Confundir a data da ocorrência com a data em que foi digitado.',
   'compliance',200,1,'publicado'),
  ('ehs.relato.col_tipo','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Coluna Tipo',
   'Mostra o tipo de cada relato.',
   'Permite ver de relance a natureza do risco.',
   '"Condição insegura".',
   'Ignorar o tipo ao priorizar.',
   'compliance',210,1,'publicado'),
  ('ehs.relato.col_local','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Coluna Local/Setor',
   'Mostra onde cada relato aconteceu.',
   'Ajuda a ver onde os riscos se concentram.',
   '"Expedição — doca 2".',
   'Achar que um relato sem setor não vale — o setor é opcional.',
   'compliance',220,1,'publicado'),
  ('ehs.relato.col_gravidade','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Coluna Gravidade',
   'Mostra a gravidade potencial de cada relato.',
   'Deixa à vista o que tem maior potencial de dano.',
   '"Alta".',
   'Tratar os de baixa gravidade antes dos de alta.',
   'compliance',230,1,'publicado'),
  ('ehs.relato.col_status','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Coluna Situação',
   'Mostra a situação do tratamento de cada relato.',
   'Permite acompanhar o andamento sem abrir cada um.',
   '"Aberto".',
   'Achar que "encerrado" sempre quer dizer que foi tratado — confira o histórico.',
   'compliance',240,1,'publicado'),
  ('ehs.relato.col_acoes','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Coluna Ações',
   'Abrir mostra o relato e permite mudar a situação; Desativar tira o relato das listas sem apagar o histórico.',
   'Mantém o registro vivo sem perder o que já foi feito.',
   'Desativar um relato duplicado, informando o motivo.',
   'Apagar quando o certo é desativar (o histórico some).',
   'compliance',250,1,'publicado'),
  ('ehs.relato.editar','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Abrir / tratar',
   'Abre o relato para acompanhar, mudar a situação e anotar a análise.',
   'Deixa o tratamento sempre atualizado.',
   'Passar de "Aberto" para "Em análise" e anotar o que foi verificado.',
   'Criar outro relato quando era só atualizar o atual.',
   'compliance',260,1,'publicado'),
  ('ehs.relato.desativar','/dashboard/ehs/relato-quase-acidente','Relato de quase-acidente','Desativar',
   'Tira o relato das listas, com um motivo, sem apagar o histórico (exclusão rastreável — RD-98).',
   'Corrige um lançamento errado sem perder o registro.',
   'Desativar um relato duplicado, informando "duplicado".',
   'Desativar sem informar o motivo e depois não lembrar por quê.',
   'compliance',270,1,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo, o_que_preencher=EXCLUDED.o_que_preencher,
  para_que_serve=EXCLUDED.para_que_serve, exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();

-- 5) SEED DE DEMONSTRAÇÃO — SÓ na DEMO EHS b0700000-...-000b (fictício; NUNCA cliente real) ─────────────
INSERT INTO public.ehs_relato_quase_acidente
  (company_id, data_ocorrencia, hora_ocorrencia, local, setor, tipo, gravidade_potencial, descricao, acao_imediata, anonimo, relator_nome, origem, status, observacoes)
SELECT 'b0700000-0000-4000-a000-00000000000b', CURRENT_DATE, '14:20', 'Corredor da expedição, perto da doca 2', 'Expedição',
       'quase_acidente','alta',
       'Uma caixa escorregou de uma prateleira solta e caiu a cerca de 1 metro de um colega que passava.',
       'Isolei o corredor e avisei o encarregado da expedição.', false, 'Maria Souza', 'app', 'aberto', NULL
WHERE NOT EXISTS (SELECT 1 FROM public.ehs_relato_quase_acidente r
  WHERE r.company_id='b0700000-0000-4000-a000-00000000000b' AND r.data_ocorrencia=CURRENT_DATE
    AND lower(r.descricao) LIKE lower('Uma caixa escorregou%'));

INSERT INTO public.ehs_relato_quase_acidente
  (company_id, data_ocorrencia, hora_ocorrencia, local, setor, tipo, gravidade_potencial, descricao, acao_imediata, anonimo, origem, status, observacoes)
SELECT 'b0700000-0000-4000-a000-00000000000b', CURRENT_DATE - 1, '09:10', 'Sala de máquinas da serra fita', 'Abate',
       'condicao_insegura','media',
       'Guarda de proteção da serra fita estava frouxa, podendo expor a lâmina durante a operação.',
       NULL, true, 'qr', 'em_analise', 'Manutenção acionada para reapertar e inspecionar a guarda.'
WHERE NOT EXISTS (SELECT 1 FROM public.ehs_relato_quase_acidente r
  WHERE r.company_id='b0700000-0000-4000-a000-00000000000b' AND r.data_ocorrencia=CURRENT_DATE - 1
    AND lower(r.descricao) LIKE lower('Guarda de proteção da serra%'));

INSERT INTO public.ehs_relato_quase_acidente
  (company_id, data_ocorrencia, hora_ocorrencia, local, setor, tipo, gravidade_potencial, descricao, acao_imediata, anonimo, origem, status, observacoes)
SELECT 'b0700000-0000-4000-a000-00000000000b', CURRENT_DATE - 3, '16:45', 'Rampa de acesso ao vestiário', 'Geral',
       'ato_inseguro','baixa',
       'Colega desceu a rampa correndo com as mãos ocupadas; quase escorregou no piso molhado.',
       'Conversa no local sobre não correr e sinalização de piso molhado.', false, 'whatsapp', 'tratado',
       'Colocada placa de piso molhado e reforçado no DDS do dia seguinte.'
WHERE NOT EXISTS (SELECT 1 FROM public.ehs_relato_quase_acidente r
  WHERE r.company_id='b0700000-0000-4000-a000-00000000000b' AND r.data_ocorrencia=CURRENT_DATE - 3
    AND lower(r.descricao) LIKE lower('Colega desceu a rampa%'));
