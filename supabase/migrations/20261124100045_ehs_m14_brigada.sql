-- PS EHS · EHS-9c / M14 — Comissões e programas · Brigada de incêndio (NR-23)
-- (fatia 1: COMPOSIÇÃO da brigada + validade do treinamento com alerta de reciclagem)
--
-- Requisito do blueprint vivo (vertical 'ehs', M14 · onda E9):
--   • "Brigada (NR-23): Composição, treinos, simulados" -> esta fatia entrega a COMPOSIÇÃO da
--      brigada (quem é brigadista, função, setor, turno) com a DATA e a VALIDADE do treinamento e
--      o ALERTA de reciclagem. Os SIMULADOS (registro de treinos/simulados de abandono com data,
--      participantes e avaliação) vêm na próxima fatia -> por isso o blueprint fica 'parcial'
--      (RD-38: só o que realmente entregou).
--
-- Company-scoped (RLS por empresa via get_user_company_ids(), igual a compliance_* e às fatias
-- #5692/#5706/#5714/#5833). ADITIVA: 1 tabela nova, RLS ligada, REVOKE anon, menu/tela 'completo'
-- (gate #5114 — só DEMO/contratante vê; NÃO vaza p/ a Frioeste), ajuda (RD-95), exclusão
-- rastreável (RD-98 p4: quem + quando + motivo, sem apagar) e SEED FICTÍCIO só na DEMO EHS
-- (b0700000-...-000b). Não toca nenhuma estrutura existente. Nenhum dado de cliente real.

-- 1) Tabela ──────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ehs_brigada (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL,
  nome                  text NOT NULL,                 -- nome do brigadista
  matricula             text,                          -- matrícula/registro do colaborador (opcional)
  funcao_brigada        text NOT NULL DEFAULT 'brigadista'
                          CHECK (funcao_brigada IN ('coordenador','chefe','lider','brigadista')),
  setor                 text,
  turno                 text CHECK (turno IS NULL OR turno IN ('manha','tarde','noite','comercial','integral')),
  data_treinamento      date,                          -- data do treinamento/formação de brigada
  validade_treinamento  date,                          -- vencimento da reciclagem (alerta)
  carga_horaria_h       numeric(5,1),                  -- carga horária do treinamento (horas)
  certificado           text,                          -- nº/ref. do certificado de brigada
  apto                  boolean NOT NULL DEFAULT true, -- apto a atuar (treinamento válido / sem restrição)
  observacao            text,
  ativo                 boolean NOT NULL DEFAULT true,
  -- Exclusão rastreável (RD-98 p4): desativar guarda quem/quando/por quê, sem apagar o histórico.
  excluido_em           timestamptz,
  excluido_por          uuid,
  excluido_motivo       text,
  criado_por            uuid DEFAULT auth.uid(),
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ehs_brig_empresa  ON public.ehs_brigada (company_id, ativo, validade_treinamento);
CREATE INDEX IF NOT EXISTS idx_ehs_brig_funcao   ON public.ehs_brigada (company_id, funcao_brigada);
CREATE INDEX IF NOT EXISTS idx_ehs_brig_setor    ON public.ehs_brigada (company_id, setor);

-- 2) RLS por empresa (mesmo padrão de compliance_* / #5833: get_user_company_ids()) ──────────────────
ALTER TABLE public.ehs_brigada ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ehs_brig_select ON public.ehs_brigada;
DROP POLICY IF EXISTS ehs_brig_insert ON public.ehs_brigada;
DROP POLICY IF EXISTS ehs_brig_update ON public.ehs_brigada;
DROP POLICY IF EXISTS ehs_brig_delete ON public.ehs_brigada;
CREATE POLICY ehs_brig_select ON public.ehs_brigada FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_brig_insert ON public.ehs_brigada FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_brig_update ON public.ehs_brigada FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_brig_delete ON public.ehs_brigada FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

REVOKE ALL ON public.ehs_brigada FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ehs_brigada TO authenticated;
GRANT ALL ON public.ehs_brigada TO service_role;

-- 3) Menu + tela (NASCE ehs_modulo='completo' — gate #5114; NULL vazaria p/ todos) ────────────────────
INSERT INTO public.module_catalog
  (id, nome, rota, ativo, grupo, icone, ordem, subgrupo, descricao, is_shared, so_ps, legacy, so_demo, diferencial, rbac_isento, dependencies, surface_in_groups, ehs_modulo)
VALUES
  ('ehs_brigada', 'Brigada de incêndio', '/dashboard/ehs/brigada', true, 'compliance', 'Users', 27,
   'incidentes_riscos',
   'Composição da brigada de incêndio (NR-23): brigadistas por função, setor e turno, com a validade do treinamento e alerta de reciclagem. Simulados vêm na próxima fatia.',
   true, false, false, false, false, false, ARRAY[]::text[], ARRAY[]::text[], 'completo')
ON CONFLICT (id) DO UPDATE SET ehs_modulo = EXCLUDED.ehs_modulo, rota = EXCLUDED.rota, ativo = EXCLUDED.ativo, nome = EXCLUDED.nome, descricao = EXCLUDED.descricao;

INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, auditavel_robo, estado_real, prioridade_monitoramento, auditada_ok)
VALUES
  ('dashboard.ehs_brigada', '/dashboard/ehs/brigada', 'compliance', 'Brigada de incêndio',
   'Composição da brigada de incêndio (NR-23): brigadistas com função (coordenador, chefe, líder, brigadista), setor, turno, data e validade do treinamento, carga horária e certificado, com alerta de reciclagem vencida/a vencer, por empresa (M14 · NR-23). Piloto DEMO EHS.',
   true, 'desconhecida', 'alta', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, prioridade, descricao_executiva, descricao_tecnica)
VALUES ('F.ehs.brigada', 'ehs_brigada', 'compliance', 'Brigada de incêndio', 'pronto', 100, 'alta',
        'Composição da brigada de incêndio com validade de treinamento e alerta de reciclagem.', 'ehs_brigada (RLS por empresa)')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.screen_route_features (screen_id, feature_id, peso)
VALUES ('dashboard.ehs_brigada', 'F.ehs.brigada', 1)
ON CONFLICT DO NOTHING;

-- 4) Ajuda de campo (RD-95) — uma chave por campo/coluna/ação da tela ─────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.brig.empresa','/dashboard/ehs/brigada','Brigada de incêndio','Empresa',
   'Quando você cuida de mais de uma empresa, escolha aqui em qual vai cadastrar o brigadista.',
   'Define em qual empresa o brigadista é salvo e filtra a lista ao lado.',
   'Escolher a planta onde o brigadista atua antes de cadastrar.',
   'Cadastrar o brigadista achando que está numa empresa e estar em outra.',
   'compliance',10,1,'publicado'),
  ('ehs.brig.busca','/dashboard/ehs/brigada','Brigada de incêndio','Buscar',
   'Digite parte do nome, da matrícula ou do setor para filtrar a lista.',
   'Ajuda a achar rápido um brigadista quando a brigada é grande.',
   '"Ana" para achar a brigadista Ana.',
   'Esperar que a busca procure pela validade: ela filtra por nome, matrícula e setor.',
   'compliance',20,1,'publicado'),
  ('ehs.brig.filtro_funcao','/dashboard/ehs/brigada','Brigada de incêndio','Filtro de função',
   'Filtre a lista pela função na brigada: coordenador, chefe, líder ou brigadista.',
   'Permite conferir rapidamente quem lidera e quem compõe a brigada.',
   'Escolher "Chefe" para ver quem chefia a brigada por turno.',
   'Achar que não há brigadistas quando o filtro está escondendo as outras funções.',
   'compliance',30,1,'publicado'),
  ('ehs.brig.filtro_situacao','/dashboard/ehs/brigada','Brigada de incêndio','Filtro de situação',
   'Filtre pela situação do treinamento: vencido, vence em breve ou em dia.',
   'Deixa à mão quem precisa de reciclagem antes de vencer.',
   'Escolher "Vencido" para ver quem está com o treinamento fora do prazo.',
   'Confundir "vence em breve" (alerta) com "vencido" (já passou).',
   'compliance',40,1,'publicado'),
  ('ehs.brig.novo','/dashboard/ehs/brigada','Brigada de incêndio','Novo brigadista',
   'Cadastra um brigadista novo na brigada da empresa escolhida.',
   'Abre o cadastro com função, setor, turno e as datas do treinamento.',
   'Incluir o colaborador recém-treinado como brigadista do turno da manhã.',
   'Deixar de cadastrar quem já fez o curso de brigada.',
   'compliance',50,1,'publicado'),
  ('ehs.brig.nome','/dashboard/ehs/brigada','Brigada de incêndio','Nome',
   'Informe o nome do brigadista.',
   'É como o brigadista é reconhecido na lista e nos relatórios da brigada.',
   '"Ana Ferreira".',
   'Abreviar demais e depois não saber de quem se trata.',
   'compliance',60,1,'publicado'),
  ('ehs.brig.matricula','/dashboard/ehs/brigada','Brigada de incêndio','Matrícula',
   'Opcional: a matrícula ou registro do colaborador.',
   'Ajuda a cruzar o brigadista com o cadastro de funcionários.',
   '"BR-001"; "12345".',
   'Repetir a mesma matrícula em pessoas diferentes.',
   'compliance',70,1,'publicado'),
  ('ehs.brig.funcao','/dashboard/ehs/brigada','Brigada de incêndio','Função na brigada',
   'Escolha a função na brigada: coordenador, chefe, líder ou brigadista.',
   'Define o papel de cada um na resposta a emergência e na organização da brigada.',
   '"Chefe" para quem comanda o turno; "Brigadista" para os demais.',
   'Deixar a brigada sem coordenador ou chefe definido.',
   'compliance',80,1,'publicado'),
  ('ehs.brig.setor','/dashboard/ehs/brigada','Brigada de incêndio','Setor',
   'Informe o setor/área onde o brigadista atua.',
   'Permite ver a cobertura da brigada por área da planta.',
   '"Abate"; "Expedição"; "Manutenção".',
   'Deixar o setor em branco e não saber qual área fica descoberta.',
   'compliance',90,1,'publicado'),
  ('ehs.brig.turno','/dashboard/ehs/brigada','Brigada de incêndio','Turno',
   'Escolha o turno do brigadista: manhã, tarde, noite, comercial ou integral.',
   'Garante que haja brigadista em todos os turnos de operação.',
   '"Noite" para o brigadista do turno noturno.',
   'Concentrar a brigada num turno só e deixar outro sem cobertura.',
   'compliance',100,1,'publicado'),
  ('ehs.brig.data_treinamento','/dashboard/ehs/brigada','Brigada de incêndio','Data do treinamento',
   'Informe a data em que o brigadista fez o treinamento/formação de brigada.',
   'Serve de referência e base para calcular a validade da reciclagem.',
   'A data do certificado do curso de brigada.',
   'Informar a data de admissão no lugar da data do treinamento.',
   'compliance',110,1,'publicado'),
  ('ehs.brig.validade_treinamento','/dashboard/ehs/brigada','Brigada de incêndio','Validade do treinamento',
   'Informe a data em que o treinamento de brigada vence (precisa de reciclagem).',
   'É a data que dispara o alerta de "vence em breve" e "vencido" na lista.',
   'Em geral um ano após o treinamento, conforme a NR-23 e o plano da empresa.',
   'Deixar a validade em branco e não ter alerta de reciclagem.',
   'compliance',120,1,'publicado'),
  ('ehs.brig.carga_horaria','/dashboard/ehs/brigada','Brigada de incêndio','Carga horária',
   'Opcional: a carga horária do treinamento, em horas.',
   'Registra a especificação do curso para a auditoria da brigada.',
   '"20" para um curso de 20 horas.',
   'Confundir a carga horária com a validade do treinamento.',
   'compliance',130,1,'publicado'),
  ('ehs.brig.certificado','/dashboard/ehs/brigada','Brigada de incêndio','Certificado',
   'Opcional: o número ou a referência do certificado de brigada.',
   'Guarda a evidência do treinamento para fiscalização e auditoria.',
   '"CERT-2026-013".',
   'Deixar o certificado em branco e depois não achar a evidência.',
   'compliance',140,1,'publicado'),
  ('ehs.brig.apto','/dashboard/ehs/brigada','Brigada de incêndio','Apto a atuar',
   'Marque se o brigadista está apto a atuar (treinamento válido e sem restrição).',
   'Separa quem pode responder a uma emergência agora de quem está pendente.',
   'Desmarcar quem está afastado ou com o treinamento vencido.',
   'Manter marcado como apto quem já está com o treinamento vencido.',
   'compliance',150,1,'publicado'),
  ('ehs.brig.observacao','/dashboard/ehs/brigada','Brigada de incêndio','Observação',
   'Opcional: qualquer observação sobre o brigadista (restrição, função extra, EPI).',
   'Guarda detalhes úteis para a organização da brigada.',
   '"Também é socorrista"; "Afastado até 10/12".',
   'Escrever a observação e esquecer de marcar como não apto quando for o caso.',
   'compliance',160,1,'publicado'),
  ('ehs.brig.col_brigadista','/dashboard/ehs/brigada','Brigada de incêndio','Coluna Brigadista',
   'Mostra o nome e a matrícula de cada brigadista.',
   'Identifica rapidamente a pessoa na lista.',
   '"Ana Ferreira · BR-001".',
   'Procurar pela validade na coluna do brigadista.',
   'compliance',170,1,'publicado'),
  ('ehs.brig.col_funcao','/dashboard/ehs/brigada','Brigada de incêndio','Coluna Função',
   'Mostra a função de cada um na brigada.',
   'Permite ver a hierarquia da brigada sem abrir cada cadastro.',
   '"Chefe"; "Brigadista".',
   'Ignorar que falta um coordenador ou chefe.',
   'compliance',180,1,'publicado'),
  ('ehs.brig.col_setor','/dashboard/ehs/brigada','Brigada de incêndio','Coluna Setor',
   'Mostra o setor e o turno de cada brigadista.',
   'Ajuda a ver a cobertura da brigada por área e por turno.',
   '"Expedição · Noite".',
   'Achar que um brigadista sem turno não vale — o turno é opcional.',
   'compliance',190,1,'publicado'),
  ('ehs.brig.col_treinamento','/dashboard/ehs/brigada','Brigada de incêndio','Coluna Treinamento',
   'Mostra a validade do treinamento e sinaliza vencido ou a vencer.',
   'É o alerta que diz quem precisa de reciclagem antes de perder a validade.',
   '"Vence 10/12/2026 · a vencer".',
   'Olhar só a data do treinamento e esquecer a validade.',
   'compliance',200,1,'publicado'),
  ('ehs.brig.col_acoes','/dashboard/ehs/brigada','Brigada de incêndio','Coluna Ações',
   'Editar abre o brigadista para ajustar dados e datas; Desativar tira o registro das listas sem apagar o histórico.',
   'Mantém o cadastro vivo sem perder o que já foi registrado.',
   'Desativar um brigadista que saiu da brigada, informando o motivo.',
   'Apagar quando o certo é desativar (o histórico some).',
   'compliance',210,1,'publicado'),
  ('ehs.brig.editar','/dashboard/ehs/brigada','Brigada de incêndio','Editar',
   'Abre o brigadista para mudar função, setor, turno e as datas do treinamento.',
   'Deixa o cadastro sempre correto para o alerta de reciclagem funcionar.',
   'Atualizar a validade assim que o brigadista faz a reciclagem.',
   'Criar outro cadastro quando era só editar o atual.',
   'compliance',220,1,'publicado'),
  ('ehs.brig.desativar','/dashboard/ehs/brigada','Brigada de incêndio','Desativar',
   'Tira o brigadista das listas, com um motivo, sem apagar o histórico (exclusão rastreável — RD-98).',
   'Corrige um cadastro errado ou registra a saída da brigada sem perder o histórico.',
   'Desativar quem foi transferido de planta, informando "transferência".',
   'Desativar sem informar o motivo e depois não lembrar por quê.',
   'compliance',230,1,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo, o_que_preencher=EXCLUDED.o_que_preencher,
  para_que_serve=EXCLUDED.para_que_serve, exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();

-- 5) Blueprint vivo — refletir o que esta fatia atende (RD-38: simulados ficam p/ próxima fatia) ───────
UPDATE public.blueprint_tela_requisito
   SET status_baseline='parcial',
       evidencia_baseline='Composição da brigada + validade do treinamento e alerta de reciclagem · /dashboard/ehs/brigada (simulados na próxima fatia)'
 WHERE vertical='ehs' AND tela_num=14 AND requisito LIKE 'Brigada (NR-23)%';

-- 6) SEED DE DEMONSTRAÇÃO — SÓ na DEMO EHS b0700000-...-000b (fictício; NUNCA cliente real) ────────────
INSERT INTO public.ehs_brigada
  (company_id, nome, matricula, funcao_brigada, setor, turno, data_treinamento, validade_treinamento,
   carga_horaria_h, certificado, apto, observacao)
SELECT v.company_id, v.nome, v.matricula, v.funcao_brigada, v.setor, v.turno, v.data_treinamento, v.validade_treinamento,
       v.carga_horaria_h, v.certificado, v.apto, v.observacao
FROM (VALUES
  ('b0700000-0000-4000-a000-00000000000b'::uuid,'Ana Ferreira','BR-001','coordenador','Expedição','comercial',
     DATE '2026-02-10', (CURRENT_DATE + 80), 20.0, 'CERT-2026-001', true, 'Coordenadora da brigada'),
  ('b0700000-0000-4000-a000-00000000000b'::uuid,'Carlos Souza','BR-014','chefe','Abate','manha',
     DATE '2025-11-20', (CURRENT_DATE + 15), 16.0, 'CERT-2025-214', true, 'Chefe do turno da manhã'),
  ('b0700000-0000-4000-a000-00000000000b'::uuid,'Marcos Lima','BR-033','brigadista','Produção','noite',
     DATE '2025-10-01', (CURRENT_DATE - 6), 16.0, 'CERT-2025-330', false, 'Reciclagem vencida — reconvocar'),
  ('b0700000-0000-4000-a000-00000000000b'::uuid,'Juliana Alves','BR-047','lider','Manutenção','tarde',
     DATE '2026-01-15', (CURRENT_DATE + 200), 16.0, 'CERT-2026-047', true, 'Líder da área de manutenção')
) AS v(company_id, nome, matricula, funcao_brigada, setor, turno, data_treinamento, validade_treinamento,
       carga_horaria_h, certificado, apto, observacao)
WHERE NOT EXISTS (
  SELECT 1 FROM public.ehs_brigada e
   WHERE e.company_id = v.company_id AND e.matricula = v.matricula
);
