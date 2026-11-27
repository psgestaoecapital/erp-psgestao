-- =====================================================================
-- Indústria · RH — Cadastro de pessoas com custo completo (mesma ficha do Hub), puxando do PONTO e da FOLHA.
-- CEO 25/11 (cliente piloto industrial). RD-26 (reusa a tela do Hub via componente), RD-38 (provado no dado),
-- RD-95 (ajuda "?" em cada campo novo). Só funções + catálogo de menu + ajuda — NÃO altera dado de cliente.
--
-- Join provado no piloto: compliance_funcionarios ↔ ind_ponto_colaborador por CPF (214/228); folha_competencia por
-- MATRÍCULA (a folha importada NÃO tem CPF — 0 de 332; por matrícula casa 215). Jornada: ind_ponto_jornada (vigente).
-- Função sugerida: casa ind_ponto_colaborador.funcao com erp_funcao_mao_obra.nome por lower(btrim()).
-- DSR NÃO vira componente sugerido: a ficha já calcula o reflexo pelas chaves de incidência (evita dobra).
-- =====================================================================

-- 1) Trazer funções do ponto: cria em erp_funcao_mao_obra as funções distintas do ponto (idempotente por nome).
CREATE OR REPLACE FUNCTION public.fn_mao_obra_funcoes_do_ponto(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_criadas int; v_total int;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  PERFORM public.fn__mao_obra_exige_gestor(p_company_id);
  SELECT count(*) INTO v_total
  FROM (SELECT DISTINCT btrim(c.funcao) AS nome FROM ind_ponto_colaborador c
        WHERE c.company_id = p_company_id AND NULLIF(btrim(c.funcao), '') IS NOT NULL) d;
  INSERT INTO erp_funcao_mao_obra (company_id, nome, forma_pagamento, ativo, created_by)
  SELECT p_company_id, d.nome, 'mensal', true, auth.uid()
  FROM (SELECT DISTINCT btrim(c.funcao) AS nome FROM ind_ponto_colaborador c
        WHERE c.company_id = p_company_id AND NULLIF(btrim(c.funcao), '') IS NOT NULL) d
  WHERE NOT EXISTS (SELECT 1 FROM erp_funcao_mao_obra f WHERE f.company_id = p_company_id AND lower(btrim(f.nome)) = lower(d.nome));
  GET DIAGNOSTICS v_criadas = ROW_COUNT;
  -- existentes = total distinto do ponto menos os criados agora (contar depois do INSERT marcaria tudo como existente)
  RETURN jsonb_build_object('ok', true, 'criadas', COALESCE(v_criadas, 0), 'existentes', COALESCE(v_total, 0) - COALESCE(v_criadas, 0));
END $function$;

REVOKE ALL ON FUNCTION public.fn_mao_obra_funcoes_do_ponto(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_funcoes_do_ponto(uuid) TO authenticated, service_role;

-- 2) Pessoas do ponto sem ficha de custo + sugestão da folha (remuneração + adicionais) e jornada da escala.
--    Só leitura. LGPD: CPF mascarado e remuneração/verbas nulas para quem não pode ver o individual.
CREATE OR REPLACE FUNCTION public.fn_mao_obra_pessoas_sem_ficha(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_pode boolean; v_comp date; v_rows jsonb;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  v_pode := public.fn__mao_obra_pode_ver_individual(p_company_id);
  SELECT max(competencia) INTO v_comp FROM folha_competencia WHERE company_id = p_company_id;
  WITH ponto AS (
    SELECT DISTINCT ON (regexp_replace(COALESCE(c.cpf, ''), '\D', '', 'g'))
           regexp_replace(COALESCE(c.cpf, ''), '\D', '', 'g') AS cpf_n,
           c.funcao AS funcao_ponto, NULLIF(btrim(c.departamento), '') AS setor, c.admissao, c.matricula AS matricula_ponto
    FROM ind_ponto_colaborador c
    WHERE c.company_id = p_company_id AND c.cpf IS NOT NULL
    ORDER BY regexp_replace(COALESCE(c.cpf, ''), '\D', '', 'g'), c.sincronizado_em DESC NULLS LAST
  ),
  jornada AS (
    SELECT DISTINCT ON (regexp_replace(COALESCE(j.cpf, ''), '\D', '', 'g'))
           regexp_replace(COALESCE(j.cpf, ''), '\D', '', 'g') AS cpf_n, j.horas_mes
    FROM ind_ponto_jornada j
    WHERE j.company_id = p_company_id AND j.cpf IS NOT NULL
    ORDER BY regexp_replace(COALESCE(j.cpf, ''), '\D', '', 'g'),
             (j.vigencia_fim IS NULL OR j.vigencia_fim >= current_date) DESC,
             COALESCE(j.vigencia_inicio, DATE '0001-01-01') DESC, j.atualizado_em DESC
  ),
  folha AS (
    SELECT DISTINCT ON (fc.matricula) fc.matricula, fc.remuneracao, fc.competencia, fc.id
    FROM folha_competencia fc
    WHERE fc.company_id = p_company_id AND fc.matricula IS NOT NULL
    ORDER BY fc.matricula, fc.competencia DESC
  ),
  base AS (
    SELECT cf.id AS funcionario_id, cf.nome_completo AS nome, cf.cpf, cf.matricula,
           p.funcao_ponto, p.setor, COALESCE(p.admissao, cf.data_admissao) AS admissao,
           fn.id AS funcao_id, fn.nome AS funcao_sugerida, j.horas_mes AS jornada_horas_mes,
           fo.remuneracao, fo.competencia AS folha_competencia, fo.id AS folha_id
    FROM compliance_funcionarios cf
    JOIN ponto p ON p.cpf_n = regexp_replace(COALESCE(cf.cpf, ''), '\D', '', 'g')
    LEFT JOIN jornada j ON j.cpf_n = regexp_replace(COALESCE(cf.cpf, ''), '\D', '', 'g')
    LEFT JOIN folha fo ON p.matricula_ponto ~ '^[0-9]+$' AND fo.matricula = p.matricula_ponto::bigint
    LEFT JOIN LATERAL (
      SELECT f2.id, f2.nome FROM erp_funcao_mao_obra f2
      WHERE f2.company_id = p_company_id AND f2.ativo
        AND lower(btrim(f2.nome)) = lower(btrim(p.funcao_ponto))
      ORDER BY (f2.unida_a_id IS NULL) DESC, f2.created_at LIMIT 1
    ) fn ON true
    WHERE cf.company_id = p_company_id AND COALESCE(cf.ativo, true) AND cf.cpf IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM erp_mao_obra_custo mc WHERE mc.funcionario_id = cf.id AND mc.vigencia_fim IS NULL)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'funcionario_id', b.funcionario_id,
    'nome', b.nome,
    'cpf', CASE WHEN v_pode THEN b.cpf ELSE '***.***.***-' || right(regexp_replace(COALESCE(b.cpf, ''), '\D', '', 'g'), 2) END,
    'matricula', b.matricula,
    'funcao_ponto', b.funcao_ponto,
    'funcao_id', b.funcao_id,
    'funcao_sugerida', b.funcao_sugerida,
    'setor', b.setor,
    'admissao', b.admissao,
    'jornada_horas_mes', b.jornada_horas_mes,
    'remuneracao', CASE WHEN v_pode THEN b.remuneracao ELSE NULL END,
    'folha_competencia', b.folha_competencia,
    'verbas', CASE WHEN v_pode AND b.folha_id IS NOT NULL THEN (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('tipo', vt.tipo, 'descricao', v.descricao, 'valor', v.valor, 'sugerir', vt.sugerir) ORDER BY v.valor DESC), '[]'::jsonb)
      FROM folha_verba v
      CROSS JOIN LATERAL (SELECT
        CASE
          WHEN v.descricao ~* 'INSALUB' THEN 'insalubridade'
          WHEN v.descricao ~* 'PERICUL' THEN 'periculosidade'
          WHEN v.descricao ~* '(HORA[S]? EXTRA|H\.?\s?E\.?)' THEN 'he'
          WHEN v.descricao ~* 'NOTURN' THEN 'noturno'
          WHEN v.descricao ~* '(DSR|REPOUSO)' THEN 'dsr'
          ELSE NULL END AS tipo,
        (v.descricao !~* '(DSR|REPOUSO)') AS sugerir
      ) vt
      WHERE v.folha_competencia_id = b.folha_id AND v.tipo = 'provento'
        AND v.codigo_verba <> 'REMUNERACAO' AND vt.tipo IS NOT NULL AND COALESCE(v.valor, 0) > 0
    ) ELSE '[]'::jsonb END
  ) ORDER BY b.nome), '[]'::jsonb) INTO v_rows FROM base b;
  RETURN jsonb_build_object('pode_ver_individual', v_pode, 'competencia', v_comp, 'pessoas', v_rows);
END $function$;

REVOKE ALL ON FUNCTION public.fn_mao_obra_pessoas_sem_ficha(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_mao_obra_pessoas_sem_ficha(uuid) TO authenticated, service_role;

-- 3) Menu: Cadastro de pessoas (custo completo) na Indústria › RH, logo antes de "Quadro de pessoal" (ordem 5).
INSERT INTO module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, is_shared, legacy)
VALUES ('industrial_rh_pessoas', 'Cadastro de pessoas (custo completo)', 'industrial', 'recursos_humanos', 'Users',
        '/dashboard/industrial/rh/pessoas', 4, true,
        'Cadastro de pessoas com custo completo (a mesma ficha do Hub), puxando do ponto e da folha ou digitado.', false, false)
ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, subgrupo = EXCLUDED.subgrupo,
  icone = EXCLUDED.icone, rota = EXCLUDED.rota, ordem = EXCLUDED.ordem, ativo = true,
  descricao = EXCLUDED.descricao, is_shared = false, legacy = false;

INSERT INTO system_screens (id, rota, area, titulo, modulo, descricao_funcional, estado_real)
VALUES (gen_random_uuid(), '/dashboard/industrial/rh/pessoas', 'industrial', 'Cadastro de pessoas (custo completo)',
        'industrial_rh_pessoas', 'Cadastro de pessoas com custo completo (mesma ficha do Hub): traz funções e pessoas do ponto, sugere custo da folha e cria fichas (individual ou em lote).', 'pronto')
ON CONFLICT (rota) DO UPDATE SET area = EXCLUDED.area, titulo = EXCLUDED.titulo, modulo = EXCLUDED.modulo,
  descricao_funcional = EXCLUDED.descricao_funcional, atualizado_em = now();

-- 4) Ajuda de campo (RD-95) — chaves novas, status 'publicado'.
INSERT INTO erp_ajuda_campo (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, status, versao)
VALUES
 ('projetos.mao_obra.ponto.acao.trazer_funcoes', '/dashboard/industrial/rh/pessoas', 'Pessoas e custo', 'industrial', 'Trazer funções do ponto',
  'Clique para criar, de uma vez, as funções que já existem no ponto (cada função distinta vira uma função do catálogo).',
  'Sem função cadastrada a ficha de custo não pode ser salva; este botão evita digitar função por função.',
  'O ponto tem "Auxiliar de produção", "Operador" e "Encarregado" → cria as três como funções mensais.',
  'Rodar de novo não duplica: funções já existentes são mantidas (idempotente).', 'publicado', 1),
 ('projetos.mao_obra.ponto.acao.criar_ficha', '/dashboard/industrial/rh/pessoas', 'Pessoas e custo', 'industrial', 'Criar ficha',
  'Abre a ficha de custo já preenchida para esta pessoa (função, jornada e sugestão da folha); confira e salve.',
  'Cadastra o custo da pessoa sem redigitar nome, CPF e admissão (ela já existe no cadastro).',
  'Clica em "Criar ficha" do operador → a ficha abre com a remuneração da última folha; você ajusta e salva.',
  'A ficha nasce não conferida: ela só entra no custo da função depois de você conferir.', 'publicado', 1),
 ('projetos.mao_obra.ponto.acao.criar_lote', '/dashboard/industrial/rh/pessoas', 'Pessoas e custo', 'industrial', 'Criar fichas em lote',
  'Cria a ficha de várias pessoas de uma vez, usando a sugestão da folha de cada uma.',
  'Acelera o cadastro inicial de dezenas de pessoas; cada uma vira uma ficha não conferida.',
  'Selecione o setor "Desossa", marque todos e clique em "Criar fichas em lote".',
  'Pessoa sem remuneração na folha não entra no lote — crie a ficha dela manualmente.', 'publicado', 1),
 ('projetos.mao_obra.ponto.filtro_setor', '/dashboard/industrial/rh/pessoas', 'Pessoas e custo', 'industrial', 'Setor',
  'Escolha um setor para ver só as pessoas daquele setor (departamento do ponto).',
  'Facilita cadastrar o custo setor a setor, sem perder ninguém.',
  'Escolha "Abate" para ver só quem é do abate.',
  'O setor vem do departamento do ponto; pessoa sem departamento aparece em "Todos os setores".', 'publicado', 1),
 ('projetos.mao_obra.ponto.sel', '/dashboard/industrial/rh/pessoas', 'Pessoas e custo', 'industrial', 'Selecionar',
  'Marque as pessoas que quer criar em lote; a caixa do cabeçalho marca ou desmarca todas as visíveis.',
  'Define quem entra no "Criar fichas em lote".',
  'Marque as 20 pessoas do setor para criar as fichas de uma vez.',
  'A seleção considera só as pessoas visíveis no filtro atual.', 'publicado', 1),
 ('projetos.mao_obra.ponto.col_nome', '/dashboard/industrial/rh/pessoas', 'Pessoas e custo', 'industrial', 'Nome',
  'Nome da pessoa no cadastro compartilhado (o mesmo do SST e do ponto).',
  'Identifica de quem é a ficha de custo que será criada.',
  'João da Silva.',
  'Se o nome estiver errado, corrija no cadastro da pessoa, não aqui.', 'publicado', 1),
 ('projetos.mao_obra.ponto.col_matricula', '/dashboard/industrial/rh/pessoas', 'Pessoas e custo', 'industrial', 'Matrícula',
  'Matrícula da pessoa; é por ela que o sistema casa a folha de pagamento.',
  'Liga a pessoa à remuneração da folha (a folha importada não traz CPF).',
  '001234.',
  'Sem matrícula, a remuneração da folha pode não aparecer para a pessoa.', 'publicado', 1),
 ('projetos.mao_obra.ponto.col_funcao_ponto', '/dashboard/industrial/rh/pessoas', 'Pessoas e custo', 'industrial', 'Função no ponto',
  'A função exatamente como está escrita no ponto eletrônico.',
  'Serve de base para sugerir a função do catálogo.',
  'OPERADOR DE PRODUCAO.',
  'Se a escrita no ponto variar, a função sugerida pode não casar; use "Trazer funções do ponto".', 'publicado', 1),
 ('projetos.mao_obra.ponto.col_funcao_sugerida', '/dashboard/industrial/rh/pessoas', 'Pessoas e custo', 'industrial', 'Função sugerida',
  'A função do catálogo que casou com a função do ponto (pelo nome).',
  'Já entra preenchida na ficha; você pode trocar na hora de criar.',
  'Função do ponto "OPERADOR" casa com a função "Operador".',
  'Se aparecer "a escolher", traga as funções do ponto ou escolha a função ao criar a ficha.', 'publicado', 1),
 ('projetos.mao_obra.ponto.col_setor', '/dashboard/industrial/rh/pessoas', 'Pessoas e custo', 'industrial', 'Setor',
  'Setor da pessoa (departamento do ponto).',
  'Ajuda a filtrar e a cadastrar o custo por setor.',
  'Desossa.',
  'Pessoa sem departamento no ponto fica sem setor.', 'publicado', 1),
 ('projetos.mao_obra.ponto.col_admissao', '/dashboard/industrial/rh/pessoas', 'Pessoas e custo', 'industrial', 'Admissão',
  'Data de admissão da pessoa (do ponto ou do cadastro).',
  'Entra na ficha; serve de referência para tempo de casa e rescisão.',
  '12/03/2024.',
  'Se faltar, confira a admissão no cadastro da pessoa.', 'publicado', 1),
 ('projetos.mao_obra.ponto.col_jornada', '/dashboard/industrial/rh/pessoas', 'Pessoas e custo', 'industrial', 'Jornada (h/mês)',
  'Horas por mês da escala da pessoa, lidas do ponto.',
  'É a base de horas produtivas da ficha (custo da hora = custo mensal ÷ horas).',
  '220 h/mês.',
  'Sem escala cadastrada, a ficha usa 176 h/mês como padrão — ajuste se precisar.', 'publicado', 1),
 ('projetos.mao_obra.ponto.col_remuneracao', '/dashboard/industrial/rh/pessoas', 'Pessoas e custo', 'industrial', 'Remuneração (folha)',
  'Remuneração da última folha importada desta pessoa (bruto do mês).',
  'Entra como o fixo mensal sugerido da ficha — confira antes de conferir a ficha.',
  'R$ 2.444,27 na folha de 10/2026.',
  'É sugestão: o valor final do custo é o que você confirmar na ficha.', 'publicado', 1),
 ('projetos.mao_obra.ponto.col_verbas', '/dashboard/industrial/rh/pessoas', 'Pessoas e custo', 'industrial', 'Verbas sugeridas',
  'Adicionais da folha (insalubridade, periculosidade, hora extra, noturno) que entram sugeridos na ficha.',
  'Pré-preenche os adicionais da remuneração, para o custo ficar mais perto do real.',
  'Insalubridade R$ 182,00 · Hora extra R$ 120,00.',
  'O DSR/repouso aparece só como referência: o cálculo da ficha já gera o reflexo, não é um componente à parte.', 'publicado', 1)
ON CONFLICT (chave) DO UPDATE SET rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, vertical = EXCLUDED.vertical,
  rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, status = 'publicado', versao = erp_ajuda_campo.versao + 1, atualizado_em = now();
