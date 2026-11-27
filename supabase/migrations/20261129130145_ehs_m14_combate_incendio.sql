-- PS EHS · EHS-9c / M14 — Comissões e programas · Extintores e hidrantes (NR-23)
-- (fatia 1: cadastro dos equipamentos de combate a incêndio com QR + alerta de recarga/vencimento)
--
-- Requisito do blueprint vivo (vertical 'ehs', M14 · onda E9):
--   • "Extintores e hidrantes (NR-23) com QR por equipamento, inspeção mensal no app, recarga e
--      vencimento com alerta."  -> esta fatia entrega CADASTRO + QR por equipamento + ALERTA de
--      recarga/vencimento (recarga, teste hidrostático). A INSPEÇÃO MENSAL no app vem na próxima
--      fatia -> por isso o blueprint fica 'parcial' (RD-38: só o que realmente entregou).
--
-- Company-scoped (RLS por empresa via get_user_company_ids(), igual a compliance_* e às fatias
-- #5692/#5706/#5714). ADITIVA: 1 tabela nova, RLS ligada, REVOKE anon, menu/tela 'completo'
-- (gate #5114 — só DEMO/contratante vê; NÃO vaza p/ a Frioeste), ajuda (RD-95), exclusão
-- rastreável (RD-98 p4: quem + quando + motivo, sem apagar) e SEED FICTÍCIO só na DEMO EHS
-- (b0700000-...-000b). Não toca nenhuma estrutura existente. Nenhum dado de cliente real.

-- 1) Tabela ──────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ehs_combate_incendio (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL,
  tipo                      text NOT NULL DEFAULT 'extintor'
                              CHECK (tipo IN ('extintor','hidrante','mangueira','abrigo_mangueira','sprinkler','outro')),
  -- Para extintor: classe do agente (NBR). Para hidrante/mangueira fica opcional.
  classe_agente             text,
  identificacao             text NOT NULL,            -- tag / nº de patrimônio do equipamento
  localizacao               text,
  setor                     text,
  capacidade                text,                     -- ex.: "6 kg", "10 L", "Ø 2½\""
  fabricante                text,
  data_fabricacao           date,
  data_ultima_recarga       date,
  validade_recarga          date,                     -- vencimento da recarga (alerta)
  proximo_teste_hidrostatico date,                    -- próximo teste hidrostático (alerta)
  -- QR por equipamento: código estável impresso/colado; abre a ficha no app ao escanear.
  qr_token                  text NOT NULL DEFAULT ('CBI-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  observacao                text,
  ativo                     boolean NOT NULL DEFAULT true,
  -- Exclusão rastreável (RD-98 p4): desativar guarda quem/quando/por quê, sem apagar o histórico.
  excluido_em               timestamptz,
  excluido_por              uuid,
  excluido_motivo           text,
  criado_por                uuid DEFAULT auth.uid(),
  criado_em                 timestamptz NOT NULL DEFAULT now(),
  atualizado_em             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ehs_cbi_empresa   ON public.ehs_combate_incendio (company_id, ativo, validade_recarga);
CREATE INDEX IF NOT EXISTS idx_ehs_cbi_tipo      ON public.ehs_combate_incendio (company_id, tipo);
CREATE INDEX IF NOT EXISTS idx_ehs_cbi_teste     ON public.ehs_combate_incendio (company_id, proximo_teste_hidrostatico);

-- 2) RLS por empresa (mesmo padrão de compliance_* / #5692 / #5714: get_user_company_ids()) ─────────────
ALTER TABLE public.ehs_combate_incendio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ehs_cbi_select ON public.ehs_combate_incendio;
DROP POLICY IF EXISTS ehs_cbi_insert ON public.ehs_combate_incendio;
DROP POLICY IF EXISTS ehs_cbi_update ON public.ehs_combate_incendio;
DROP POLICY IF EXISTS ehs_cbi_delete ON public.ehs_combate_incendio;
CREATE POLICY ehs_cbi_select ON public.ehs_combate_incendio FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_cbi_insert ON public.ehs_combate_incendio FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_cbi_update ON public.ehs_combate_incendio FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY ehs_cbi_delete ON public.ehs_combate_incendio FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

REVOKE ALL ON public.ehs_combate_incendio FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ehs_combate_incendio TO authenticated;
GRANT ALL ON public.ehs_combate_incendio TO service_role;

-- 3) Menu + tela (NASCE ehs_modulo='completo' — gate #5114; NULL vazaria p/ todos) ────────────────────
INSERT INTO public.module_catalog
  (id, nome, rota, ativo, grupo, icone, ordem, subgrupo, descricao, is_shared, so_ps, legacy, so_demo, diferencial, rbac_isento, dependencies, surface_in_groups, ehs_modulo)
VALUES
  ('ehs_combate_incendio', 'Extintores e hidrantes', '/dashboard/ehs/combate-incendio', true, 'compliance', 'Flame', 26,
   'incidentes_riscos',
   'Cadastro dos equipamentos de combate a incêndio (extintores, hidrantes, mangueiras) com QR por equipamento e alerta de recarga e de teste hidrostático (NR-23).',
   true, false, false, false, false, false, ARRAY[]::text[], ARRAY[]::text[], 'completo')
ON CONFLICT (id) DO UPDATE SET ehs_modulo = EXCLUDED.ehs_modulo, rota = EXCLUDED.rota, ativo = EXCLUDED.ativo, nome = EXCLUDED.nome, descricao = EXCLUDED.descricao;

INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, auditavel_robo, estado_real, prioridade_monitoramento, auditada_ok)
VALUES
  ('dashboard.ehs_combate_incendio', '/dashboard/ehs/combate-incendio', 'compliance', 'Extintores e hidrantes',
   'Cadastro dos equipamentos de combate a incêndio (extintor, hidrante, mangueira) com tipo, classe do agente, localização, capacidade, datas de recarga e de teste hidrostático e QR por equipamento, com alerta de recarga/vencimento, por empresa (M14 · NR-23). Piloto DEMO EHS.',
   true, 'desconhecida', 'alta', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, prioridade, descricao_executiva, descricao_tecnica)
VALUES ('F.ehs.combate_incendio', 'ehs_combate_incendio', 'compliance', 'Extintores e hidrantes', 'pronto', 100, 'alta',
        'Cadastro de equipamentos de combate a incêndio com QR e alerta de recarga/teste.', 'ehs_combate_incendio (RLS por empresa)')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.screen_route_features (screen_id, feature_id, peso)
VALUES ('dashboard.ehs_combate_incendio', 'F.ehs.combate_incendio', 1)
ON CONFLICT DO NOTHING;

-- 4) Ajuda de campo (RD-95) — uma chave por campo/coluna/ação da tela ─────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.cbi.empresa','/dashboard/ehs/combate-incendio','Combate a incêndio','Empresa',
   'Quando você cuida de mais de uma empresa, escolha aqui em qual vai cadastrar o equipamento.',
   'Define em qual empresa o equipamento é salvo e filtra a lista ao lado.',
   'Escolher a planta onde o extintor fica instalado antes de cadastrar.',
   'Cadastrar o equipamento achando que está numa empresa e estar em outra.',
   'compliance',10,1,'publicado'),
  ('ehs.cbi.busca','/dashboard/ehs/combate-incendio','Combate a incêndio','Buscar',
   'Digite parte da identificação, do local ou do setor para filtrar a lista.',
   'Ajuda a achar rápido um equipamento quando há muitos cadastrados.',
   '"câmara fria" para achar os extintores daquela área.',
   'Esperar que a busca procure pela validade: ela filtra por identificação, local e setor.',
   'compliance',20,1,'publicado'),
  ('ehs.cbi.filtro_tipo','/dashboard/ehs/combate-incendio','Combate a incêndio','Filtro de tipo',
   'Filtre a lista por tipo de equipamento: extintor, hidrante, mangueira, etc.',
   'Permite focar só nos extintores ou só nos hidrantes.',
   'Escolher "Hidrante" para conferir a rede de hidrantes.',
   'Achar que não há equipamentos quando o filtro está escondendo os outros tipos.',
   'compliance',30,1,'publicado'),
  ('ehs.cbi.filtro_situacao','/dashboard/ehs/combate-incendio','Combate a incêndio','Filtro de situação',
   'Filtre pela situação do vencimento: vencido, vence em breve ou em dia.',
   'Deixa à mão o que precisa de recarga ou teste antes de vencer.',
   'Escolher "Vencido" para ver o que está fora do prazo agora.',
   'Confundir "vence em breve" (alerta) com "vencido" (já passou).',
   'compliance',40,1,'publicado'),
  ('ehs.cbi.novo','/dashboard/ehs/combate-incendio','Combate a incêndio','Novo equipamento',
   'Cadastra um equipamento de combate a incêndio novo para a empresa escolhida.',
   'Abre o cadastro com tipo, local, datas de recarga/teste e gera o QR do equipamento.',
   'Cadastrar o extintor de pó ABC recém-instalado na expedição.',
   'Deixar de cadastrar um equipamento que já está instalado no local.',
   'compliance',50,1,'publicado'),
  ('ehs.cbi.tipo','/dashboard/ehs/combate-incendio','Combate a incêndio','Tipo',
   'Escolha o tipo do equipamento: extintor, hidrante, mangueira, abrigo de mangueira, sprinkler ou outro.',
   'Define quais campos fazem sentido (ex.: classe do agente para extintor) e como o equipamento aparece na lista.',
   '"Extintor" para o extintor de pó; "Hidrante" para o ponto de hidrante.',
   'Cadastrar um hidrante como extintor e perder o controle por tipo.',
   'compliance',60,1,'publicado'),
  ('ehs.cbi.classe_agente','/dashboard/ehs/combate-incendio','Combate a incêndio','Classe do agente',
   'Para extintor, informe o agente/classe: água, pó ABC, pó BC, CO₂, espuma mecânica, etc.',
   'Diz para que tipo de fogo o extintor serve e orienta a distribuição pela planta.',
   '"Pó ABC" para uso geral; "CO₂" perto de painéis elétricos.',
   'Deixar a classe errada e indicar um extintor inadequado para o risco do local.',
   'compliance',70,1,'publicado'),
  ('ehs.cbi.identificacao','/dashboard/ehs/combate-incendio','Combate a incêndio','Identificação',
   'Informe a identificação única do equipamento (tag, nº de patrimônio ou código).',
   'É como o equipamento é reconhecido na lista e na inspeção.',
   '"EXT-012"; "HID-03".',
   'Repetir a mesma identificação em dois equipamentos diferentes.',
   'compliance',80,1,'publicado'),
  ('ehs.cbi.localizacao','/dashboard/ehs/combate-incendio','Combate a incêndio','Localização',
   'Informe onde o equipamento está instalado (área, parede, ponto da planta).',
   'Ajuda a encontrar o equipamento e a conferir a cobertura por área.',
   '"Corredor da câmara fria 2"; "Doca de expedição — pilar B".',
   'Deixar em branco — sem o local fica difícil achar na inspeção.',
   'compliance',90,1,'publicado'),
  ('ehs.cbi.setor','/dashboard/ehs/combate-incendio','Combate a incêndio','Setor',
   'Opcional: o setor responsável pela área do equipamento.',
   'Permite acompanhar a cobertura e os vencimentos por setor.',
   '"Abate"; "Expedição"; "Manutenção".',
   'Confundir o setor com o local físico exato.',
   'compliance',100,1,'publicado'),
  ('ehs.cbi.capacidade','/dashboard/ehs/combate-incendio','Combate a incêndio','Capacidade',
   'Informe a capacidade/carga do equipamento.',
   'Registra a especificação do equipamento para reposição e inspeção.',
   '"6 kg" para extintor de pó; "10 L" para água; a bitola para mangueira.',
   'Deixar a capacidade em branco e não saber a carga na hora da recarga.',
   'compliance',110,1,'publicado'),
  ('ehs.cbi.fabricante','/dashboard/ehs/combate-incendio','Combate a incêndio','Fabricante',
   'Opcional: o fabricante ou a marca do equipamento.',
   'Ajuda no histórico e na reposição com o mesmo padrão.',
   '"Fabricante X".',
   'Confundir o fabricante com a empresa que fez a recarga.',
   'compliance',120,1,'publicado'),
  ('ehs.cbi.data_fabricacao','/dashboard/ehs/combate-incendio','Combate a incêndio','Data de fabricação',
   'Opcional: a data de fabricação gravada no equipamento.',
   'Base para a vida útil e para programar o teste hidrostático.',
   'A data estampada no casco do extintor.',
   'Informar a data da compra no lugar da fabricação.',
   'compliance',130,1,'publicado'),
  ('ehs.cbi.data_ultima_recarga','/dashboard/ehs/combate-incendio','Combate a incêndio','Última recarga',
   'Informe a data da última recarga do equipamento.',
   'Serve de referência para calcular o próximo vencimento da recarga.',
   'A data no selo da última recarga.',
   'Deixar a última recarga em branco e não ter base para o alerta.',
   'compliance',140,1,'publicado'),
  ('ehs.cbi.validade_recarga','/dashboard/ehs/combate-incendio','Combate a incêndio','Vencimento da recarga',
   'Informe a data em que a recarga vence (quando o equipamento precisa ser recarregado).',
   'É a data que dispara o alerta de "vence em breve" e "vencido" na lista.',
   'Um ano após a última recarga, conforme a norma do equipamento.',
   'Trocar o vencimento da recarga pelo teste hidrostático (são prazos diferentes).',
   'compliance',150,1,'publicado'),
  ('ehs.cbi.proximo_teste_hidrostatico','/dashboard/ehs/combate-incendio','Combate a incêndio','Próximo teste hidrostático',
   'Informe a data do próximo teste hidrostático do equipamento.',
   'Também dispara alerta: o teste hidrostático tem prazo próprio, mais longo que a recarga.',
   'A cada 5 anos para a maioria dos extintores, conforme o tipo.',
   'Confundir o teste hidrostático com a recarga anual.',
   'compliance',160,1,'publicado'),
  ('ehs.cbi.qr_token','/dashboard/ehs/combate-incendio','Combate a incêndio','QR do equipamento',
   'Código de QR gerado automaticamente para cada equipamento (não precisa digitar).',
   'Impresso e colado no equipamento, abre a ficha dele ao ser escaneado na inspeção.',
   '"CBI-A1B2C3D4E5" gerado ao salvar.',
   'Tentar reaproveitar o mesmo QR em dois equipamentos — cada um tem o seu.',
   'compliance',170,1,'publicado'),
  ('ehs.cbi.observacao','/dashboard/ehs/combate-incendio','Combate a incêndio','Observação',
   'Opcional: qualquer observação sobre o equipamento (estado, sinalização, acesso).',
   'Guarda detalhes úteis para a manutenção e a inspeção.',
   '"Sinalização de piso apagada"; "Acesso parcialmente obstruído por pallet".',
   'Escrever a observação e esquecer de abrir uma ação quando algo está irregular.',
   'compliance',180,1,'publicado'),
  ('ehs.cbi.col_identificacao','/dashboard/ehs/combate-incendio','Combate a incêndio','Coluna Identificação',
   'Mostra a identificação (tag) e o QR de cada equipamento.',
   'Identifica rapidamente o equipamento na lista.',
   '"EXT-012 · CBI-A1B2C3D4E5".',
   'Procurar pela validade na coluna de identificação.',
   'compliance',190,1,'publicado'),
  ('ehs.cbi.col_tipo','/dashboard/ehs/combate-incendio','Combate a incêndio','Coluna Tipo',
   'Mostra o tipo e, para extintor, a classe do agente.',
   'Permite ver o perfil dos equipamentos sem abrir cada um.',
   '"Extintor · Pó ABC"; "Hidrante".',
   'Ignorar a classe do agente ao avaliar a cobertura.',
   'compliance',200,1,'publicado'),
  ('ehs.cbi.col_local','/dashboard/ehs/combate-incendio','Combate a incêndio','Coluna Localização',
   'Mostra o local e o setor de cada equipamento.',
   'Ajuda a ver a distribuição pela planta.',
   '"Doca de expedição · Expedição".',
   'Achar que um equipamento sem setor não vale — o setor é opcional.',
   'compliance',210,1,'publicado'),
  ('ehs.cbi.col_vencimento','/dashboard/ehs/combate-incendio','Combate a incêndio','Coluna Vencimento',
   'Mostra o próximo vencimento (recarga ou teste hidrostático, o que vier antes) e sinaliza vencido ou a vencer.',
   'É o alerta que diz o que recarregar/testar antes de perder a validade.',
   '"Recarga vence 10/12/2026 · a vencer".',
   'Olhar só a recarga e esquecer o teste hidrostático (ou vice-versa).',
   'compliance',220,1,'publicado'),
  ('ehs.cbi.col_acoes','/dashboard/ehs/combate-incendio','Combate a incêndio','Coluna Ações',
   'Editar abre o equipamento para ajustar dados e datas; Desativar tira o registro das listas sem apagar o histórico.',
   'Mantém o cadastro vivo sem perder o que já foi registrado.',
   'Desativar um extintor retirado de uso, informando o motivo.',
   'Apagar quando o certo é desativar (o histórico some).',
   'compliance',230,1,'publicado'),
  ('ehs.cbi.editar','/dashboard/ehs/combate-incendio','Combate a incêndio','Editar',
   'Abre o equipamento para mudar tipo, local, capacidade e as datas de recarga/teste.',
   'Deixa o cadastro sempre correto para o alerta de vencimento funcionar.',
   'Atualizar a data da recarga assim que o selo novo é colado.',
   'Criar outro cadastro quando era só editar o atual.',
   'compliance',240,1,'publicado'),
  ('ehs.cbi.desativar','/dashboard/ehs/combate-incendio','Combate a incêndio','Desativar',
   'Tira o equipamento das listas, com um motivo, sem apagar o histórico (exclusão rastreável — RD-98).',
   'Corrige um cadastro errado ou retira um equipamento de uso sem perder o registro.',
   'Desativar um extintor condenado no teste, informando "reprovado no hidrostático".',
   'Desativar sem informar o motivo e depois não lembrar por quê.',
   'compliance',250,1,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo, o_que_preencher=EXCLUDED.o_que_preencher,
  para_que_serve=EXCLUDED.para_que_serve, exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();

-- 5) Blueprint vivo — refletir o que esta fatia atende (RD-38: inspeção mensal fica p/ próxima fatia) ──
UPDATE public.blueprint_tela_requisito
   SET status_baseline='parcial',
       evidencia_baseline='Cadastro + QR + alerta de recarga/teste · /dashboard/ehs/combate-incendio (inspeção mensal na próxima fatia)'
 WHERE vertical='ehs' AND tela_num=14 AND requisito LIKE 'Extintores e hidrantes (NR-23)%';

-- 6) SEED DE DEMONSTRAÇÃO — SÓ na DEMO EHS b0700000-...-000b (fictício; NUNCA cliente real) ────────────
INSERT INTO public.ehs_combate_incendio
  (company_id, tipo, classe_agente, identificacao, localizacao, setor, capacidade, fabricante,
   data_fabricacao, data_ultima_recarga, validade_recarga, proximo_teste_hidrostatico, observacao)
SELECT v.company_id, v.tipo, v.classe_agente, v.identificacao, v.localizacao, v.setor, v.capacidade, v.fabricante,
       v.data_fabricacao, v.data_ultima_recarga, v.validade_recarga, v.proximo_teste_hidrostatico, v.observacao
FROM (VALUES
  ('b0700000-0000-4000-a000-00000000000b'::uuid,'extintor','Pó ABC','EXT-012','Doca de expedição — pilar B','Expedição','6 kg','Fabricante A',
     DATE '2024-03-01', DATE '2025-12-10', (CURRENT_DATE + 20), (CURRENT_DATE + 900),'Sinalização de piso a revisar'),
  ('b0700000-0000-4000-a000-00000000000b'::uuid,'extintor','CO₂','EXT-021','Sala de painéis elétricos','Manutenção','6 kg','Fabricante A',
     DATE '2023-08-15', DATE '2025-10-01', (CURRENT_DATE - 5), (CURRENT_DATE + 400),'Próximo ao QGBT — manter desobstruído'),
  ('b0700000-0000-4000-a000-00000000000b'::uuid,'hidrante',NULL,'HID-03','Corredor da câmara fria 2','Produção','Ø 2½"','Fabricante B',
     DATE '2022-05-20', NULL, NULL, (CURRENT_DATE + 120),'Mangueira acoplada ao abrigo'),
  ('b0700000-0000-4000-a000-00000000000b'::uuid,'mangueira',NULL,'MAN-03A','Abrigo do hidrante HID-03','Produção','15 m','Fabricante B',
     DATE '2022-05-20', NULL, NULL, (CURRENT_DATE + 120),'Teste hidrostático junto com o hidrante')
) AS v(company_id, tipo, classe_agente, identificacao, localizacao, setor, capacidade, fabricante,
       data_fabricacao, data_ultima_recarga, validade_recarga, proximo_teste_hidrostatico, observacao)
WHERE NOT EXISTS (
  SELECT 1 FROM public.ehs_combate_incendio e
   WHERE e.company_id = v.company_id AND e.identificacao = v.identificacao
);
