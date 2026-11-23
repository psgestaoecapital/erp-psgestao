-- PS EHS · EHS-9c / M14 — Comissões e programas · SIPAT (Semana Interna de Prevenção de Acidentes)
-- (fatia 1: EDIÇÕES da SIPAT — ano, tema, período, status, responsável, público-alvo e participação)
--
-- Requisito do blueprint vivo (vertical 'ehs', M14 · onda E9):
--   • "SIPAT" -> esta fatia entrega o REGISTRO DAS EDIÇÕES da SIPAT (uma por ano), com tema, período,
--      status, responsável (organização pela CIPA — NR-5), público-alvo, local e participação
--      (prevista × realizada). A PROGRAMAÇÃO diária (palestras, dinâmicas, presença por atividade)
--      vem na próxima fatia -> por isso o blueprint fica 'parcial' (RD-38: só o que realmente entregou).
--
-- Company-scoped (RLS por empresa via get_user_company_ids(), igual a compliance_* e às fatias
-- #5692/#5706/#5714/#5833/#5841). ADITIVA: 1 tabela nova, RLS ligada, REVOKE anon, menu/tela
-- 'completo' (gate #5114 — só DEMO/contratante vê; NÃO vaza p/ a Frioeste), ajuda (RD-95), exclusão
-- rastreável (RD-98 p4: quem + quando + motivo, sem apagar) e SEED FICTÍCIO só na DEMO EHS
-- (b0700000-...-000b). Não toca nenhuma estrutura existente. Nenhum dado de cliente real.

-- 1) Tabela ──────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ehs_sipat (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL,
  ano                      integer NOT NULL,                 -- ano da edição da SIPAT
  tema                     text NOT NULL,                    -- tema/título da edição
  data_inicio              date,                             -- início da semana
  data_fim                 date,                             -- fim da semana
  status                   text NOT NULL DEFAULT 'planejada'
                             CHECK (status IN ('planejada','em_andamento','realizada','cancelada')),
  responsavel              text,                             -- organizador (CIPA / coordenação)
  publico_alvo             text,                             -- a quem se destina (setores, turnos, todos)
  local_evento             text,                             -- onde acontece
  participantes_previstos  integer CHECK (participantes_previstos IS NULL OR participantes_previstos >= 0),
  participantes_realizados integer CHECK (participantes_realizados IS NULL OR participantes_realizados >= 0),
  observacao               text,
  ativo                    boolean NOT NULL DEFAULT true,
  -- Exclusão rastreável (RD-98 p4): desativar guarda quem/quando/por quê, sem apagar o histórico.
  excluido_em              timestamptz,
  excluido_por             uuid,
  excluido_motivo          text,
  criado_por               uuid DEFAULT auth.uid(),
  criado_em                timestamptz NOT NULL DEFAULT now(),
  atualizado_em            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ehs_sipat_empresa ON public.ehs_sipat (company_id, ativo, ano DESC);
CREATE INDEX IF NOT EXISTS idx_ehs_sipat_status  ON public.ehs_sipat (company_id, status);

-- 2) RLS por empresa (mesmo padrão de compliance_* / #5841: get_user_company_ids()) ──────────────────
ALTER TABLE public.ehs_sipat ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ehs_sipat_select ON public.ehs_sipat;
DROP POLICY IF EXISTS ehs_sipat_insert ON public.ehs_sipat;
DROP POLICY IF EXISTS ehs_sipat_update ON public.ehs_sipat;
DROP POLICY IF EXISTS ehs_sipat_delete ON public.ehs_sipat;
CREATE POLICY ehs_sipat_select ON public.ehs_sipat FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_sipat_insert ON public.ehs_sipat FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_sipat_update ON public.ehs_sipat FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_sipat_delete ON public.ehs_sipat FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

REVOKE ALL ON public.ehs_sipat FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ehs_sipat TO authenticated;
GRANT ALL ON public.ehs_sipat TO service_role;

-- 3) Menu + tela (NASCE ehs_modulo='completo' — gate #5114; NULL vazaria p/ todos) ────────────────────
INSERT INTO public.module_catalog
  (id, nome, rota, ativo, grupo, icone, ordem, subgrupo, descricao, is_shared, so_ps, legacy, so_demo, diferencial, rbac_isento, dependencies, surface_in_groups, ehs_modulo)
VALUES
  ('ehs_sipat', 'SIPAT', '/dashboard/ehs/sipat', true, 'compliance', 'CalendarDays', 28,
   'incidentes_riscos',
   'Semana Interna de Prevenção de Acidentes do Trabalho (SIPAT): edições por ano com tema, período, status, responsável, público-alvo e participação. Programação e presença vêm na próxima fatia.',
   true, false, false, false, false, false, ARRAY[]::text[], ARRAY[]::text[], 'completo')
ON CONFLICT (id) DO UPDATE SET ehs_modulo = EXCLUDED.ehs_modulo, rota = EXCLUDED.rota, ativo = EXCLUDED.ativo, nome = EXCLUDED.nome, descricao = EXCLUDED.descricao;

INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, auditavel_robo, estado_real, prioridade_monitoramento, auditada_ok)
VALUES
  ('dashboard.ehs_sipat', '/dashboard/ehs/sipat', 'compliance', 'SIPAT',
   'Semana Interna de Prevenção de Acidentes do Trabalho (SIPAT): edições por ano (tema, período início/fim, status planejada/em andamento/realizada/cancelada, responsável, público-alvo, local e participação prevista × realizada), por empresa (M14 · NR-5). Piloto DEMO EHS.',
   true, 'desconhecida', 'alta', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, prioridade, descricao_executiva, descricao_tecnica)
VALUES ('F.ehs.sipat', 'ehs_sipat', 'compliance', 'SIPAT', 'pronto', 100, 'alta',
        'Registro das edições da SIPAT por ano com status e participação.', 'ehs_sipat (RLS por empresa)')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.screen_route_features (screen_id, feature_id, peso)
VALUES ('dashboard.ehs_sipat', 'F.ehs.sipat', 1)
ON CONFLICT DO NOTHING;

-- 4) Ajuda de campo (RD-95) — uma chave por campo/coluna/ação da tela ─────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.sipat.empresa','/dashboard/ehs/sipat','SIPAT','Empresa',
   'Quando você cuida de mais de uma empresa, escolha aqui em qual vai cadastrar a edição da SIPAT.',
   'Define em qual empresa a edição é salva e filtra a lista ao lado.',
   'Escolher a planta onde a SIPAT vai acontecer antes de cadastrar.',
   'Cadastrar a edição achando que está numa empresa e estar em outra.',
   'compliance',10,1,'publicado'),
  ('ehs.sipat.busca','/dashboard/ehs/sipat','SIPAT','Buscar',
   'Digite parte do tema, do responsável ou do local para filtrar a lista.',
   'Ajuda a achar rápido uma edição quando há várias registradas.',
   '"CIPA" para achar a edição organizada pela CIPA.',
   'Esperar que a busca procure pelo ano: ela filtra por tema, responsável e local.',
   'compliance',20,1,'publicado'),
  ('ehs.sipat.filtro_ano','/dashboard/ehs/sipat','SIPAT','Filtro de ano',
   'Filtre a lista pelo ano da edição da SIPAT.',
   'Permite ver só as edições de um ano específico.',
   'Escolher "2026" para ver a SIPAT deste ano.',
   'Achar que não há edições quando o filtro de ano está escondendo as demais.',
   'compliance',30,1,'publicado'),
  ('ehs.sipat.filtro_status','/dashboard/ehs/sipat','SIPAT','Filtro de status',
   'Filtre pelo status: planejada, em andamento, realizada ou cancelada.',
   'Deixa à mão o que ainda vai acontecer e o que já foi feito.',
   'Escolher "Planejada" para ver o que está por vir.',
   'Confundir "planejada" (vai acontecer) com "realizada" (já aconteceu).',
   'compliance',40,1,'publicado'),
  ('ehs.sipat.novo','/dashboard/ehs/sipat','SIPAT','Nova edição',
   'Cadastra uma edição nova da SIPAT na empresa escolhida.',
   'Abre o cadastro com ano, tema, período, responsável e público-alvo.',
   'Registrar a SIPAT 2026 com o tema do ano.',
   'Deixar de cadastrar a SIPAT do ano e ficar sem evidência da semana.',
   'compliance',50,1,'publicado'),
  ('ehs.sipat.ano','/dashboard/ehs/sipat','SIPAT','Ano',
   'Informe o ano da edição da SIPAT.',
   'A SIPAT é anual (NR-5); o ano identifica a edição e organiza a lista.',
   '"2026".',
   'Repetir o mesmo ano em duas edições sem necessidade.',
   'compliance',60,1,'publicado'),
  ('ehs.sipat.tema','/dashboard/ehs/sipat','SIPAT','Tema',
   'Informe o tema/título da edição da SIPAT.',
   'É como a edição é reconhecida na lista e nos materiais da semana.',
   '"Segurança começa em mim".',
   'Deixar o tema genérico demais e não diferenciar uma edição da outra.',
   'compliance',70,1,'publicado'),
  ('ehs.sipat.data_inicio','/dashboard/ehs/sipat','SIPAT','Início',
   'Informe a data em que a semana da SIPAT começa.',
   'Define o período da edição e ajuda a programar as atividades.',
   'A segunda-feira em que a semana começa.',
   'Trocar o início com o fim da semana.',
   'compliance',80,1,'publicado'),
  ('ehs.sipat.data_fim','/dashboard/ehs/sipat','SIPAT','Fim',
   'Informe a data em que a semana da SIPAT termina.',
   'Fecha o período da edição junto com a data de início.',
   'A sexta-feira em que a semana termina.',
   'Informar uma data de fim anterior à data de início.',
   'compliance',90,1,'publicado'),
  ('ehs.sipat.status','/dashboard/ehs/sipat','SIPAT','Status',
   'Escolha o status: planejada, em andamento, realizada ou cancelada.',
   'Mostra em que etapa a edição está e separa o que já aconteceu.',
   '"Realizada" depois que a semana termina.',
   'Deixar como "planejada" uma edição que já aconteceu.',
   'compliance',100,1,'publicado'),
  ('ehs.sipat.responsavel','/dashboard/ehs/sipat','SIPAT','Responsável',
   'Informe quem organiza a edição (em geral a CIPA ou a coordenação de SST).',
   'Deixa claro quem responde pela organização da semana.',
   '"CIPA 2026"; "SESMT".',
   'Deixar sem responsável e não saber quem coordenou.',
   'compliance',110,1,'publicado'),
  ('ehs.sipat.publico_alvo','/dashboard/ehs/sipat','SIPAT','Público-alvo',
   'Informe a quem a edição se destina (todos os setores, turnos específicos, uma área).',
   'Ajuda a dimensionar a participação e a comunicação da semana.',
   '"Todos os setores"; "Turno da noite".',
   'Restringir o público sem necessidade e deixar gente de fora.',
   'compliance',120,1,'publicado'),
  ('ehs.sipat.local','/dashboard/ehs/sipat','SIPAT','Local',
   'Opcional: onde a SIPAT acontece (auditório, refeitório, pátio).',
   'Registra onde a semana ocorre para a organização e a auditoria.',
   '"Auditório"; "Refeitório".',
   'Deixar o local em branco quando ele é importante para a logística.',
   'compliance',130,1,'publicado'),
  ('ehs.sipat.prev_participantes','/dashboard/ehs/sipat','SIPAT','Participantes previstos',
   'Opcional: quantas pessoas se espera que participem.',
   'Serve de meta para comparar com a participação realizada.',
   '"120" para uma planta com cerca de 120 colaboradores.',
   'Confundir o previsto (meta) com o realizado (quem de fato foi).',
   'compliance',140,1,'publicado'),
  ('ehs.sipat.real_participantes','/dashboard/ehs/sipat','SIPAT','Participantes realizados',
   'Opcional: quantas pessoas participaram de fato (preenche após a semana).',
   'Mostra o alcance real da edição e o percentual de participação.',
   '"98" se 98 pessoas participaram.',
   'Preencher o realizado antes de a edição acontecer.',
   'compliance',150,1,'publicado'),
  ('ehs.sipat.observacao','/dashboard/ehs/sipat','SIPAT','Observação',
   'Opcional: qualquer observação sobre a edição (patrocínio, parceiros, mudanças).',
   'Guarda detalhes úteis para a organização e o histórico da semana.',
   '"Com apoio da clínica parceira"; "Adiada por chuva".',
   'Escrever a observação e esquecer de atualizar o status quando algo muda.',
   'compliance',160,1,'publicado'),
  ('ehs.sipat.col_edicao','/dashboard/ehs/sipat','SIPAT','Coluna Edição',
   'Mostra o ano e o tema de cada edição da SIPAT.',
   'Identifica rapidamente a edição na lista.',
   '"2026 · Segurança começa em mim".',
   'Procurar o status na coluna da edição.',
   'compliance',170,1,'publicado'),
  ('ehs.sipat.col_periodo','/dashboard/ehs/sipat','SIPAT','Coluna Período',
   'Mostra o período (início e fim) e o local da edição.',
   'Permite ver quando e onde a semana acontece sem abrir o cadastro.',
   '"10/11 a 14/11 · Auditório".',
   'Achar que uma edição sem datas não vale — o período é opcional.',
   'compliance',180,1,'publicado'),
  ('ehs.sipat.col_status','/dashboard/ehs/sipat','SIPAT','Coluna Status',
   'Mostra o status de cada edição com destaque de cor.',
   'Separa o que está por vir, o que está acontecendo e o que já foi feito.',
   '"Planejada"; "Realizada".',
   'Ignorar uma edição "em andamento" que precisa de acompanhamento.',
   'compliance',190,1,'publicado'),
  ('ehs.sipat.col_participacao','/dashboard/ehs/sipat','SIPAT','Coluna Participação',
   'Mostra a participação prevista × realizada e o percentual quando houver os dois.',
   'Ajuda a medir o alcance da edição.',
   '"98 / 120 (82%)".',
   'Ler o percentual sem lembrar que ele só aparece quando há previsto e realizado.',
   'compliance',200,1,'publicado'),
  ('ehs.sipat.col_acoes','/dashboard/ehs/sipat','SIPAT','Coluna Ações',
   'Editar abre a edição para ajustar dados; Desativar tira o registro das listas sem apagar o histórico.',
   'Mantém o cadastro vivo sem perder o que já foi registrado.',
   'Desativar uma edição cadastrada por engano, informando o motivo.',
   'Apagar quando o certo é desativar (o histórico some).',
   'compliance',210,1,'publicado'),
  ('ehs.sipat.editar','/dashboard/ehs/sipat','SIPAT','Editar',
   'Abre a edição para mudar tema, período, status, responsável e participação.',
   'Deixa o cadastro sempre correto para o acompanhamento da semana.',
   'Atualizar o status para "realizada" e preencher os participantes depois da semana.',
   'Criar outra edição quando era só editar a atual.',
   'compliance',220,1,'publicado'),
  ('ehs.sipat.desativar','/dashboard/ehs/sipat','SIPAT','Desativar',
   'Tira a edição das listas, com um motivo, sem apagar o histórico (exclusão rastreável — RD-98).',
   'Corrige um cadastro errado sem perder o histórico.',
   'Desativar uma edição duplicada, informando "duplicada".',
   'Desativar sem informar o motivo e depois não lembrar por quê.',
   'compliance',230,1,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo, o_que_preencher=EXCLUDED.o_que_preencher,
  para_que_serve=EXCLUDED.para_que_serve, exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();

-- 5) Blueprint vivo — refletir o que esta fatia atende (RD-38: programação fica p/ próxima fatia) ──────
UPDATE public.blueprint_tela_requisito
   SET status_baseline='parcial',
       evidencia_baseline='Edições da SIPAT (ano, tema, período, status, responsável, público-alvo e participação) · /dashboard/ehs/sipat (programação e presença na próxima fatia)'
 WHERE vertical='ehs' AND tela_num=14 AND requisito LIKE 'SIPAT%';

-- 6) SEED DE DEMONSTRAÇÃO — SÓ na DEMO EHS b0700000-...-000b (fictício; NUNCA cliente real) ────────────
INSERT INTO public.ehs_sipat
  (company_id, ano, tema, data_inicio, data_fim, status, responsavel, publico_alvo, local_evento,
   participantes_previstos, participantes_realizados, observacao)
SELECT v.company_id, v.ano, v.tema, v.data_inicio, v.data_fim, v.status, v.responsavel, v.publico_alvo,
       v.local_evento, v.participantes_previstos, v.participantes_realizados, v.observacao
FROM (VALUES
  ('b0700000-0000-4000-a000-00000000000b'::uuid, 2024, 'Cuidar de mim, cuidar de todos',
     DATE '2024-10-21', DATE '2024-10-25', 'realizada', 'CIPA 2024', 'Todos os setores', 'Auditório',
     120, 108, 'Primeira SIPAT registrada no sistema'),
  ('b0700000-0000-4000-a000-00000000000b'::uuid, 2025, 'Segurança em primeiro lugar',
     DATE '2025-10-20', DATE '2025-10-24', 'realizada', 'CIPA 2025', 'Todos os setores', 'Refeitório',
     125, 119, 'Palestras e dinâmicas por turno'),
  ('b0700000-0000-4000-a000-00000000000b'::uuid, 2026, 'Segurança começa em mim',
     (CURRENT_DATE + 25), (CURRENT_DATE + 29), 'planejada', 'CIPA 2026', 'Todos os setores e turnos', 'Auditório',
     130, NULL, 'Programação em definição com a CIPA')
) AS v(company_id, ano, tema, data_inicio, data_fim, status, responsavel, publico_alvo, local_evento,
       participantes_previstos, participantes_realizados, observacao)
WHERE NOT EXISTS (
  SELECT 1 FROM public.ehs_sipat e
   WHERE e.company_id = v.company_id AND e.ano = v.ano
);
