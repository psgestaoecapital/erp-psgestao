-- PS EHS · EHS-9c / M14 — Comissões e programas · Brigada de incêndio (NR-23)
-- (fatia 2: SIMULADOS / TREINOS DE ABANDONO da brigada)
--
-- Requisito do blueprint vivo (vertical 'ehs', M14 · onda E9):
--   • "Brigada (NR-23): Composição, treinos, simulados"
--     A fatia 1 (#5841, tabela ehs_brigada) entregou a COMPOSIÇÃO da brigada + a validade do
--     treinamento com alerta de reciclagem. ESTA fatia entrega os SIMULADOS/treinos de abandono:
--     registro do exercício (tipo, data, local, cenário), tempo de evacuação, participantes,
--     brigadistas presentes, avaliação, pontos de melhoria e a próxima data planejada. Com
--     composição + treinos + simulados cobertos, a linha do blueprint passa a 'atendido' (RD-38).
--
-- Company-scoped (RLS por empresa via get_user_company_ids(), mesmo padrão de compliance_* e das
-- fatias #5692/#5706/#5714/#5833/#5841). ADITIVA: 1 tabela nova, RLS ligada, REVOKE anon,
-- menu/tela 'completo' (gate #5114 — só DEMO/contratante vê; NÃO vaza p/ a Frioeste), ajuda
-- (RD-95), exclusão rastreável (RD-98 p4: quem + quando + motivo, sem apagar) e SEED FICTÍCIO
-- só na DEMO EHS (b0700000-...-000b). Não toca nenhuma estrutura existente. Nenhum dado de cliente real.

-- 1) Tabela ──────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ehs_brigada_simulado (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL,
  data_simulado          date NOT NULL,                 -- quando o simulado/treino foi realizado
  tipo                   text NOT NULL DEFAULT 'abandono'
                           CHECK (tipo IN ('abandono','combate_incendio','primeiros_socorros','evacuacao','vazamento','outros')),
  local                  text,                          -- setor/área/edificação do exercício
  cenario                text,                          -- descrição do cenário simulado
  duracao_min            numeric(6,1),                  -- duração total do exercício (minutos)
  tempo_evacuacao_min    numeric(6,1),                  -- tempo de abandono/evacuação (minutos)
  participantes          integer,                       -- nº de pessoas que participaram/evacuaram
  brigadistas_presentes  integer,                       -- nº de brigadistas que atuaram
  avaliacao              text CHECK (avaliacao IS NULL OR avaliacao IN ('otimo','bom','regular','ruim')),
  pontos_melhoria        text,                          -- o que precisa melhorar (vira ação no M10/M12)
  responsavel            text,                          -- coordenador/responsável pelo simulado
  proxima_data           date,                          -- próximo simulado planejado
  observacao             text,
  ativo                  boolean NOT NULL DEFAULT true,
  -- Exclusão rastreável (RD-98 p4): desativar guarda quem/quando/por quê, sem apagar o histórico.
  excluido_em            timestamptz,
  excluido_por           uuid,
  excluido_motivo        text,
  criado_por             uuid DEFAULT auth.uid(),
  criado_em              timestamptz NOT NULL DEFAULT now(),
  atualizado_em          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ehs_brigsim_empresa ON public.ehs_brigada_simulado (company_id, ativo, data_simulado DESC);
CREATE INDEX IF NOT EXISTS idx_ehs_brigsim_tipo    ON public.ehs_brigada_simulado (company_id, tipo);
CREATE INDEX IF NOT EXISTS idx_ehs_brigsim_proxima ON public.ehs_brigada_simulado (company_id, proxima_data);

-- 2) RLS por empresa (mesmo padrão de compliance_* / #5841: get_user_company_ids()) ──────────────────
ALTER TABLE public.ehs_brigada_simulado ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ehs_brigsim_select ON public.ehs_brigada_simulado;
DROP POLICY IF EXISTS ehs_brigsim_insert ON public.ehs_brigada_simulado;
DROP POLICY IF EXISTS ehs_brigsim_update ON public.ehs_brigada_simulado;
DROP POLICY IF EXISTS ehs_brigsim_delete ON public.ehs_brigada_simulado;
CREATE POLICY ehs_brigsim_select ON public.ehs_brigada_simulado FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_brigsim_insert ON public.ehs_brigada_simulado FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_brigsim_update ON public.ehs_brigada_simulado FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_brigsim_delete ON public.ehs_brigada_simulado FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

REVOKE ALL ON public.ehs_brigada_simulado FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ehs_brigada_simulado TO authenticated;
GRANT ALL ON public.ehs_brigada_simulado TO service_role;

-- 3) Menu + tela (NASCE ehs_modulo='completo' — gate #5114; NULL vazaria p/ todos) ────────────────────
INSERT INTO public.module_catalog
  (id, nome, rota, ativo, grupo, icone, ordem, subgrupo, descricao, is_shared, so_ps, legacy, so_demo, diferencial, rbac_isento, dependencies, surface_in_groups, ehs_modulo)
VALUES
  ('ehs_brigada_simulados', 'Simulados de abandono', '/dashboard/ehs/brigada/simulados', true, 'compliance', 'Flame', 28,
   'incidentes_riscos',
   'Simulados e treinos de abandono da brigada (NR-23): tipo, data, cenário, tempo de evacuação, participantes, avaliação e próxima data, por empresa.',
   true, false, false, false, false, false, ARRAY[]::text[], ARRAY[]::text[], 'completo')
ON CONFLICT (id) DO UPDATE SET ehs_modulo = EXCLUDED.ehs_modulo, rota = EXCLUDED.rota, ativo = EXCLUDED.ativo, nome = EXCLUDED.nome, descricao = EXCLUDED.descricao;

INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, auditavel_robo, estado_real, prioridade_monitoramento, auditada_ok)
VALUES
  ('dashboard.ehs_brigada_simulados', '/dashboard/ehs/brigada/simulados', 'compliance', 'Simulados de abandono',
   'Simulados/treinos de abandono da brigada (NR-23): registro do exercício (tipo, data, local, cenário), tempo de evacuação, participantes, brigadistas presentes, avaliação, pontos de melhoria e próxima data planejada, por empresa (M14 · NR-23). Piloto DEMO EHS.',
   true, 'desconhecida', 'alta', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, prioridade, descricao_executiva, descricao_tecnica)
VALUES ('F.ehs.brigada_simulados', 'ehs_brigada_simulados', 'compliance', 'Simulados de abandono', 'pronto', 100, 'alta',
        'Registro dos simulados de abandono da brigada com avaliação e próxima data.', 'ehs_brigada_simulado (RLS por empresa)')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.screen_route_features (screen_id, feature_id, peso)
VALUES ('dashboard.ehs_brigada_simulados', 'F.ehs.brigada_simulados', 1)
ON CONFLICT DO NOTHING;

-- 4) Ajuda de campo (RD-95) — uma chave por campo/coluna/filtro/ação da tela (1:1) ───────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.brigsim.empresa','/dashboard/ehs/brigada/simulados','Simulados de abandono','Empresa',
   'Quando você cuida de mais de uma empresa, escolha aqui em qual vai registrar o simulado.',
   'Define em qual empresa o simulado é salvo e filtra a lista ao lado.',
   'Escolher a planta onde o simulado foi feito antes de registrar.',
   'Registrar o simulado achando que está numa empresa e estar em outra.',
   'compliance',10,1,'publicado'),
  ('ehs.brigsim.busca','/dashboard/ehs/brigada/simulados','Simulados de abandono','Buscar',
   'Digite parte do local, do cenário ou do responsável para filtrar a lista.',
   'Ajuda a achar rápido um simulado quando há muitos registros.',
   '"Abate" para achar os simulados feitos no setor de abate.',
   'Esperar que a busca procure pela data: ela filtra por local, cenário e responsável.',
   'compliance',20,1,'publicado'),
  ('ehs.brigsim.filtro_tipo','/dashboard/ehs/brigada/simulados','Simulados de abandono','Filtro de tipo',
   'Filtre a lista pelo tipo de simulado: abandono, combate a incêndio, primeiros socorros, evacuação ou vazamento.',
   'Permite conferir rapidamente quantos simulados de cada tipo já foram feitos.',
   'Escolher "Abandono" para ver só os treinos de evacuação geral.',
   'Achar que não há simulados quando o filtro está escondendo os outros tipos.',
   'compliance',30,1,'publicado'),
  ('ehs.brigsim.filtro_avaliacao','/dashboard/ehs/brigada/simulados','Simulados de abandono','Filtro de avaliação',
   'Filtre pela avaliação do simulado: ótimo, bom, regular ou ruim.',
   'Deixa à mão os simulados que foram mal avaliados e precisam de novo treino.',
   'Escolher "Ruim" para ver os exercícios que geraram mais pontos de melhoria.',
   'Confundir avaliação do exercício com a aptidão de cada brigadista.',
   'compliance',40,1,'publicado'),
  ('ehs.brigsim.novo','/dashboard/ehs/brigada/simulados','Simulados de abandono','Registrar simulado',
   'Registra um simulado/treino de abandono novo na empresa escolhida.',
   'Abre o formulário com tipo, data, cenário, tempo de evacuação e participantes.',
   'Registrar o simulado de abandono feito hoje na expedição.',
   'Deixar de registrar um simulado e perder a evidência para a fiscalização.',
   'compliance',50,1,'publicado'),
  ('ehs.brigsim.tipo','/dashboard/ehs/brigada/simulados','Simulados de abandono','Tipo de simulado',
   'Escolha o tipo: abandono, combate a incêndio, primeiros socorros, evacuação ou vazamento.',
   'Organiza os exercícios por tipo e ajuda a cobrir todos os cenários exigidos.',
   '"Abandono" para o treino de evacuação geral da planta.',
   'Classificar tudo como "outros" e perder a visão por tipo de cenário.',
   'compliance',60,1,'publicado'),
  ('ehs.brigsim.data','/dashboard/ehs/brigada/simulados','Simulados de abandono','Data do simulado',
   'Informe a data em que o simulado foi realizado.',
   'É a referência do exercício e base para planejar o próximo.',
   'A data em que a evacuação foi feita de verdade.',
   'Informar a data de hoje quando o simulado foi em outro dia.',
   'compliance',70,1,'publicado'),
  ('ehs.brigsim.local','/dashboard/ehs/brigada/simulados','Simulados de abandono','Local',
   'Informe o setor, a área ou a edificação onde o simulado aconteceu.',
   'Permite ver a cobertura dos simulados por área da planta.',
   '"Expedição"; "Bloco A"; "Toda a planta".',
   'Deixar o local em branco e não saber qual área foi treinada.',
   'compliance',80,1,'publicado'),
  ('ehs.brigsim.cenario','/dashboard/ehs/brigada/simulados','Simulados de abandono','Cenário',
   'Descreva o cenário simulado (o que foi encenado no exercício).',
   'Guarda o contexto do treino para análise e para a auditoria.',
   '"Princípio de incêndio na câmara fria com evacuação total".',
   'Escrever só "simulado" e não registrar o que foi encenado.',
   'compliance',90,1,'publicado'),
  ('ehs.brigsim.duracao','/dashboard/ehs/brigada/simulados','Simulados de abandono','Duração (min)',
   'Opcional: a duração total do exercício, em minutos.',
   'Dá a dimensão do tempo gasto no simulado completo.',
   '"30" para um exercício de meia hora.',
   'Confundir a duração total com o tempo de evacuação.',
   'compliance',100,1,'publicado'),
  ('ehs.brigsim.tempo_evacuacao','/dashboard/ehs/brigada/simulados','Simulados de abandono','Tempo de evacuação (min)',
   'Opcional: o tempo que levou para evacuar/abandonar a área, em minutos.',
   'É o indicador-chave do simulado de abandono: quanto menor, melhor.',
   '"4,5" se a evacuação levou quatro minutos e meio.',
   'Registrar a duração total no lugar do tempo de evacuação.',
   'compliance',110,1,'publicado'),
  ('ehs.brigsim.participantes','/dashboard/ehs/brigada/simulados','Simulados de abandono','Participantes',
   'Opcional: o número de pessoas que participaram/evacuaram.',
   'Mostra o alcance do simulado na empresa.',
   '"120" para um abandono com 120 pessoas.',
   'Contar só os brigadistas e não as pessoas evacuadas.',
   'compliance',120,1,'publicado'),
  ('ehs.brigsim.brigadistas','/dashboard/ehs/brigada/simulados','Simulados de abandono','Brigadistas presentes',
   'Opcional: quantos brigadistas atuaram no simulado.',
   'Ajuda a avaliar se a brigada tem gente suficiente atuando nos exercícios.',
   '"6" brigadistas conduzindo a evacuação.',
   'Contar os participantes gerais no lugar dos brigadistas.',
   'compliance',130,1,'publicado'),
  ('ehs.brigsim.avaliacao','/dashboard/ehs/brigada/simulados','Simulados de abandono','Avaliação',
   'Opcional: como foi o desempenho do simulado — ótimo, bom, regular ou ruim.',
   'Resume o resultado do exercício e alimenta o filtro de avaliação.',
   '"Regular" quando a evacuação demorou mais do que o esperado.',
   'Marcar "ótimo" mesmo com vários pontos de melhoria anotados.',
   'compliance',140,1,'publicado'),
  ('ehs.brigsim.responsavel','/dashboard/ehs/brigada/simulados','Simulados de abandono','Responsável',
   'Opcional: quem coordenou/conduziu o simulado.',
   'Guarda quem respondeu pelo exercício para a auditoria.',
   '"Ana Ferreira (coordenadora da brigada)".',
   'Deixar em branco e não saber quem conduziu o treino.',
   'compliance',150,1,'publicado'),
  ('ehs.brigsim.proxima_data','/dashboard/ehs/brigada/simulados','Simulados de abandono','Próximo simulado',
   'Opcional: a data planejada para o próximo simulado.',
   'Ajuda a manter a periodicidade dos exercícios exigida pela NR-23.',
   'Em geral o próximo exercício dentro de um ano.',
   'Não planejar o próximo e deixar a brigada sem treino por muito tempo.',
   'compliance',160,1,'publicado'),
  ('ehs.brigsim.pontos_melhoria','/dashboard/ehs/brigada/simulados','Simulados de abandono','Pontos de melhoria',
   'Opcional: o que precisa melhorar a partir do que o simulado mostrou.',
   'Registra as falhas observadas para virarem ação (plano de ação do EHS).',
   '"Sinalização de saída apagada no corredor B".',
   'Anotar os pontos e não abrir nenhuma ação para corrigi-los.',
   'compliance',170,1,'publicado'),
  ('ehs.brigsim.observacao','/dashboard/ehs/brigada/simulados','Simulados de abandono','Observação',
   'Opcional: qualquer observação sobre o simulado.',
   'Guarda detalhes úteis para a análise e para o próximo exercício.',
   '"Chuva no dia; parte externa adiada".',
   'Misturar o que é ponto de melhoria com observação geral.',
   'compliance',180,1,'publicado'),
  ('ehs.brigsim.col_simulado','/dashboard/ehs/brigada/simulados','Simulados de abandono','Coluna Simulado',
   'Mostra o tipo do simulado e a data em que foi realizado.',
   'Identifica rapidamente cada exercício na lista.',
   '"Abandono · 20/11/2026".',
   'Procurar o responsável na coluna do simulado.',
   'compliance',190,1,'publicado'),
  ('ehs.brigsim.col_local','/dashboard/ehs/brigada/simulados','Simulados de abandono','Coluna Local',
   'Mostra o local/área do simulado e o cenário encenado.',
   'Ajuda a ver onde cada exercício foi feito.',
   '"Expedição · princípio de incêndio".',
   'Achar que um simulado sem local não vale — o local é opcional.',
   'compliance',200,1,'publicado'),
  ('ehs.brigsim.col_participacao','/dashboard/ehs/brigada/simulados','Simulados de abandono','Coluna Participação',
   'Mostra o tempo de evacuação, os participantes e os brigadistas presentes.',
   'Resume o desempenho e o alcance do exercício.',
   '"4,5 min · 120 pessoas · 6 brigadistas".',
   'Ler o tempo de evacuação como se fosse a duração total.',
   'compliance',210,1,'publicado'),
  ('ehs.brigsim.col_avaliacao','/dashboard/ehs/brigada/simulados','Simulados de abandono','Coluna Avaliação',
   'Mostra a avaliação do simulado e sinaliza quando há pontos de melhoria.',
   'Deixa à vista os exercícios que precisam de atenção.',
   '"Regular · com pontos de melhoria".',
   'Ignorar os pontos de melhoria quando a avaliação é boa.',
   'compliance',220,1,'publicado'),
  ('ehs.brigsim.col_proxima','/dashboard/ehs/brigada/simulados','Simulados de abandono','Coluna Próximo',
   'Mostra a data planejada do próximo simulado e sinaliza quando já passou.',
   'Lembra de manter a periodicidade dos exercícios.',
   '"Próximo 15/05/2027".',
   'Esquecer de reagendar quando a data do próximo já passou.',
   'compliance',230,1,'publicado'),
  ('ehs.brigsim.col_acoes','/dashboard/ehs/brigada/simulados','Simulados de abandono','Coluna Ações',
   'Editar abre o simulado para ajustar os dados; Desativar tira o registro das listas sem apagar o histórico.',
   'Mantém o registro vivo sem perder o que já foi anotado.',
   'Desativar um registro lançado em duplicidade, informando o motivo.',
   'Apagar quando o certo é desativar (o histórico some).',
   'compliance',240,1,'publicado'),
  ('ehs.brigsim.editar','/dashboard/ehs/brigada/simulados','Simulados de abandono','Editar',
   'Abre o simulado para mudar tipo, data, cenário, tempos e avaliação.',
   'Deixa o registro correto para a análise e a auditoria.',
   'Corrigir o tempo de evacuação lançado errado.',
   'Criar outro registro quando era só editar o atual.',
   'compliance',250,1,'publicado'),
  ('ehs.brigsim.desativar','/dashboard/ehs/brigada/simulados','Simulados de abandono','Desativar',
   'Tira o simulado das listas, com um motivo, sem apagar o histórico (exclusão rastreável — RD-98).',
   'Corrige um registro errado ou duplicado sem perder o histórico.',
   'Desativar um registro duplicado, informando "duplicado".',
   'Desativar sem informar o motivo e depois não lembrar por quê.',
   'compliance',260,1,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo, o_que_preencher=EXCLUDED.o_que_preencher,
  para_que_serve=EXCLUDED.para_que_serve, exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();

-- 5) Blueprint vivo — composição + treinos + simulados cobertos → atendido (RD-38) ────────────────────
UPDATE public.blueprint_tela_requisito
   SET status_baseline='atendido',
       evidencia_baseline='Composição + validade de treinamento (#5841 · /dashboard/ehs/brigada) e simulados/treinos de abandono (PR fatia 2 · /dashboard/ehs/brigada/simulados)'
 WHERE vertical='ehs' AND tela_num=14 AND requisito LIKE 'Brigada (NR-23)%';

-- 6) SEED DE DEMONSTRAÇÃO — SÓ na DEMO EHS b0700000-...-000b (fictício; NUNCA cliente real) ────────────
INSERT INTO public.ehs_brigada_simulado
  (company_id, data_simulado, tipo, local, cenario, duracao_min, tempo_evacuacao_min, participantes,
   brigadistas_presentes, avaliacao, pontos_melhoria, responsavel, proxima_data, observacao)
SELECT v.company_id, v.data_simulado, v.tipo, v.local, v.cenario, v.duracao_min, v.tempo_evacuacao_min,
       v.participantes, v.brigadistas_presentes, v.avaliacao, v.pontos_melhoria, v.responsavel, v.proxima_data, v.observacao
FROM (VALUES
  ('b0700000-0000-4000-a000-00000000000b'::uuid, (CURRENT_DATE - 20), 'abandono', 'Toda a planta',
     'Princípio de incêndio na câmara fria com evacuação geral', 35.0, 4.5, 120, 6, 'bom',
     'Sinalização de saída apagada no corredor B', 'Ana Ferreira (coordenadora)', (CURRENT_DATE + 160),
     'Simulado anual de abandono'),
  ('b0700000-0000-4000-a000-00000000000b'::uuid, (CURRENT_DATE - 95), 'combate_incendio', 'Expedição',
     'Combate a princípio de incêndio com extintor PQS', 25.0, NULL, 18, 4, 'otimo',
     NULL, 'Carlos Souza (chefe de turno)', (CURRENT_DATE + 85),
     'Treino prático de combate com equipamento'),
  ('b0700000-0000-4000-a000-00000000000b'::uuid, (CURRENT_DATE - 160), 'evacuacao', 'Bloco administrativo',
     'Evacuação do bloco administrativo por vazamento de amônia', 40.0, 7.2, 45, 3, 'regular',
     'Tempo de evacuação acima da meta; revisar rota do 2º andar', 'Juliana Alves (líder)', (CURRENT_DATE - 5),
     'Reagendar: próxima data já venceu')
) AS v(company_id, data_simulado, tipo, local, cenario, duracao_min, tempo_evacuacao_min, participantes,
       brigadistas_presentes, avaliacao, pontos_melhoria, responsavel, proxima_data, observacao)
WHERE NOT EXISTS (
  SELECT 1 FROM public.ehs_brigada_simulado e
   WHERE e.company_id = v.company_id AND e.data_simulado = v.data_simulado AND e.tipo = v.tipo
);
