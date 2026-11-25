-- GE · financeiro · "Classificar pendências em lote" (GO-LIVE agência piloto, CEO 25/11, item 2).
-- Problema real (auditoria do Eng. Chefe 25/11): a agência piloto tem dezenas de despesas (erp_pagar) SEM conta
-- do plano gerencial, então o DRE não as enxerga; e contas do plano sem grupo DRE. Esta tela deixa classificar
-- as despesas pendentes EM LOTE, com sugestão pelo histórico (fornecedor/descrição) e trilha de auditoria, e
-- apontar o grupo DRE das contas que ainda não têm.
--
-- Modelo de dados (confirmado no banco):
--   * despesa classificada = erp_pagar.categoria (text) == erp_plano_contas.codigo (da mesma empresa).
--   * "despesa pendente" = erp_pagar (deleted_at IS NULL) com categoria NULL/vazia OU que não casa com nenhuma
--     conta do plano da empresa.
--   * conta → DRE = erp_plano_contas.grupo (CMV, DEDUCOES, DESP_FIXA, ...). "conta sem DRE" = grupo vazio.
--
-- 100% ADITIVA: só cria funções (sem ALTER/DROP de tabela, sem tocar RLS existente). O ÚNICO write de dado de
-- cliente é o UPDATE de erp_pagar.categoria disparado pelo usuário logado na tela (nunca na migration), guardado
-- por empresa, idempotente e só em linha AINDA pendente — nunca sobrescreve classificação já válida nem mexe em
-- status/baixa/pagamento. Cada classificação grava audit_log_global (valor_anterior/valor_novo).
-- Incident 03/10: sugestão é SET-BASED (LATERAL com LIMIT), teto de linhas, nunca varre tabela grande.

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 1) LEITOR: despesas pendentes de classificação + sugestão de conta pelo histórico da própria empresa.
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pagar_pendencias_classificar(
  p_company_id uuid,
  p_termo      text DEFAULT NULL,
  p_limite     integer DEFAULT 200
)
RETURNS TABLE (
  id                 uuid,
  fornecedor_nome    text,
  descricao          text,
  valor              numeric,
  data_vencimento    date,
  status             text,
  categoria_atual    text,
  sugerido_codigo    text,
  sugerido_descricao text,
  sugerido_grupo     text,
  sugestao_origem    text,
  sugestao_confianca numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limite integer := LEAST(GREATEST(COALESCE(p_limite, 200), 1), 500);
  v_termo  text    := NULLIF(btrim(p_termo), '');
BEGIN
  -- Guarda multi-tenant: só lê empresa no escopo do usuário (ou admin).
  IF p_company_id IS NULL
     OR NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH pend AS (
    SELECT p.id, p.fornecedor_id, p.fornecedor_nome, p.descricao, p.valor,
           p.data_vencimento, p.status, p.categoria
    FROM public.erp_pagar p
    WHERE p.company_id = p_company_id
      AND p.deleted_at IS NULL
      AND (
        p.categoria IS NULL OR btrim(p.categoria) = ''
        OR NOT EXISTS (
          SELECT 1 FROM public.erp_plano_contas pc
          WHERE pc.company_id = p_company_id AND pc.codigo = p.categoria
        )
      )
      AND (
        v_termo IS NULL
        OR p.fornecedor_nome ILIKE '%' || v_termo || '%'
        OR p.descricao ILIKE '%' || v_termo || '%'
      )
    ORDER BY p.data_vencimento DESC NULLS LAST, p.valor DESC NULLS LAST
    LIMIT v_limite
  )
  SELECT
    pend.id,
    pend.fornecedor_nome::text,
    pend.descricao::text,
    pend.valor,
    pend.data_vencimento,
    pend.status::text,
    pend.categoria::text,
    sug.codigo::text,
    pc.descricao::text,
    pc.grupo::text,
    sug.origem::text,
    sug.confianca
  FROM pend
  -- Sugestão por FORNECEDOR: conta mais usada nas despesas já classificadas do mesmo fornecedor.
  LEFT JOIN LATERAL (
    SELECT h.categoria AS codigo
    FROM public.erp_pagar h
    JOIN public.erp_plano_contas pcf
      ON pcf.company_id = p_company_id AND pcf.codigo = h.categoria
    WHERE h.company_id = p_company_id
      AND h.deleted_at IS NULL
      AND h.fornecedor_id IS NOT NULL
      AND h.fornecedor_id = pend.fornecedor_id
      AND h.categoria IS NOT NULL AND btrim(h.categoria) <> ''
    GROUP BY h.categoria
    ORDER BY count(*) DESC
    LIMIT 1
  ) forn ON pend.fornecedor_id IS NOT NULL
  -- Sugestão por DESCRIÇÃO (trigram), só quando o fornecedor não resolveu.
  LEFT JOIN LATERAL (
    SELECT h.categoria AS codigo,
           similarity(public.fn_normalizar_texto_alerta(h.descricao),
                      public.fn_normalizar_texto_alerta(pend.descricao)) AS s
    FROM public.erp_pagar h
    JOIN public.erp_plano_contas pcd
      ON pcd.company_id = p_company_id AND pcd.codigo = h.categoria
    WHERE h.company_id = p_company_id
      AND h.deleted_at IS NULL
      AND h.id <> pend.id
      AND h.categoria IS NOT NULL AND btrim(h.categoria) <> ''
      AND h.descricao IS NOT NULL
      AND public.fn_normalizar_texto_alerta(h.descricao)
          % public.fn_normalizar_texto_alerta(pend.descricao)
    ORDER BY s DESC
    LIMIT 1
  ) descr ON (forn.codigo IS NULL AND pend.descricao IS NOT NULL)
  -- Escolha final: fornecedor (0.90) vence; senão descrição se >= 0.30.
  LEFT JOIN LATERAL (
    SELECT
      CASE WHEN forn.codigo IS NOT NULL THEN forn.codigo
           WHEN descr.codigo IS NOT NULL AND descr.s >= 0.30 THEN descr.codigo
      END AS codigo,
      CASE WHEN forn.codigo IS NOT NULL THEN 'fornecedor'
           WHEN descr.codigo IS NOT NULL AND descr.s >= 0.30 THEN 'descricao'
      END AS origem,
      CASE WHEN forn.codigo IS NOT NULL THEN 0.90::numeric
           WHEN descr.codigo IS NOT NULL AND descr.s >= 0.30 THEN round(descr.s::numeric, 2)
      END AS confianca
  ) sug ON true
  LEFT JOIN public.erp_plano_contas pc
    ON pc.company_id = p_company_id AND pc.codigo = sug.codigo
  ORDER BY pend.data_vencimento DESC NULLS LAST, pend.valor DESC NULLS LAST;
END $function$;

REVOKE ALL ON FUNCTION public.fn_pagar_pendencias_classificar(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pagar_pendencias_classificar(uuid, text, integer) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 2) ESCRITOR: classifica despesas EM LOTE. p_itens = jsonb array de { "id": <uuid despesa>, "codigo": <conta> }.
--    Só classifica linha pendente (nunca sobrescreve classificação já válida), da própria empresa, não deletada,
--    com conta existente no plano da empresa. Grava audit_log_global por linha.
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pagar_classificar_em_lote(
  p_company_id uuid,
  p_itens      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_email     text;
  v_item      jsonb;
  v_id        uuid;
  v_codigo    text;
  v_antes     text;
  v_aplicados integer := 0;
  v_ignorados integer := 0;
  v_erros     jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado');
  END IF;
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'empresa_obrigatoria');
  END IF;
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso',
                              'mensagem', 'Você não tem acesso a esta empresa.');
  END IF;
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_itens',
                              'mensagem', 'Selecione ao menos uma despesa e uma conta.');
  END IF;

  SELECT email INTO v_email FROM public.users WHERE id = v_uid;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens)
  LOOP
    v_id     := NULLIF(v_item->>'id', '')::uuid;
    v_codigo := NULLIF(btrim(v_item->>'codigo'), '');

    IF v_id IS NULL OR v_codigo IS NULL THEN
      v_ignorados := v_ignorados + 1;
      CONTINUE;
    END IF;

    -- A conta tem de existir no plano da empresa.
    IF NOT EXISTS (
      SELECT 1 FROM public.erp_plano_contas pc
      WHERE pc.company_id = p_company_id AND pc.codigo = v_codigo
    ) THEN
      v_erros := v_erros || jsonb_build_object('id', v_id, 'erro', 'conta_inexistente', 'codigo', v_codigo);
      CONTINUE;
    END IF;

    -- Só classifica despesa da empresa, não deletada e AINDA pendente (categoria nula/vazia ou não casa).
    SELECT p.categoria INTO v_antes
    FROM public.erp_pagar p
    WHERE p.id = v_id
      AND p.company_id = p_company_id
      AND p.deleted_at IS NULL
      AND (
        p.categoria IS NULL OR btrim(p.categoria) = ''
        OR NOT EXISTS (SELECT 1 FROM public.erp_plano_contas pc2
                       WHERE pc2.company_id = p_company_id AND pc2.codigo = p.categoria)
      )
    FOR UPDATE;

    IF NOT FOUND THEN
      -- já classificada, de outra empresa, inexistente ou deletada → ignora (não sobrescreve nada).
      v_ignorados := v_ignorados + 1;
      CONTINUE;
    END IF;

    UPDATE public.erp_pagar
       SET categoria = v_codigo
     WHERE id = v_id AND company_id = p_company_id;

    INSERT INTO public.audit_log_global
      (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES
      (p_company_id, v_uid, COALESCE(v_email, ''), 'erp_pagar', v_id::text, 'pagar_classificar',
       jsonb_build_object('categoria', v_antes),
       jsonb_build_object('categoria', v_codigo));

    v_aplicados := v_aplicados + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'aplicados', v_aplicados,
    'ignorados', v_ignorados,
    'erros', v_erros
  );
END $function$;

REVOKE ALL ON FUNCTION public.fn_pagar_classificar_em_lote(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pagar_classificar_em_lote(uuid, jsonb) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 3) LEITOR: contas do plano SEM grupo DRE (para apontar o grupo e o DRE passar a enxergá-las).
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_plano_contas_sem_dre(
  p_company_id uuid
)
RETURNS TABLE (
  id         uuid,
  codigo     text,
  descricao  text,
  tipo       text,
  nivel      integer,
  pai_codigo text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_company_id IS NULL
     OR NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT pc.id, pc.codigo::text, pc.descricao::text, pc.tipo::text, pc.nivel, pc.pai_codigo::text
  FROM public.erp_plano_contas pc
  WHERE pc.company_id = p_company_id
    AND pc.ativo
    AND COALESCE(pc.is_totalizador, false) = false
    AND (pc.grupo IS NULL OR btrim(pc.grupo) = '')
  ORDER BY pc.codigo;
END $function$;

REVOKE ALL ON FUNCTION public.fn_plano_contas_sem_dre(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_contas_sem_dre(uuid) TO authenticated, service_role;

-- 3b) ESCRITOR focado: aponta SÓ o grupo DRE de uma conta (não reescreve a linha; preserva código/pai/descrição).
--     Guardado por empresa, nunca toca conta global (company_id NULL), valida o grupo e grava trilha.
CREATE OR REPLACE FUNCTION public.fn_plano_contas_definir_grupo(
  p_company_id uuid,
  p_id         uuid,
  p_grupo      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_grupo  text := NULLIF(btrim(p_grupo), '');
  v_row    public.erp_plano_contas%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado');
  END IF;
  IF p_company_id IS NULL OR p_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'parametros_obrigatorios');
  END IF;
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso',
                              'mensagem', 'Você não tem acesso a esta empresa.');
  END IF;
  IF v_grupo IS NULL
     OR v_grupo NOT IN ('CMV','DEDUCOES','IMPOSTOS_VENDA','DESP_FIXA','DESP_VARIAVEL',
                        'DEPREC_AMORT','IR_CSLL','NAO_OPER','DESTINACAO') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'grupo_invalido',
                              'mensagem', 'Selecione um grupo DRE válido.');
  END IF;

  SELECT * INTO v_row FROM public.erp_plano_contas WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_encontrado', 'mensagem', 'Conta não encontrada.');
  END IF;
  IF v_row.company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'conta_global_nao_editavel',
                              'mensagem', 'Contas do modelo padrão não podem ser editadas.');
  END IF;
  IF v_row.company_id <> p_company_id THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'empresa_divergente',
                              'mensagem', 'A conta pertence a outra empresa.');
  END IF;

  UPDATE public.erp_plano_contas SET grupo = v_grupo WHERE id = p_id;

  INSERT INTO public.audit_log_global
    (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES
    (p_company_id, v_uid, COALESCE((SELECT email FROM public.users WHERE id = v_uid), ''),
     'erp_plano_contas', p_id::text, 'plano_conta_definir_grupo',
     jsonb_build_object('grupo', v_row.grupo), jsonb_build_object('grupo', v_grupo));

  RETURN jsonb_build_object('ok', true, 'id', p_id, 'grupo', v_grupo);
END $function$;

REVOKE ALL ON FUNCTION public.fn_plano_contas_definir_grupo(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_contas_definir_grupo(uuid, uuid, text) TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 4) Registro da tela em system_screens (entrega só conta se o usuário enxerga a tela).
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.system_screens (rota, area, titulo, descricao_funcional, modulo, estado_real, rpcs_chamadas)
VALUES (
  '/dashboard/gestao-empresarial/classificar-pendencias',
  'gestao_empresarial',
  'Classificar pendências',
  'Classifica em lote as despesas sem conta do plano gerencial (com sugestão pelo histórico de fornecedor/descrição e trilha) e aponta o grupo DRE das contas que ainda não têm, para o DRE passar a enxergar tudo.',
  'gestao_empresarial',
  'pronto',
  ARRAY['fn_pagar_pendencias_classificar','fn_pagar_classificar_em_lote','fn_plano_contas_sem_dre','fn_plano_contas_definir_grupo','fn_plano_contas_buscar','fn_ajuda_campo_listar']
)
ON CONFLICT (rota) DO UPDATE
  SET titulo = EXCLUDED.titulo,
      descricao_funcional = EXCLUDED.descricao_funcional,
      rpcs_chamadas = EXCLUDED.rpcs_chamadas,
      atualizado_em = now();

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 5) RD-95: "?" de todo campo/filtro/coluna/ação da tela (erp_ajuda_campo).
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo
  (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('ge.classificar.busca','Classificar pendências · Filtro','Buscar',
 'Digite parte do nome do fornecedor ou da descrição da despesa para filtrar a lista.',
 'Ajuda a achar rapidamente um grupo de despesas parecidas para classificar junto.',
 'Energia, Aluguel, nome do fornecedor.',
 'Buscar por valor: o filtro é por texto (fornecedor/descrição), não por número.',
 1,'/dashboard/gestao-empresarial/classificar-pendencias','gestao_empresarial','publicado'),
('ge.classificar.fornecedor','Classificar pendências · Coluna','Fornecedor',
 'Coluna de leitura: mostra o fornecedor da despesa.','Identifica a origem da despesa para escolher a conta certa.',
 'CEMIG, Imobiliária Central.','—',
 2,'/dashboard/gestao-empresarial/classificar-pendencias','gestao_empresarial','publicado'),
('ge.classificar.descricao','Classificar pendências · Coluna','Descrição',
 'Coluna de leitura: o histórico/descrição lançado na despesa.','Dá o contexto do gasto para a classificação.',
 'Conta de luz 11/2026.','—',
 3,'/dashboard/gestao-empresarial/classificar-pendencias','gestao_empresarial','publicado'),
('ge.classificar.valor','Classificar pendências · Coluna','Valor',
 'Coluna de leitura: o valor da despesa.','Dimensiona o impacto no DRE.','R$ 1.250,00.','—',
 4,'/dashboard/gestao-empresarial/classificar-pendencias','gestao_empresarial','publicado'),
('ge.classificar.sugestao','Classificar pendências · Coluna','Conta sugerida',
 'A conta que o sistema propõe com base no histórico (mesmo fornecedor ou descrição parecida já classificada). Você pode trocar.',
 'Acelera a classificação: na maioria dos casos é só confirmar a sugestão.',
 'Sugere "3.02 Energia elétrica" porque despesas anteriores desse fornecedor foram para essa conta.',
 'Aceitar a sugestão sem conferir quando a confiança é baixa.',
 5,'/dashboard/gestao-empresarial/classificar-pendencias','gestao_empresarial','publicado'),
('ge.classificar.confianca','Classificar pendências · Coluna','Confiança',
 'Leitura: o quão forte é a sugestão. Alta = mesmo fornecedor já classificado; média = descrição parecida.',
 'Mostra em quais linhas vale conferir antes de aplicar.',
 '90% (por fornecedor) · 62% (por descrição).',
 'Tratar confiança média como certeza.',
 6,'/dashboard/gestao-empresarial/classificar-pendencias','gestao_empresarial','publicado'),
('ge.classificar.conta','Classificar pendências · Ação','Conta do plano',
 'Escolha a conta do plano gerencial em que a despesa entra. Comece a digitar para buscar.',
 'É o que faz a despesa aparecer no grupo certo do DRE.',
 '4.01 Despesas administrativas.',
 'Deixar sem conta: a despesa fica fora do DRE.',
 7,'/dashboard/gestao-empresarial/classificar-pendencias','gestao_empresarial','publicado'),
('ge.classificar.aplicar_sugestoes','Classificar pendências · Ação','Aplicar sugestões',
 'Classifica de uma vez todas as despesas que têm sugestão de alta confiança (por fornecedor).',
 'Resolve o grosso da pendência em um clique; o resto você ajusta à mão.',
 'Aplica as sugestões por fornecedor e deixa só as de descrição para conferir.',
 'Aplicar sem revisar linhas de confiança baixa.',
 8,'/dashboard/gestao-empresarial/classificar-pendencias','gestao_empresarial','publicado'),
('ge.classificar.aplicar_selecionados','Classificar pendências · Ação','Aplicar selecionados',
 'Classifica as despesas marcadas, cada uma na conta escolhida na linha.',
 'Dá controle: você revê e aplica só o que conferiu.',
 'Marcou 20 linhas com conta definida e aplicou todas juntas.',
 'Marcar uma linha sem ter escolhido a conta: ela é ignorada.',
 9,'/dashboard/gestao-empresarial/classificar-pendencias','gestao_empresarial','publicado'),
('ge.classificar.contas_sem_dre','Classificar pendências · Contas sem DRE','Grupo DRE da conta',
 'Escolha o grupo do DRE em que esta conta entra (ex.: Custo, Despesa fixa, Impostos).',
 'Sem grupo, a conta — e as despesas nela — não aparecem no DRE.',
 'Conta "Energia" → grupo "Despesa variável".',
 'Deixar a conta sem grupo: o DRE continua cego para ela.',
 10,'/dashboard/gestao-empresarial/classificar-pendencias','gestao_empresarial','publicado')
ON CONFLICT (chave) DO NOTHING;
