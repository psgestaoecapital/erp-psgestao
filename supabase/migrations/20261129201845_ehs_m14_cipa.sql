-- PS EHS · EHS-9c / M14 — Comissões e programas · CIPA (NR-5)
-- (fatia 1: COMPOSIÇÃO da CIPA — membros, representação, função, gestão/mandato e validade do
--  treinamento com alerta de reciclagem)
--
-- Requisito do blueprint vivo (vertical 'ehs', M14 · onda E9):
--   • "CIPA (NR-5): Eleição online, atas, calendário" -> esta fatia entrega a COMPOSIÇÃO da
--      comissão (quem é membro, representação empregador/empregado, função, gestão/mandato) com a
--      DATA e a VALIDADE do treinamento de NR-5 e o ALERTA de reciclagem. A ELEIÇÃO ONLINE, as
--      ATAS e o CALENDÁRIO de reuniões vêm nas próximas fatias -> por isso o blueprint fica
--      'parcial' (RD-38: só o que realmente entregou).
--
-- Company-scoped (RLS por empresa via get_user_company_ids(), igual a compliance_* e às fatias
-- #5833/#5841/#5849). ADITIVA: 1 tabela nova, RLS ligada, REVOKE anon, menu/tela 'completo'
-- (gate #5114 — só DEMO/contratante vê; NÃO vaza p/ a Frioeste), ajuda (RD-95), exclusão
-- rastreável (RD-98 p4: quem + quando + motivo, sem apagar) e SEED FICTÍCIO só na DEMO EHS
-- (b0700000-...-000b). Não toca nenhuma estrutura existente. Nenhum dado de cliente real.

-- 1) Tabela ──────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ehs_cipa (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL,
  nome                  text NOT NULL,                 -- nome do membro da CIPA
  matricula             text,                          -- matrícula/registro do colaborador (opcional)
  representacao         text NOT NULL DEFAULT 'empregado'
                          CHECK (representacao IN ('empregador','empregado')),
  funcao_cipa           text NOT NULL DEFAULT 'titular'
                          CHECK (funcao_cipa IN ('presidente','vice_presidente','secretario','titular','suplente')),
  setor                 text,
  gestao                text,                          -- período da gestão (ex.: "2026/2027")
  mandato_inicio        date,                          -- início do mandato
  mandato_fim           date,                          -- fim do mandato (referência)
  eleito                boolean NOT NULL DEFAULT false,-- eleito (empregado) x indicado (empregador)
  data_treinamento      date,                          -- data do treinamento NR-5
  validade_treinamento  date,                          -- vencimento da reciclagem (alerta)
  certificado           text,                          -- nº/ref. do certificado de NR-5
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

CREATE INDEX IF NOT EXISTS idx_ehs_cipa_empresa  ON public.ehs_cipa (company_id, ativo, validade_treinamento);
CREATE INDEX IF NOT EXISTS idx_ehs_cipa_funcao   ON public.ehs_cipa (company_id, funcao_cipa);
CREATE INDEX IF NOT EXISTS idx_ehs_cipa_repr     ON public.ehs_cipa (company_id, representacao);

-- 2) RLS por empresa (mesmo padrão de compliance_* / #5841: get_user_company_ids()) ──────────────────
ALTER TABLE public.ehs_cipa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ehs_cipa_select ON public.ehs_cipa;
DROP POLICY IF EXISTS ehs_cipa_insert ON public.ehs_cipa;
DROP POLICY IF EXISTS ehs_cipa_update ON public.ehs_cipa;
DROP POLICY IF EXISTS ehs_cipa_delete ON public.ehs_cipa;
CREATE POLICY ehs_cipa_select ON public.ehs_cipa FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_cipa_insert ON public.ehs_cipa FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_cipa_update ON public.ehs_cipa FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_cipa_delete ON public.ehs_cipa FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

REVOKE ALL ON public.ehs_cipa FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ehs_cipa TO authenticated;
GRANT ALL ON public.ehs_cipa TO service_role;

-- 3) Menu + tela (NASCE ehs_modulo='completo' — gate #5114; NULL vazaria p/ todos) ────────────────────
INSERT INTO public.module_catalog
  (id, nome, rota, ativo, grupo, icone, ordem, subgrupo, descricao, is_shared, so_ps, legacy, so_demo, diferencial, rbac_isento, dependencies, surface_in_groups, ehs_modulo)
VALUES
  ('ehs_cipa', 'CIPA', '/dashboard/ehs/cipa', true, 'compliance', 'Users', 28,
   'incidentes_riscos',
   'Composição da CIPA (NR-5): membros por representação (empregador/empregado) e função, gestão e mandato, com a validade do treinamento e alerta de reciclagem. Eleição online, atas e calendário vêm nas próximas fatias.',
   true, false, false, false, false, false, ARRAY[]::text[], ARRAY[]::text[], 'completo')
ON CONFLICT (id) DO UPDATE SET ehs_modulo = EXCLUDED.ehs_modulo, rota = EXCLUDED.rota, ativo = EXCLUDED.ativo, nome = EXCLUDED.nome, descricao = EXCLUDED.descricao;

INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, auditavel_robo, estado_real, prioridade_monitoramento, auditada_ok)
VALUES
  ('dashboard.ehs_cipa', '/dashboard/ehs/cipa', 'compliance', 'CIPA',
   'Composição da CIPA (NR-5): membros com representação (empregador/empregado), função (presidente, vice-presidente, secretário, titular, suplente), setor, gestão e mandato, data e validade do treinamento e certificado, com alerta de reciclagem vencida/a vencer, por empresa (M14 · NR-5). Piloto DEMO EHS.',
   true, 'desconhecida', 'alta', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, prioridade, descricao_executiva, descricao_tecnica)
VALUES ('F.ehs.cipa', 'ehs_cipa', 'compliance', 'CIPA', 'pronto', 100, 'alta',
        'Composição da CIPA com representação, gestão/mandato, validade de treinamento e alerta de reciclagem.', 'ehs_cipa (RLS por empresa)')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.screen_route_features (screen_id, feature_id, peso)
VALUES ('dashboard.ehs_cipa', 'F.ehs.cipa', 1)
ON CONFLICT DO NOTHING;

-- 4) Ajuda de campo (RD-95) — uma chave por campo/coluna/ação da tela ─────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.cipa.empresa','/dashboard/ehs/cipa','CIPA','Empresa',
   'Quando você cuida de mais de uma empresa, escolha aqui em qual vai cadastrar o membro da CIPA.',
   'Define em qual empresa o membro é salvo e filtra a lista ao lado.',
   'Escolher a planta onde a CIPA está constituída antes de cadastrar.',
   'Cadastrar o membro achando que está numa empresa e estar em outra.',
   'compliance',10,1,'publicado'),
  ('ehs.cipa.busca','/dashboard/ehs/cipa','CIPA','Buscar',
   'Digite parte do nome, da matrícula ou do setor para filtrar a lista.',
   'Ajuda a achar rápido um membro quando a comissão é grande.',
   '"Ana" para achar a cipeira Ana.',
   'Esperar que a busca procure pela validade: ela filtra por nome, matrícula e setor.',
   'compliance',20,1,'publicado'),
  ('ehs.cipa.filtro_representacao','/dashboard/ehs/cipa','CIPA','Filtro de representação',
   'Filtre a lista pela representação: empregador (indicados) ou empregado (eleitos).',
   'A CIPA é paritária; o filtro ajuda a conferir o equilíbrio entre as duas bancadas.',
   'Escolher "Empregado" para ver os membros eleitos.',
   'Achar que faltam membros quando o filtro está escondendo a outra bancada.',
   'compliance',30,1,'publicado'),
  ('ehs.cipa.filtro_situacao','/dashboard/ehs/cipa','CIPA','Filtro de situação',
   'Filtre pela situação do treinamento: vencido, vence em breve ou em dia.',
   'Deixa à mão quem precisa de reciclagem de NR-5 antes de vencer.',
   'Escolher "Vencido" para ver quem está com o treinamento fora do prazo.',
   'Confundir "vence em breve" (alerta) com "vencido" (já passou).',
   'compliance',40,1,'publicado'),
  ('ehs.cipa.novo','/dashboard/ehs/cipa','CIPA','Novo membro',
   'Cadastra um membro novo na CIPA da empresa escolhida.',
   'Abre o cadastro com representação, função, gestão/mandato e as datas do treinamento.',
   'Incluir o colaborador eleito como titular da bancada dos empregados.',
   'Deixar de cadastrar quem tomou posse na CIPA.',
   'compliance',50,1,'publicado'),
  ('ehs.cipa.nome','/dashboard/ehs/cipa','CIPA','Nome',
   'Informe o nome do membro da CIPA.',
   'É como o membro é reconhecido na lista e nos documentos da comissão.',
   '"Ana Ferreira".',
   'Abreviar demais e depois não saber de quem se trata.',
   'compliance',60,1,'publicado'),
  ('ehs.cipa.matricula','/dashboard/ehs/cipa','CIPA','Matrícula',
   'Opcional: a matrícula ou registro do colaborador.',
   'Ajuda a cruzar o membro com o cadastro de funcionários.',
   '"CP-001"; "12345".',
   'Repetir a mesma matrícula em pessoas diferentes.',
   'compliance',70,1,'publicado'),
  ('ehs.cipa.representacao','/dashboard/ehs/cipa','CIPA','Representação',
   'Escolha a bancada: empregador (indicado pela empresa) ou empregado (eleito pelos trabalhadores).',
   'Mantém a CIPA paritária, com o mesmo número de representantes de cada lado (NR-5).',
   '"Empregado" para o membro eleito; "Empregador" para o indicado.',
   'Cadastrar todos como empregado e desequilibrar a composição.',
   'compliance',80,1,'publicado'),
  ('ehs.cipa.funcao','/dashboard/ehs/cipa','CIPA','Função na CIPA',
   'Escolha a função: presidente, vice-presidente, secretário, titular ou suplente.',
   'Define o papel na comissão (o presidente é indicado pelo empregador; o vice é eleito pelos empregados).',
   '"Presidente" para quem preside; "Titular"/"Suplente" para os demais.',
   'Deixar a CIPA sem presidente ou sem vice-presidente definido.',
   'compliance',90,1,'publicado'),
  ('ehs.cipa.setor','/dashboard/ehs/cipa','CIPA','Setor',
   'Informe o setor/área onde o membro atua.',
   'Permite ver a representatividade da CIPA pelas áreas da planta.',
   '"Abate"; "Expedição"; "Manutenção".',
   'Deixar o setor em branco e não saber qual área está representada.',
   'compliance',100,1,'publicado'),
  ('ehs.cipa.gestao','/dashboard/ehs/cipa','CIPA','Gestão',
   'Informe o período da gestão da CIPA (o mandato tem um ano, permitida uma reeleição).',
   'Agrupa os membros pela gestão e serve de referência para a renovação da comissão.',
   '"2026/2027".',
   'Misturar membros de gestões diferentes sem separar pelo período.',
   'compliance',110,1,'publicado'),
  ('ehs.cipa.mandato_inicio','/dashboard/ehs/cipa','CIPA','Início do mandato',
   'Informe a data de posse/início do mandato do membro.',
   'Marca quando o membro passou a atuar na comissão.',
   'A data da posse registrada em ata.',
   'Informar a data da eleição no lugar da data de posse.',
   'compliance',120,1,'publicado'),
  ('ehs.cipa.mandato_fim','/dashboard/ehs/cipa','CIPA','Fim do mandato',
   'Informe a data de término do mandato (em geral um ano após a posse).',
   'Serve de referência para renovar a CIPA e convocar nova eleição a tempo.',
   'Um ano após o início do mandato.',
   'Deixar o fim do mandato em branco e perder o prazo de renovação.',
   'compliance',130,1,'publicado'),
  ('ehs.cipa.eleito','/dashboard/ehs/cipa','CIPA','Eleito',
   'Marque se o membro foi eleito pelos trabalhadores (os representantes dos empregados são eleitos; os do empregador são indicados).',
   'Diferencia os eleitos, que têm estabilidade pela NR-5, dos indicados pela empresa.',
   'Marcar para o titular/suplente eleito; desmarcar para o indicado pela empresa.',
   'Marcar como eleito um membro indicado pelo empregador.',
   'compliance',140,1,'publicado'),
  ('ehs.cipa.data_treinamento','/dashboard/ehs/cipa','CIPA','Data do treinamento',
   'Informe a data em que o membro fez o treinamento de CIPA (NR-5).',
   'Serve de referência e base para calcular a validade da reciclagem.',
   'A data do certificado do curso de NR-5.',
   'Informar a data de posse no lugar da data do treinamento.',
   'compliance',150,1,'publicado'),
  ('ehs.cipa.validade_treinamento','/dashboard/ehs/cipa','CIPA','Validade do treinamento',
   'Informe a data em que o treinamento de NR-5 vence (precisa de reciclagem).',
   'É a data que dispara o alerta de "vence em breve" e "vencido" na lista.',
   'Conforme o plano da empresa e a NR-5.',
   'Deixar a validade em branco e não ter alerta de reciclagem.',
   'compliance',160,1,'publicado'),
  ('ehs.cipa.certificado','/dashboard/ehs/cipa','CIPA','Certificado',
   'Opcional: o número ou a referência do certificado de NR-5.',
   'Guarda a evidência do treinamento para fiscalização e auditoria.',
   '"CIPA-2026-001".',
   'Deixar o certificado em branco e depois não achar a evidência.',
   'compliance',170,1,'publicado'),
  ('ehs.cipa.apto','/dashboard/ehs/cipa','CIPA','Apto a atuar',
   'Marque se o membro está apto a atuar (treinamento válido e sem restrição).',
   'Separa quem pode participar das reuniões e inspeções agora de quem está pendente.',
   'Desmarcar quem está afastado ou com o treinamento vencido.',
   'Manter marcado como apto quem já está com o treinamento vencido.',
   'compliance',180,1,'publicado'),
  ('ehs.cipa.observacao','/dashboard/ehs/cipa','CIPA','Observação',
   'Opcional: qualquer observação sobre o membro (estabilidade, função extra, afastamento).',
   'Guarda detalhes úteis para a organização da comissão.',
   '"Estabilidade até 12/2027"; "Afastado até 10/12".',
   'Escrever a observação e esquecer de marcar como não apto quando for o caso.',
   'compliance',190,1,'publicado'),
  ('ehs.cipa.col_membro','/dashboard/ehs/cipa','CIPA','Coluna Membro',
   'Mostra o nome e a matrícula de cada membro da CIPA.',
   'Identifica rapidamente a pessoa na lista.',
   '"Ana Ferreira · CP-001".',
   'Procurar pela validade na coluna do membro.',
   'compliance',200,1,'publicado'),
  ('ehs.cipa.col_funcao','/dashboard/ehs/cipa','CIPA','Coluna Função',
   'Mostra a função de cada um na CIPA.',
   'Permite ver a organização da comissão sem abrir cada cadastro.',
   '"Presidente"; "Titular".',
   'Ignorar que falta um presidente ou vice-presidente.',
   'compliance',210,1,'publicado'),
  ('ehs.cipa.col_representacao','/dashboard/ehs/cipa','CIPA','Coluna Representação',
   'Mostra a bancada (empregador/empregado) e o setor de cada membro.',
   'Ajuda a conferir a paridade da CIPA e a representatividade por área.',
   '"Empregado · Abate".',
   'Achar que a coluna mostra a função — ela mostra a bancada e o setor.',
   'compliance',220,1,'publicado'),
  ('ehs.cipa.col_mandato','/dashboard/ehs/cipa','CIPA','Coluna Mandato',
   'Mostra a gestão e o fim do mandato de cada membro.',
   'Deixa à vista quando a CIPA precisa ser renovada.',
   '"2026/2027 · fim 30/04/2027".',
   'Esquecer de renovar a CIPA quando o mandato se aproxima do fim.',
   'compliance',230,1,'publicado'),
  ('ehs.cipa.col_treinamento','/dashboard/ehs/cipa','CIPA','Coluna Treinamento',
   'Mostra a validade do treinamento de NR-5 e sinaliza vencido ou a vencer.',
   'É o alerta que diz quem precisa de reciclagem antes de perder a validade.',
   '"Vence 10/12/2026 · a vencer".',
   'Olhar só a data do treinamento e esquecer a validade.',
   'compliance',240,1,'publicado'),
  ('ehs.cipa.col_acoes','/dashboard/ehs/cipa','CIPA','Coluna Ações',
   'Editar abre o membro para ajustar dados e datas; Desativar tira o registro das listas sem apagar o histórico.',
   'Mantém o cadastro vivo sem perder o que já foi registrado.',
   'Desativar um membro que saiu da CIPA, informando o motivo.',
   'Apagar quando o certo é desativar (o histórico some).',
   'compliance',250,1,'publicado'),
  ('ehs.cipa.editar','/dashboard/ehs/cipa','CIPA','Editar',
   'Abre o membro para mudar função, representação, gestão/mandato e as datas do treinamento.',
   'Deixa o cadastro sempre correto para o alerta de reciclagem funcionar.',
   'Atualizar a validade assim que o membro faz a reciclagem.',
   'Criar outro cadastro quando era só editar o atual.',
   'compliance',260,1,'publicado'),
  ('ehs.cipa.desativar','/dashboard/ehs/cipa','CIPA','Desativar',
   'Tira o membro das listas, com um motivo, sem apagar o histórico (exclusão rastreável — RD-98).',
   'Corrige um cadastro errado ou registra a saída da CIPA sem perder o histórico.',
   'Desativar quem renunciou ao mandato, informando "renúncia".',
   'Desativar sem informar o motivo e depois não lembrar por quê.',
   'compliance',270,1,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo, o_que_preencher=EXCLUDED.o_que_preencher,
  para_que_serve=EXCLUDED.para_que_serve, exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();

-- 5) Blueprint vivo — refletir o que esta fatia atende (RD-38: eleição/atas/calendário na próxima) ─────
UPDATE public.blueprint_tela_requisito
   SET status_baseline='parcial',
       evidencia_baseline='Composição da CIPA (representação, função, gestão/mandato) + validade do treinamento e alerta de reciclagem · /dashboard/ehs/cipa (eleição online, atas e calendário nas próximas fatias)'
 WHERE vertical='ehs' AND tela_num=14 AND requisito LIKE 'CIPA (NR-5)%';

-- 6) SEED DE DEMONSTRAÇÃO — SÓ na DEMO EHS b0700000-...-000b (fictício; NUNCA cliente real) ────────────
INSERT INTO public.ehs_cipa
  (company_id, nome, matricula, representacao, funcao_cipa, setor, gestao, mandato_inicio, mandato_fim,
   eleito, data_treinamento, validade_treinamento, certificado, apto, observacao)
SELECT v.company_id, v.nome, v.matricula, v.representacao, v.funcao_cipa, v.setor, v.gestao, v.mandato_inicio, v.mandato_fim,
       v.eleito, v.data_treinamento, v.validade_treinamento, v.certificado, v.apto, v.observacao
FROM (VALUES
  ('b0700000-0000-4000-a000-00000000000b'::uuid,'Ana Ferreira','CP-001','empregador','presidente','Administração','2026/2027',
     DATE '2026-05-01', DATE '2027-04-30', false, DATE '2026-04-10', (CURRENT_DATE + 120), 'CIPA-2026-001', true, 'Presidente indicada pela empresa'),
  ('b0700000-0000-4000-a000-00000000000b'::uuid,'Carlos Souza','CP-014','empregado','vice_presidente','Abate','2026/2027',
     DATE '2026-05-01', DATE '2027-04-30', true, DATE '2026-04-10', (CURRENT_DATE + 20), 'CIPA-2026-014', true, 'Vice-presidente eleito · estabilidade NR-5'),
  ('b0700000-0000-4000-a000-00000000000b'::uuid,'Marcos Lima','CP-033','empregado','titular','Produção','2026/2027',
     DATE '2026-05-01', DATE '2027-04-30', true, DATE '2025-11-20', (CURRENT_DATE - 5), 'CIPA-2025-033', false, 'Reciclagem vencida — reconvocar'),
  ('b0700000-0000-4000-a000-00000000000b'::uuid,'Juliana Alves','CP-047','empregador','secretario','Expedição','2026/2027',
     DATE '2026-05-01', DATE '2027-04-30', false, DATE '2026-04-10', (CURRENT_DATE + 200), 'CIPA-2026-047', true, 'Secretária da comissão')
) AS v(company_id, nome, matricula, representacao, funcao_cipa, setor, gestao, mandato_inicio, mandato_fim,
       eleito, data_treinamento, validade_treinamento, certificado, apto, observacao)
WHERE NOT EXISTS (
  SELECT 1 FROM public.ehs_cipa e
   WHERE e.company_id = v.company_id AND e.matricula = v.matricula
);
