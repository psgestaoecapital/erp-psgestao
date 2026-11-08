-- Indústria · RH · Mão de Obra (CEO 06/11 · MODELO A decidido pelo Eng. Chefe 07/11).
-- ADITIVA e IDEMPOTENTE. Não altera dado de cliente. Só:
--   1) acrescenta a entrada de menu "Mão de Obra" na área Indústria, seção RH (subgrupo rh_ponto),
--      ao lado de "Folha" — module_catalog é a fonte do sidebar (fn_modulos_sidebar_por_area).
--   2) cadastra as chaves de ajuda "?" (RD-95) da tela /dashboard/industrial/mao-obra.
-- A tela é só LEITURA (folha_competencia × ind_pessoa, RLS company_id IN get_user_company_ids()).
-- Nenhuma RPC/RLS/grant novo; nenhuma exposição de PII além da folha de RH que já existe.

-- 1) Menu: "Mão de Obra" na Indústria (seção RH, logo após Folha = ordem 11)
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, rota, icone, ordem, ativo, legacy, is_shared, diferencial, so_ps)
VALUES ('industrial_mao_obra', 'Mão de Obra', 'industrial', 'rh_ponto', '/dashboard/industrial/mao-obra', 'Users', 12, true, false, false, false, false)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, subgrupo = EXCLUDED.subgrupo, rota = EXCLUDED.rota,
  icone = EXCLUDED.icone, ordem = EXCLUDED.ordem, ativo = EXCLUDED.ativo, legacy = EXCLUDED.legacy,
  is_shared = EXCLUDED.is_shared;

-- 2) Ajuda "?" (RD-95) da tela
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('industrial.mao_obra.competencia', '/dashboard/industrial/mao-obra', 'Mão de Obra', 'Competência',
   'Escolha o mês (competência) da folha que você quer analisar.',
   'Define de qual mês vêm o custo por setor e a lista de pessoas. Cada competência é uma folha importada.',
   '10/2026 mostra a folha de outubro de 2026.',
   'Não aparece o mês esperado? A folha daquela competência ainda não foi importada — importe em "Folha".',
   'industrial', 1),
  ('industrial.mao_obra.total', '/dashboard/industrial/mao-obra', 'Mão de Obra', 'Custo total (com encargos)',
   'Indicador calculado — você não preenche.',
   'Soma do custo de mão de obra da competência, já com encargos (base total_geral da folha). É a base do custo de pessoal para o BI de Custo.',
   'R$ 521.747,00 para a competência de 157 pessoas.',
   'Valor parece baixo? Confira se a folha importada tem todas as pessoas e se a competência selecionada é a certa.',
   'industrial', 2),
  ('industrial.mao_obra.pessoas', '/dashboard/industrial/mao-obra', 'Mão de Obra', 'Colaboradores',
   'Indicador calculado — você não preenche.',
   'Quantas pessoas estão na folha da competência selecionada (todas as matrículas, inclusive pró-labore e sem setor).',
   '157 colaboradores em outubro.',
   'Número diferente do esperado? Pode haver matrícula sem setor — ela aparece no grupo "⚠️ SEM SETOR", nunca some.',
   'industrial', 3),
  ('industrial.mao_obra.custo_setor', '/dashboard/industrial/mao-obra', 'Mão de Obra', 'Custo por setor',
   'Indicador calculado — você não preenche.',
   'Mostra quanto cada setor pesa no custo de mão de obra (agregado, com encargos). Pró-labore de sócios e "sem setor" ficam separados, nunca diluídos.',
   'Desossa R$ 120 mil · Abate R$ 95 mil · ...',
   'Setor errado numa pessoa? Corrija o setor da matrícula no cadastro de pessoas (ind_pessoa) e reimporte/atualize.',
   'industrial', 4),
  ('industrial.mao_obra.pessoas_setor', '/dashboard/industrial/mao-obra', 'Mão de Obra', 'Pessoas por setor',
   'Dado de RH — vem da folha importada; você não digita aqui.',
   'Lista, setor a setor, cada colaborador com a remuneração base e o custo com encargos. É dado sensível de RH, visível só dentro da empresa.',
   'No setor Abate: João — R$ 2.100 base / R$ 2.905 com encargos.',
   'Faltou alguém? A pessoa precisa estar na folha daquela competência; confira a importação em "Folha".',
   'industrial', 5)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, status = 'publicado', atualizado_em = now();
