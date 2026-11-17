-- PS EHS · Onda S1.2 — EPIs obrigatórios por POSTO (NR-6) · piloto DEMO · bucket ehs_completo
--
-- Marcar no posto quais EPIs são obrigatórios (do catálogo). Vale para todas as pessoas do posto (herança).
-- Backend prod_posto_epi (posto_id→prod_posto, catalogo_id→epi_catalogo) já existe. ADITIVA: REVOKE anon +
-- índice, tela classificada 'completo' (só a demo vê — gate #5114), ajuda (RD-95) e SEED FICTÍCIO só na
-- DEMO b0700000 (nunca Frioeste/cliente real).

-- 1) prod_posto_epi: anon fora + índice de leitura por empresa/posto (RLS/policy por empresa já existem)
REVOKE ALL ON public.prod_posto_epi FROM anon;
CREATE INDEX IF NOT EXISTS idx_prod_posto_epi_empresa_posto ON public.prod_posto_epi (company_id, posto_id);

-- 2) Menu + tela (NASCE ehs_modulo='completo' — obrigatório; NULL vazaria p/ todos)
INSERT INTO public.module_catalog
  (id, nome, rota, ativo, grupo, icone, ordem, subgrupo, descricao, is_shared, so_ps, legacy, so_demo, diferencial, rbac_isento, dependencies, surface_in_groups, ehs_modulo)
VALUES
  ('ehs_matriz_epi_posto', 'EPIs por Posto', '/dashboard/ehs/matriz/epi-posto', true, 'compliance', 'HardHat', 22,
   'controle_epis', 'EPIs obrigatórios por posto (NR-6). O EPI do posto é herdado por todas as pessoas dele.',
   true, false, false, false, false, false, ARRAY[]::text[], ARRAY[]::text[], 'completo')
ON CONFLICT (id) DO UPDATE SET ehs_modulo = EXCLUDED.ehs_modulo, rota = EXCLUDED.rota, ativo = EXCLUDED.ativo;

INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, auditavel_robo, estado_real, prioridade_monitoramento, auditada_ok)
VALUES
  ('dashboard.ehs_matriz_epi_posto', '/dashboard/ehs/matriz/epi-posto', 'compliance', 'EPIs por Posto',
   'EPIs obrigatórios por posto (NR-6), herdados pelas pessoas do posto. Piloto DEMO.',
   true, 'desconhecida', 'alta', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.feature_catalog (id, module_id, area, titulo, status, percentual_pronto, prioridade, descricao_executiva, descricao_tecnica)
VALUES ('F.ehs.matriz_epi_posto', 'ehs_matriz_epi_posto', 'compliance', 'EPIs por Posto', 'pronto', 100, 'alta',
        'Definição de EPIs obrigatórios por posto, com CA e riscos que o EPI protege.', 'prod_posto_epi + epi_catalogo; herança via prod_posto_pessoa')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.screen_route_features (screen_id, feature_id, peso)
VALUES ('dashboard.ehs_matriz_epi_posto', 'F.ehs.matriz_epi_posto', 1)
ON CONFLICT DO NOTHING;

-- 3) Ajuda de campo (RD-95)
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.epi_posto.empresa','/dashboard/ehs/matriz/epi-posto','EPIs por Posto','Empresa',
   'Quando você cuida de mais de uma empresa, escolha aqui em qual vai definir os EPIs.',
   'Filtra os postos/EPIs da tela e define onde o novo EPI é salvo.',
   'Selecionar a empresa certa antes de incluir um EPI no posto.',
   'Definir EPI achando que está numa empresa e estar em outra.',
   'compliance',10,1,'publicado'),
  ('ehs.epi_posto.busca','/dashboard/ehs/matriz/epi-posto','EPIs por Posto','Buscar',
   'Digite parte do número do posto, da atividade ou do setor para filtrar a lista.',
   'Ajuda a achar rápido um posto quando a empresa tem muitos.',
   '"desossa" para ver os postos da Desossa; "02" para o posto 02.',
   'Esperar que a busca procure pelo nome do EPI: para isso abra o posto.',
   'compliance',20,1,'publicado'),
  ('ehs.epi_posto.filtro_setor','/dashboard/ehs/matriz/epi-posto','EPIs por Posto','Setor',
   'Escolha um setor para ver só os postos dele.',
   'Organiza a revisão dos EPIs setor por setor.',
   'Filtrar por "Abate" para conferir os EPIs dos postos de abate.',
   'Deixar o filtro ligado e achar que faltam postos — eles estão em outro setor.',
   'compliance',30,1,'publicado'),
  ('ehs.epi_posto.heranca','/dashboard/ehs/matriz/epi-posto','EPIs por Posto','Herança (pessoas do posto)',
   'Mostra, só pra conferência, quantas pessoas do posto herdam os EPIs obrigatórios dele.',
   'É a prova da herança: o EPI do posto vale para todas as pessoas dele, sem recadastrar por pessoa.',
   '"obrigatório para 3 pessoas" no posto de Esfola.',
   'Achar que precisa marcar o EPI pessoa a pessoa — não precisa, a herança é automática.',
   'compliance',40,1,'publicado'),
  ('ehs.epi_posto.epi','/dashboard/ehs/matriz/epi-posto','EPIs por Posto','EPI do catálogo',
   'Escolha o EPI (do catálogo de EPIs) que é obrigatório neste posto. A tela mostra o CA, a validade e os riscos que ele protege.',
   'Liga o EPI certo ao posto; o CA e os riscos vêm do catálogo para não errar o equipamento.',
   'No Abate, escolher "Protetor auricular tipo plug (CA 90004)" por causa do ruído.',
   'Escolher um EPI que não protege do risco do posto. Confira os riscos que o EPI cobre.',
   'compliance',50,1,'publicado'),
  ('ehs.epi_posto.obrigatorio','/dashboard/ehs/matriz/epi-posto','EPIs por Posto','Obrigatoriedade',
   'Marque se o EPI é Obrigatório (uso exigido) ou Recomendado.',
   'Define a cobrança: obrigatório entra como pendência quando não entregue; recomendado é orientação.',
   'Luva de malha de aço = Obrigatório na desossa; óculos extra = Recomendado.',
   'Marcar tudo como recomendado. O obrigatório é o que gera a pendência de entrega.',
   'compliance',60,1,'publicado'),
  ('ehs.epi_posto.observacao','/dashboard/ehs/matriz/epi-posto','EPIs por Posto','Observação',
   'Opcional: uma nota sobre o uso do EPI neste posto (como usar, frequência de troca específica).',
   'Guarda a orientação junto do EPI, útil para o trabalhador e o técnico.',
   '"Trocar a cada turno"; "usar sob a luva de procedimento".',
   'Escrever a validade do CA aqui — isso já vem do catálogo.',
   'compliance',70,1,'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota=EXCLUDED.rota, grupo=EXCLUDED.grupo, rotulo=EXCLUDED.rotulo, o_que_preencher=EXCLUDED.o_que_preencher,
  para_que_serve=EXCLUDED.para_que_serve, exemplo=EXCLUDED.exemplo, erro_comum=EXCLUDED.erro_comum,
  vertical=EXCLUDED.vertical, ordem=EXCLUDED.ordem, status=EXCLUDED.status, atualizado_em=now();

-- 4) SEED DE DEMONSTRAÇÃO — SÓ na DEMO b0700000 (fictício; coerente com os riscos da S1.1).
-- Abate (ruído/frio/corte): protetor auricular + japona térmica + luva de malha.
-- Desossa (corte/frio): luva de malha + japona térmica + avental impermeável.
-- Join por NOME (robusto); UNIQUE(posto_id,catalogo_id) + ON CONFLICT deixam idempotente.
INSERT INTO public.prod_posto_epi (company_id, posto_id, catalogo_id, obrigatorio, observacao)
SELECT 'b0700000-0000-4000-a000-000000000005', po.id, ec.id, true, NULL
FROM public.prod_posto po
JOIN public.prod_setor s ON s.id = po.setor_id
JOIN (VALUES
  ('Abate','Protetor auricular tipo plug'),
  ('Abate','Japona térmica para câmara'),
  ('Abate','Luva de malha de aço'),
  ('Desossa','Luva de malha de aço'),
  ('Desossa','Japona térmica para câmara'),
  ('Desossa','Avental impermeável')
) AS m(setor_nome, epi_nome) ON lower(s.nome) = lower(m.setor_nome)
JOIN public.epi_catalogo ec ON ec.company_id = 'b0700000-0000-4000-a000-000000000005' AND lower(ec.nome) = lower(m.epi_nome)
WHERE po.company_id = 'b0700000-0000-4000-a000-000000000005'
ON CONFLICT (posto_id, catalogo_id) DO NOTHING;
