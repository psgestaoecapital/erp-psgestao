-- PS EHS · Onda S1.1 — Riscos por Setor: entrada de menu + tela + ajuda de campo (RD-95).
--
-- A tela src/app/dashboard/ehs/riscos-setor/page.tsx lê/escreve prod_setor_risco (RLS por empresa,
-- já existente). Esta migration é ADITIVA e idempotente: registra o módulo no menu (module_catalog),
-- a tela em system_screens (para o usuário enxergar — RD-96 item 3) e os textos de ajuda dos campos
-- (erp_ajuda_campo). NÃO toca dado de cliente, NÃO cria/altera função, NÃO mexe em RLS/grants.
--
-- Nota de coordenação com o rename Compliance→EHS: a rota já vive em /dashboard/ehs (Fase 2 publicada);
-- grupo/area/vertical ficam 'compliance' por ora (a Fase 3 migra as chaves area/vertical em bloco).

-- 1) Menu (module_catalog) ──────────────────────────────────────────────────────────────────────
INSERT INTO public.module_catalog
  (id, nome, rota, ativo, grupo, icone, ordem, subgrupo, descricao, is_shared, so_ps, legacy, so_demo, diferencial, rbac_isento, dependencies, surface_in_groups)
VALUES
  ('compliance_riscos_setor', 'Riscos por Setor', '/dashboard/ehs/riscos-setor', true, 'compliance', 'AlertTriangle', 36,
   'incidentes_riscos',
   'Riscos ocupacionais por setor (GRO/PGR). O risco do setor vale para todos os postos e funcionários dele.',
   true, false, false, false, false, false, ARRAY[]::text[], ARRAY[]::text[])
ON CONFLICT (id) DO NOTHING;

-- 2) Catálogo de telas (system_screens) ─────────────────────────────────────────────────────────
INSERT INTO public.system_screens
  (id, rota, area, titulo, descricao_funcional, auditavel_robo, estado_real, prioridade_monitoramento, auditada_ok)
VALUES
  ('dashboard.compliance_riscos_setor', '/dashboard/ehs/riscos-setor', 'compliance', 'Riscos por Setor',
   'Inventário de riscos ocupacionais por setor (GRO/PGR); base da herança para postos e funcionários.',
   true, 'desconhecida', 'alta', false)
ON CONFLICT (id) DO NOTHING;

-- 3) Ajuda de campo (RD-95) ──────────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('ehs.riscos_setor.empresa', '/dashboard/ehs/riscos-setor', 'Riscos por Setor', 'Empresa',
   'Quando você cuida de mais de uma empresa, escolha aqui em qual delas vai cadastrar ou consultar os riscos.',
   'Cada empresa tem os seus próprios setores e riscos. A escolha filtra tudo o que aparece na tela e define onde o novo risco é salvo.',
   'Selecionar "Frioeste" para ver e editar só os riscos dos setores da Frioeste.',
   'Cadastrar um risco achando que está numa empresa e, na verdade, estar em outra. Confira o nome antes de incluir.',
   'compliance', 10, 1, 'publicado'),

  ('ehs.riscos_setor.busca', '/dashboard/ehs/riscos-setor', 'Riscos por Setor', 'Buscar',
   'Digite parte do nome do setor ou do texto do risco para filtrar a lista.',
   'Ajuda a achar rápido um setor ou um risco específico quando a empresa tem muitos setores.',
   'Digitar "abate" para ver só o setor de Abate; ou "ruído" para achar onde o ruído foi mapeado.',
   'Esperar que a busca procure por tipo de agente: para isso use o filtro "Tipo de agente".',
   'compliance', 20, 1, 'publicado'),

  ('ehs.riscos_setor.filtro_tipo', '/dashboard/ehs/riscos-setor', 'Riscos por Setor', 'Tipo de agente',
   'Escolha um tipo de agente para ver só os riscos daquele tipo em todos os setores.',
   'Os riscos ocupacionais se dividem em grupos (físico, químico, biológico, ergonômico e de acidente). O filtro ajuda a revisar um grupo de cada vez.',
   'Filtrar por "Físico" para conferir onde ruído, calor, frio e vibração estão mapeados.',
   'Deixar um filtro ligado e achar que um setor está sem riscos — na verdade ele só não tem riscos daquele tipo.',
   'compliance', 30, 1, 'publicado'),

  ('ehs.riscos_setor.setor', '/dashboard/ehs/riscos-setor', 'Riscos por Setor', 'Setor',
   'Escolha o setor onde este risco existe. O risco vai valer para todos os postos e funcionários desse setor.',
   'É a base da herança: cadastrando no setor, você não precisa repetir o risco posto a posto nem pessoa a pessoa.',
   'Selecionar "Abate" para registrar que naquele setor há exposição a frio e a agentes biológicos.',
   'Cadastrar no setor errado faz o risco aparecer para as pessoas erradas. Confira o setor antes de salvar.',
   'compliance', 40, 1, 'publicado'),

  ('ehs.riscos_setor.tipo', '/dashboard/ehs/riscos-setor', 'Riscos por Setor', 'Tipo de agente',
   'Classifique o risco em um dos grupos: Físico, Químico, Biológico, Ergonômico ou Acidente/Mecânico.',
   'A classificação organiza o inventário de riscos do GRO e orienta as medidas do PGR para cada grupo de agente.',
   'Ruído e frio = Físico; produtos de limpeza = Químico; contato com carne/vísceras = Biológico; esforço repetitivo = Ergonômico; peça cortante = Acidente.',
   'Classificar tudo como "Físico". Separar certo o tipo é o que deixa o PGR e os laudos corretos.',
   'compliance', 50, 1, 'publicado'),

  ('ehs.riscos_setor.descricao', '/dashboard/ehs/riscos-setor', 'Riscos por Setor', 'Descrição do risco',
   'Escreva, em poucas palavras, qual é o risco de verdade naquele setor.',
   'É o texto que aparece no inventário e nos documentos. Quanto mais claro, mais fácil para o técnico e o auditor entenderem.',
   '"Ruído contínuo acima de 85 dB(A) junto às serras"; "Frio na câmara de resfriamento"; "Agentes biológicos no abate".',
   'Escrever só "ruído" sem contexto. Diga onde e por quê, para a medida de controle fazer sentido.',
   'compliance', 60, 1, 'publicado'),

  ('ehs.riscos_setor.grau', '/dashboard/ehs/riscos-setor', 'Riscos por Setor', 'Grau / nível de exposição',
   'Opcional: registre o grau ou nível da exposição, quando já for conhecido (percentual de insalubridade ou valor medido).',
   'Guarda a severidade junto do risco, útil para o laudo, para a insalubridade e para priorizar as ações do PGR.',
   '"Insalubridade 20%"; "40%"; ou "87 dB(A) medido em 2026".',
   'Inventar um grau sem medição. Se não sabe ainda, deixe em branco e preencha quando o laudo sair.',
   'compliance', 70, 1, 'publicado')
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = EXCLUDED.status,
  atualizado_em = now();
