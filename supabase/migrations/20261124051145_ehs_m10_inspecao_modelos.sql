-- PS EHS · EHS-7 / M10 — Inspeções: fatia 1 "Modelos de checklist de inspeção"
--
-- Base do campo digital (M10): o técnico de SST monta UMA vez o modelo de checklist (perguntas com peso
-- e marcação de item crítico) e depois executa a inspeção no posto/setor a partir dele. Esta fatia entrega
-- só o CADASTRO DO MODELO (template) + seus itens; a execução da inspeção, o reprovado -> Plano de Ação
-- (reusa erp_plano_acao, já existente) e o DDS/relato vêm nas próximas fatias.
--
-- Company-scoped (RLS por empresa via get_user_company_ids(), igual a compliance_*). ADITIVA: 2 tabelas
-- novas, RLS ligada, REVOKE anon, menu/tela 'completo' (gate #5114 — só DEMO/contratante vê), ajuda (RD-95)
-- e SEED FICTÍCIO só na DEMO EHS (b0700000-...-000b). Nada de dado de cliente real.

-- 1) Tabelas ─────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ehs_inspecao_modelo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  nome          text NOT NULL,
  categoria     text NOT NULL DEFAULT 'geral'
                  CHECK (categoria IN ('epi','ordem_limpeza','seguranca','maquinas','geral')),
  nr_referencia text,
  descricao     text,
  ativo         boolean NOT NULL DEFAULT true,
  criado_por    uuid DEFAULT auth.uid(),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ehs_inspecao_item (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  modelo_id  uuid NOT NULL REFERENCES public.ehs_inspecao_modelo(id) ON DELETE CASCADE,
  ordem      integer NOT NULL DEFAULT 1,
  pergunta   text NOT NULL,
  peso       integer NOT NULL DEFAULT 1 CHECK (peso BETWEEN 1 AND 5),
  critico    boolean NOT NULL DEFAULT false,
  ativo      boolean NOT NULL DEFAULT true,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ehs_insp_modelo_empresa ON public.ehs_inspecao_modelo (company_id, ativo);
CREATE INDEX IF NOT EXISTS idx_ehs_insp_item_modelo    ON public.ehs_inspecao_item (modelo_id, ordem);
CREATE INDEX IF NOT EXISTS idx_ehs_insp_item_empresa   ON public.ehs_inspecao_item (company_id);

-- 2) RLS por empresa (mesmo padrão das tabelas compliance_*: get_user_company_ids()) ─────────────────
ALTER TABLE public.ehs_inspecao_modelo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ehs_inspecao_item   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS insp_modelo_select ON public.ehs_inspecao_modelo;
DROP POLICY IF EXISTS insp_modelo_insert ON public.ehs_inspecao_modelo;
DROP POLICY IF EXISTS insp_modelo_update ON public.ehs_inspecao_modelo;
DROP POLICY IF EXISTS insp_modelo_delete ON public.ehs_inspecao_modelo;
CREATE POLICY insp_modelo_select ON public.ehs_inspecao_modelo FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY insp_modelo_insert ON public.ehs_inspecao_modelo FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY insp_modelo_update ON public.ehs_inspecao_modelo FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY insp_modelo_delete ON public.ehs_inspecao_modelo FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

DROP POLICY IF EXISTS insp_item_select ON public.ehs_inspecao_item;
DROP POLICY IF EXISTS insp_item_insert ON public.ehs_inspecao_item;
DROP POLICY IF EXISTS insp_item_update ON public.ehs_inspecao_item;
DROP POLICY IF EXISTS insp_item_delete ON public.ehs_inspecao_item;
CREATE POLICY insp_item_select ON public.ehs_inspecao_item FOR SELECT
  USING (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY insp_item_insert ON public.ehs_inspecao_item FOR INSERT
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY insp_item_update ON public.ehs_inspecao_item FOR UPDATE
  USING (company_id IN (SELECT get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT get_user_company_ids()));
CREATE POLICY insp_item_delete ON public.ehs_inspecao_item FOR DELETE
  USING (company_id IN (SELECT get_user_company_ids()));

REVOKE ALL ON public.ehs_inspecao_modelo FROM anon;
REVOKE ALL ON public.ehs_inspecao_item   FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ehs_inspecao_modelo TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ehs_inspecao_item   TO authenticated;
GRANT ALL ON public.ehs_inspecao_modelo TO service_role;
GRANT ALL ON public.ehs_inspecao_item   TO service_role;

-- 3) Menu + tela (NASCE ehs_modulo='completo' — gate #5114; NULL vazaria p/ todos) ────────────────────
INSERT INTO public.module_catalog
  (id, nome, rota, ativo, grupo, icone, ordem, subgrupo, descricao, is_shared, so_ps, legacy, so_demo, diferencial, rbac_isento, dependencies, surface_in_groups, ehs_modulo)
VALUES
  ('ehs_inspecao_modelos', 'Modelos de inspeção', '/dashboard/ehs/inspecoes/modelos', true, 'compliance', 'ClipboardCheck', 22,
   'incidentes_riscos',
   'Monte uma vez o checklist de inspeção (perguntas com peso e itens críticos). A execução no campo usa estes modelos.',
   true, false, false, false, false, false, ARRAY[]::text[], ARRAY[]::text[], 'completo')
ON CONFLICT (id) DO UPDATE SET ehs_modulo = EXCLUDED.ehs_modulo, rota = EXCLUDED.rota, ativo = EXCLUDED.ativo, nome = EXCLUDED.nome, descricao = EXCLUDED.descricao;

INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, auditavel_robo, estado_real, prioridade_monitoramento, auditada_ok)
VALUES
  ('dashboard.ehs_inspecao_modelos', '/dashboard/ehs/inspecoes/modelos', 'compliance', 'Modelos de inspeção',
   'Cadastro de modelos de checklist de inspeção (perguntas, peso, item crítico) por empresa; base da execução de campo (M10). Piloto DEMO EHS.',
   true, 'desconhecida', 'alta', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, prioridade, descricao_executiva, descricao_tecnica)
VALUES ('F.ehs.inspecao_modelos', 'ehs_inspecao_modelos', 'compliance', 'Modelos de inspeção', 'pronto', 100, 'alta',
        'Modelos de checklist de inspeção reutilizáveis, com peso por pergunta e item crítico.', 'ehs_inspecao_modelo + ehs_inspecao_item (RLS por empresa)')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.screen_route_features (screen_id, feature_id, peso)
VALUES ('dashboard.ehs_inspecao_modelos', 'F.ehs.inspecao_modelos', 1)
ON CONFLICT DO NOTHING;

-- 4) Ajuda de campo (RD-95) — uma chave por campo/coluna/ação da tela ─────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.insp_modelo.empresa','/dashboard/ehs/inspecoes/modelos','Modelos de inspeção','Empresa',
   'Quando você cuida de mais de uma empresa, escolha aqui em qual vai criar o modelo de inspeção.',
   'Define em qual empresa o modelo é salvo e filtra a lista ao lado.',
   'Escolher a empresa certa antes de criar o checklist.',
   'Criar o modelo achando que está numa empresa e estar em outra.',
   'compliance',10,1,'publicado'),
  ('ehs.insp_modelo.busca','/dashboard/ehs/inspecoes/modelos','Modelos de inspeção','Buscar',
   'Digite parte do nome do modelo para filtrar a lista.',
   'Ajuda a achar rápido um modelo quando há muitos.',
   '"EPI" para achar o checklist de inspeção de EPI.',
   'Esperar que a busca procure pelas perguntas: ela filtra pelo nome do modelo.',
   'compliance',20,1,'publicado'),
  ('ehs.insp_modelo.novo','/dashboard/ehs/inspecoes/modelos','Modelos de inspeção','Novo modelo',
   'Cria um modelo de checklist novo, do zero, para a empresa escolhida.',
   'O modelo guarda as perguntas da inspeção para reusar em cada execução no campo.',
   'Criar "Inspeção de EPI no posto" com as perguntas de uso e validade do EPI.',
   'Criar um modelo duplicado em vez de editar o que já existe.',
   'compliance',30,1,'publicado'),
  ('ehs.insp_modelo.nome','/dashboard/ehs/inspecoes/modelos','Modelos de inspeção','Nome do modelo',
   'Dê um nome curto e claro para o checklist, como ele será reconhecido na hora de inspecionar.',
   'É o nome que o inspetor escolhe no campo ao iniciar uma inspeção.',
   '"Inspeção de ordem e limpeza (5S)"; "Checklist de EPI no posto".',
   'Nome vago como "Checklist 1" que ninguém entende depois.',
   'compliance',40,1,'publicado'),
  ('ehs.insp_modelo.categoria','/dashboard/ehs/inspecoes/modelos','Modelos de inspeção','Categoria',
   'Classifique o modelo: EPI, Ordem e limpeza, Segurança, Máquinas ou Geral.',
   'Organiza os modelos por assunto e ajuda a achar o certo na hora da inspeção.',
   'Um checklist de guarda-corpo e proteção de máquina = Máquinas.',
   'Jogar tudo em "Geral" e perder a organização.',
   'compliance',50,1,'publicado'),
  ('ehs.insp_modelo.nr_referencia','/dashboard/ehs/inspecoes/modelos','Modelos de inspeção','Norma de referência',
   'Opcional: a norma (NR) que o checklist cobre, se houver uma principal.',
   'Mostra a base legal do checklist e ajuda o auditor a conferir a cobertura da NR.',
   '"NR-06" para EPI; "NR-12" para máquinas; "NR-35" para altura.',
   'Preencher uma NR que o checklist não cobre de verdade.',
   'compliance',60,1,'publicado'),
  ('ehs.insp_modelo.descricao','/dashboard/ehs/inspecoes/modelos','Modelos de inspeção','Descrição',
   'Opcional: explique em uma linha quando e onde usar este checklist.',
   'Orienta o inspetor sobre o uso certo do modelo no campo.',
   '"Usar em toda troca de turno nos postos da linha de abate".',
   'Repetir o nome do modelo sem acrescentar informação útil.',
   'compliance',70,1,'publicado'),
  ('ehs.insp_modelo.itens','/dashboard/ehs/inspecoes/modelos','Modelos de inspeção','Perguntas do checklist',
   'Liste as perguntas que o inspetor vai responder (conforme / não conforme) no campo.',
   'São os pontos verificados na inspeção; cada um pode ter peso e ser marcado como crítico.',
   '"O trabalhador está usando o protetor auricular?"; "A guarda da serra está instalada?".',
   'Perguntas longas ou ambíguas que o inspetor não consegue responder com sim/não.',
   'compliance',80,1,'publicado'),
  ('ehs.insp_modelo.item_pergunta','/dashboard/ehs/inspecoes/modelos','Modelos de inspeção','Pergunta',
   'Escreva a pergunta de verificação de forma objetiva, respondível com conforme/não conforme.',
   'É o item que o inspetor marca no campo; vira não conformidade quando reprovado.',
   '"O extintor está no lugar, cheio e com lacre?".',
   'Fazer duas perguntas numa só ("extintor e saída de emergência?").',
   'compliance',90,1,'publicado'),
  ('ehs.insp_modelo.item_peso','/dashboard/ehs/inspecoes/modelos','Modelos de inspeção','Peso',
   'Dê um peso de 1 a 5 para a pergunta conforme a importância dela na pontuação.',
   'Perguntas com peso maior pesam mais na nota final da inspeção.',
   'Uso de EPI de proteção respiratória = peso 5; organização da bancada = peso 1.',
   'Dar peso 5 para tudo — a pontuação perde o sentido.',
   'compliance',100,1,'publicado'),
  ('ehs.insp_modelo.item_critico','/dashboard/ehs/inspecoes/modelos','Modelos de inspeção','Item crítico',
   'Marque quando um "não conforme" nesta pergunta já reprova a inspeção, por si só.',
   'Item crítico reprovado gera ação imediata independentemente da nota geral.',
   'Trabalho em altura sem cinto = crítico; piso um pouco sujo = não crítico.',
   'Marcar tudo como crítico e tirar o sentido da classificação.',
   'compliance',110,1,'publicado'),
  ('ehs.insp_modelo.col_nome','/dashboard/ehs/inspecoes/modelos','Modelos de inspeção','Coluna Modelo',
   'Mostra o nome de cada modelo de checklist cadastrado.',
   'Identifica o checklist na lista.',
   '"Inspeção de EPI no posto".',
   'Confundir dois modelos de nome parecido.',
   'compliance',120,1,'publicado'),
  ('ehs.insp_modelo.col_categoria','/dashboard/ehs/inspecoes/modelos','Modelos de inspeção','Coluna Categoria',
   'Mostra a categoria do modelo (EPI, Ordem e limpeza, Segurança, Máquinas, Geral).',
   'Ajuda a agrupar e achar o modelo certo.',
   'Categoria "EPI" para o checklist de equipamentos de proteção.',
   'Ler a categoria achando que é a NR.',
   'compliance',130,1,'publicado'),
  ('ehs.insp_modelo.col_itens','/dashboard/ehs/inspecoes/modelos','Modelos de inspeção','Coluna Perguntas',
   'Mostra quantas perguntas ativas o modelo tem.',
   'Dá uma ideia do tamanho do checklist antes de abri-lo.',
   '"8 perguntas" num checklist de EPI.',
   'Achar que um modelo com 0 perguntas está pronto para inspecionar.',
   'compliance',140,1,'publicado'),
  ('ehs.insp_modelo.col_acoes','/dashboard/ehs/inspecoes/modelos','Modelos de inspeção','Coluna Ações',
   'Editar abre o modelo e suas perguntas; Desativar tira o modelo das listas sem apagar o histórico.',
   'Mantém o cadastro vivo sem perder o que já foi usado em inspeções.',
   'Desativar um checklist antigo substituído por um novo.',
   'Apagar quando o certo é desativar (o histórico de inspeções some).',
   'compliance',150,1,'publicado'),
  ('ehs.insp_modelo.editar','/dashboard/ehs/inspecoes/modelos','Modelos de inspeção','Editar',
   'Abre o modelo para mudar nome, categoria, norma, descrição e as perguntas.',
   'Deixa o checklist sempre atualizado sem criar outro do zero.',
   'Acrescentar uma pergunta nova de EPI ao checklist existente.',
   'Criar um modelo novo quando era só editar o atual.',
   'compliance',160,1,'publicado'),
  ('ehs.insp_modelo.desativar','/dashboard/ehs/inspecoes/modelos','Modelos de inspeção','Desativar',
   'Tira o modelo das listas de inspeção, com um motivo, sem apagar o que já foi inspecionado.',
   'Aposenta um checklist sem perder o histórico (exclusão rastreável — RD-98).',
   'Desativar "Checklist antigo de EPI" ao publicar a versão revisada.',
   'Desativar sem informar o motivo e depois não lembrar por quê.',
   'compliance',170,1,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo, o_que_preencher=EXCLUDED.o_que_preencher,
  para_que_serve=EXCLUDED.para_que_serve, exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();

-- 5) SEED DE DEMONSTRAÇÃO — SÓ na DEMO EHS b0700000-...-000b (fictício; NUNCA cliente real) ────────────
-- Modelo 1: Inspeção de EPI no posto (NR-06)
INSERT INTO public.ehs_inspecao_modelo (company_id, nome, categoria, nr_referencia, descricao)
SELECT 'b0700000-0000-4000-a000-00000000000b','Inspeção de EPI no posto','epi','NR-06',
       'Checklist de uso, estado e validade dos EPIs no posto de trabalho.'
WHERE NOT EXISTS (SELECT 1 FROM public.ehs_inspecao_modelo m
  WHERE m.company_id='b0700000-0000-4000-a000-00000000000b' AND lower(m.nome)=lower('Inspeção de EPI no posto'));

-- Modelo 2: Inspeção de ordem e limpeza (5S)
INSERT INTO public.ehs_inspecao_modelo (company_id, nome, categoria, nr_referencia, descricao)
SELECT 'b0700000-0000-4000-a000-00000000000b','Inspeção de ordem e limpeza (5S)','ordem_limpeza',NULL,
       'Checklist de organização, limpeza e padronização do setor.'
WHERE NOT EXISTS (SELECT 1 FROM public.ehs_inspecao_modelo m
  WHERE m.company_id='b0700000-0000-4000-a000-00000000000b' AND lower(m.nome)=lower('Inspeção de ordem e limpeza (5S)'));

-- Itens do Modelo 1 (idempotentes por modelo + pergunta)
INSERT INTO public.ehs_inspecao_item (company_id, modelo_id, ordem, pergunta, peso, critico)
SELECT 'b0700000-0000-4000-a000-00000000000b', m.id, v.ordem, v.pergunta, v.peso, v.critico
FROM public.ehs_inspecao_modelo m
JOIN (VALUES
  (1,'O trabalhador está usando todos os EPIs exigidos para o posto?',5,true),
  (2,'Os EPIs estão em bom estado de conservação (sem rasgos, trincas ou desgaste)?',4,false),
  (3,'O Certificado de Aprovação (CA) dos EPIs está dentro da validade?',4,false),
  (4,'O trabalhador sabe usar e higienizar corretamente o EPI?',2,false)
) AS v(ordem, pergunta, peso, critico) ON true
WHERE m.company_id='b0700000-0000-4000-a000-00000000000b' AND lower(m.nome)=lower('Inspeção de EPI no posto')
  AND NOT EXISTS (SELECT 1 FROM public.ehs_inspecao_item i WHERE i.modelo_id=m.id AND i.pergunta=v.pergunta);

-- Itens do Modelo 2
INSERT INTO public.ehs_inspecao_item (company_id, modelo_id, ordem, pergunta, peso, critico)
SELECT 'b0700000-0000-4000-a000-00000000000b', m.id, v.ordem, v.pergunta, v.peso, v.critico
FROM public.ehs_inspecao_modelo m
JOIN (VALUES
  (1,'As áreas de circulação estão livres de obstáculos?',3,false),
  (2,'As ferramentas e materiais estão guardados nos lugares definidos?',2,false),
  (3,'O setor está limpo, sem acúmulo de resíduos ou vazamentos?',3,false),
  (4,'As saídas de emergência e extintores estão desobstruídos e sinalizados?',5,true)
) AS v(ordem, pergunta, peso, critico) ON true
WHERE m.company_id='b0700000-0000-4000-a000-00000000000b' AND lower(m.nome)=lower('Inspeção de ordem e limpeza (5S)')
  AND NOT EXISTS (SELECT 1 FROM public.ehs_inspecao_item i WHERE i.modelo_id=m.id AND i.pergunta=v.pergunta);
