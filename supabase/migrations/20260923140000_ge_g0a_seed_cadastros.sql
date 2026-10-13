-- GE · Onda G0a · Demonstração Comércio GE — CADASTROS (Bloco 1 do seed único, RD-69).
-- Cria fn_gold_ge_seed_reparar(company) para a empresa Demonstração Comércio GE
-- (b0700000-…004, is_demo) e encadeia no fn_demo_reset. Só a empresa demo, dados 100%
-- fictícios, idempotente/auto-resetável por chave natural, SECURITY DEFINER + REVOKE anon.
--
-- Bloco 1 (este PR): plano de contas (template global) + centros de custo + 2 divisões +
-- 20 clientes (PF/PJ, CPF/CNPJ com DV válido, com e sem endereço) + 12 fornecedores +
-- 40 produtos (NCM, custo médio, estoque — 3 negativos e 5 zerados) + 6 serviços (LC 116).
-- Blocos 2..6 (comercial, financeiro, bancos, fiscal, DRE) vêm em PRs próprios, encadeados
-- no mesmo braço 004 do fn_demo_reset (padrão garantia/leads da Revenda).
--
-- Nota de caminho: os cadastros são inseridos direto DENTRO do seed SECURITY DEFINER (mesmo
-- padrão do fn_gold_revenda_seed_reparar, que insere veic_veiculo direto). As RPCs de cadastro
-- (fn_erp_produto_salvar, fn_plano_contas_aplicar_template_global) guardam por get_user_company_ids()
-- SEM escape de service_role, então bloqueariam o seed rodando via service_role/cron — por isso
-- replicamos a lógica delas (validação SPED, cópia do template global) no insert direto.
-- Títulos financeiros e notas fiscais NÃO entram aqui — virão pelos caminhos oficiais (RPCs) nos
-- blocos 3 e 5, "nunca título na mão".

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers de documento fictício com dígito verificador VÁLIDO (reutilizáveis por qualquer demo).
-- Determinísticos e imutáveis: dado o mesmo p_base, sempre o mesmo CPF/CNPJ válido.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_demo_cpf_valido(p_base bigint)
 RETURNS text LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE v text := lpad((abs(p_base) % 1000000000)::text, 9, '0');
        s int := 0; d1 int; d2 int; i int;
BEGIN
  FOR i IN 0..8 LOOP s := s + substr(v, i+1, 1)::int * (10 - i); END LOOP;
  d1 := 11 - (s % 11); IF d1 >= 10 THEN d1 := 0; END IF;
  v := v || d1::text;
  s := 0;
  FOR i IN 0..9 LOOP s := s + substr(v, i+1, 1)::int * (11 - i); END LOOP;
  d2 := 11 - (s % 11); IF d2 >= 10 THEN d2 := 0; END IF;
  RETURN v || d2::text;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_demo_cnpj_valido(p_base bigint)
 RETURNS text LANGUAGE plpgsql IMMUTABLE AS $function$
DECLARE v text := lpad((abs(p_base) % 1000000000000)::text, 12, '0');
        w1 int[] := ARRAY[5,4,3,2,9,8,7,6,5,4,3,2];
        w2 int[] := ARRAY[6,5,4,3,2,9,8,7,6,5,4,3,2];
        s int := 0; d1 int; d2 int; i int;
BEGIN
  FOR i IN 1..12 LOOP s := s + substr(v, i, 1)::int * w1[i]; END LOOP;
  d1 := 11 - (s % 11); IF d1 >= 10 THEN d1 := 0; END IF;
  v := v || d1::text;
  s := 0;
  FOR i IN 1..13 LOOP s := s + substr(v, i, 1)::int * w2[i]; END LOOP;
  d2 := 11 - (s % 11); IF d2 >= 10 THEN d2 := 0; END IF;
  RETURN v || d2::text;
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed único da Demonstração Comércio GE — Bloco 1 (Cadastros)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_gold_ge_seed_reparar(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_bot uuid := 'b0700000-0000-4000-a000-000000000004';
  v_criou int := 0;
  v_i int; v_doc text; v_nome text; v_razao text; v_com_end boolean;
  v_saldo numeric; v_custo numeric; v_ncm text; v_cat text;
  v_cats text[] := ARRAY['Perfil de alumínio','Ferragem','Vidro','Acessório','Componente elétrico','Embalagem'];
  v_ncms text[] := ARRAY['76042990','83024100','70052900','83024900','85366990','48191000'];
  v_rec_cat text;
  v_serv record;
BEGIN
  -- guarda dura: só a empresa demo GE (fn_demo_reset já validou is_demo a montante)
  IF p_company_id <> v_bot THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_empresa_demo_ge');
  END IF;

  -- 1) PLANO DE CONTAS — copia o template global (company_id IS NULL) que ainda falta na empresa
  INSERT INTO erp_plano_contas
    (company_id, codigo, descricao, grupo, tipo, pai_codigo, nivel, ativo, is_totalizador, sugerida_global)
  SELECT v_bot, g.codigo, g.descricao, g.grupo, g.tipo, g.pai_codigo, g.nivel, true, g.is_totalizador, false
  FROM erp_plano_contas g
  WHERE g.company_id IS NULL AND g.ativo
    AND NOT EXISTS (SELECT 1 FROM erp_plano_contas e WHERE e.company_id = v_bot AND e.codigo = g.codigo);
  GET DIAGNOSTICS v_i = ROW_COUNT; v_criou := v_criou + v_i;

  -- 2) CENTROS DE CUSTO padrão (idempotente por nome)
  FOREACH v_nome IN ARRAY ARRAY['Administrativo','Comercial','Financeiro','Logística'] LOOP
    IF NOT EXISTS (SELECT 1 FROM erp_centros_custo WHERE company_id=v_bot AND nome=v_nome) THEN
      INSERT INTO erp_centros_custo (company_id, nome, ativo) VALUES (v_bot, v_nome, true);
      v_criou := v_criou + 1;
    END IF;
  END LOOP;

  -- 3) DIVISÕES (DRE divisional) — 2 divisões atadas a contas de receita do plano, se houver
  SELECT codigo INTO v_rec_cat FROM erp_plano_contas
   WHERE (company_id=v_bot) AND tipo='receita' ORDER BY codigo LIMIT 1;
  IF v_rec_cat IS NOT NULL THEN
    INSERT INTO erp_dre_divisoes (company_id, divisao, categoria_codigo, tipo, status)
    VALUES (v_bot, 'Matriz', v_rec_cat, 'receita', 'validado')
    ON CONFLICT (company_id, categoria_codigo, tipo) DO NOTHING;
    SELECT codigo INTO v_cat FROM erp_plano_contas
     WHERE (company_id=v_bot) AND tipo='receita' AND codigo <> v_rec_cat ORDER BY codigo LIMIT 1;
    IF v_cat IS NOT NULL THEN
      INSERT INTO erp_dre_divisoes (company_id, divisao, categoria_codigo, tipo, status)
      VALUES (v_bot, 'Filial', v_cat, 'receita', 'validado')
      ON CONFLICT (company_id, categoria_codigo, tipo) DO NOTHING;
    END IF;
  END IF;

  -- 4) CLIENTES — 20 (i<=10 PJ com CNPJ; i>10 PF com CPF; endereço nos pares), idempotente por documento
  FOR v_i IN 1..20 LOOP
    IF v_i <= 10 THEN
      v_doc   := fn_demo_cnpj_valido(100000000000 + v_i);
      v_nome  := 'Comércio Demo ' || v_i || ' LTDA';
      v_razao := 'Comércio Demonstração ' || v_i || ' LTDA';
    ELSE
      v_doc   := fn_demo_cpf_valido(100000000 + v_i);
      v_nome  := 'Cliente Demo PF ' || v_i;
      v_razao := NULL;
    END IF;
    v_com_end := (v_i % 2 = 0);
    IF NOT EXISTS (SELECT 1 FROM erp_clientes WHERE company_id=v_bot AND cnpj_cpf=v_doc) THEN
      INSERT INTO erp_clientes
        (company_id, nome_fantasia, razao_social, tipo_pessoa, cnpj_cpf, cpf_cnpj,
         contribuinte_icms, email, telefone,
         cep, logradouro, numero, bairro, cidade, uf, ativo)
      VALUES
        (v_bot, v_nome, v_razao, CASE WHEN v_i<=10 THEN 'PJ' ELSE 'PF' END, v_doc, v_doc,
         CASE WHEN v_i<=10 THEN 'contribuinte' ELSE 'nao_contribuinte' END,
         'cliente' || v_i || '@demo.local', '(47) 3000-' || lpad(v_i::text,4,'0'),
         CASE WHEN v_com_end THEN '89000-' || lpad(v_i::text,3,'0') END,
         CASE WHEN v_com_end THEN 'Rua Demonstração' END,
         CASE WHEN v_com_end THEN v_i::text END,
         CASE WHEN v_com_end THEN 'Centro' END,
         CASE WHEN v_com_end THEN 'Blumenau' END,
         CASE WHEN v_com_end THEN 'SC' END,
         true);
      v_criou := v_criou + 1;
    END IF;
  END LOOP;

  -- 5) FORNECEDORES — 12 (PJ com CNPJ), idempotente por documento
  FOR v_i IN 1..12 LOOP
    v_doc := fn_demo_cnpj_valido(200000000000 + v_i);
    IF NOT EXISTS (SELECT 1 FROM erp_fornecedores WHERE company_id=v_bot AND cnpj_cpf=v_doc) THEN
      INSERT INTO erp_fornecedores
        (company_id, nome_fantasia, razao_social, tipo_pessoa, cnpj_cpf, contribuinte_icms,
         email, telefone, cidade, uf, ativo, fornecedor_principal)
      VALUES
        (v_bot, 'Fornecedor Demo ' || v_i, 'Fornecedor Demonstração ' || v_i || ' LTDA',
         'PJ', v_doc, 'contribuinte',
         'fornecedor' || v_i || '@demo.local', '(11) 4000-' || lpad(v_i::text,4,'0'),
         'São Paulo', 'SP', true, (v_i = 1));
      v_criou := v_criou + 1;
    END IF;
  END LOOP;

  -- 6) PRODUTOS — 40 (SPED 0200: codigo/nome/unidade/tipo_item_sped/ncm). ON CONFLICT (company_id,codigo).
  --    estoque: i<=3 negativo, 4..8 zero, demais positivo. Preço custo médio e venda preenchidos.
  FOR v_i IN 1..40 LOOP
    v_cat   := v_cats[((v_i - 1) % array_length(v_cats,1)) + 1];
    v_ncm   := v_ncms[((v_i - 1) % array_length(v_ncms,1)) + 1];
    v_custo := round((25 + (v_i * 7.3))::numeric, 2);
    v_saldo := CASE
                 WHEN v_i <= 3 THEN -(v_i * 2)::numeric        -- 3 negativos
                 WHEN v_i <= 8 THEN 0                          -- 5 zerados
                 ELSE (10 + v_i)::numeric                      -- positivos
               END;
    INSERT INTO erp_produtos
      (company_id, codigo, nome, descricao, tipo, categoria, unidade, tipo_item_sped, ncm, origem,
       preco_custo, preco_custo_medio, preco_venda, estoque_atual, estoque_minimo, ativo)
    VALUES
      (v_bot, 'GE-P' || lpad(v_i::text,3,'0'), v_cat || ' ' || v_i,
       'Produto de demonstração ' || v_i, 'produto', v_cat, 'UN', '00', v_ncm, '0',
       v_custo, v_custo, round(v_custo * 1.6, 2), v_saldo, 2, true)
    ON CONFLICT (company_id, codigo) DO UPDATE SET
      nome=EXCLUDED.nome, categoria=EXCLUDED.categoria, ncm=EXCLUDED.ncm,
      tipo_item_sped=EXCLUDED.tipo_item_sped, unidade=EXCLUDED.unidade,
      preco_custo=EXCLUDED.preco_custo, preco_custo_medio=EXCLUDED.preco_custo_medio,
      preco_venda=EXCLUDED.preco_venda, estoque_atual=EXCLUDED.estoque_atual, updated_at=now();
    v_criou := v_criou + 1;
  END LOOP;

  -- 7) SERVIÇOS — 6 com LC 116 (idempotente por descrição)
  FOR v_serv IN
    SELECT * FROM (VALUES
      ('Instalação de esquadrias',      '07.02', 5.0),
      ('Manutenção predial',            '07.10', 5.0),
      ('Projeto e consultoria técnica', '07.03', 3.0),
      ('Assistência técnica',           '14.01', 5.0),
      ('Montagem industrial',           '07.02', 5.0),
      ('Transporte e logística',        '16.01', 5.0)
    ) AS s(descr, lc, aliq)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM erp_servicos WHERE company_id=v_bot AND descricao_resumida=v_serv.descr) THEN
      INSERT INTO erp_servicos
        (company_id, descricao_resumida, codigo_lc116, aliquota_iss, iss_no_local_prestacao, valor_unitario, ativo)
      VALUES (v_bot, v_serv.descr, v_serv.lc, v_serv.aliq, false, round((150 + random()*350)::numeric,2), true);
      v_criou := v_criou + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'bloco', 'cadastros', 'criou', v_criou,
    'clientes',     (SELECT count(*) FROM erp_clientes     WHERE company_id=v_bot),
    'fornecedores', (SELECT count(*) FROM erp_fornecedores WHERE company_id=v_bot),
    'produtos',     (SELECT count(*) FROM erp_produtos     WHERE company_id=v_bot),
    'produtos_negativos', (SELECT count(*) FROM erp_produtos WHERE company_id=v_bot AND estoque_atual < 0),
    'produtos_zerados',   (SELECT count(*) FROM erp_produtos WHERE company_id=v_bot AND estoque_atual = 0),
    'servicos',     (SELECT count(*) FROM erp_servicos     WHERE company_id=v_bot),
    'plano_contas', (SELECT count(*) FROM erp_plano_contas WHERE company_id=v_bot),
    'centros_custo',(SELECT count(*) FROM erp_centros_custo WHERE company_id=v_bot),
    'divisoes',     (SELECT count(*) FROM erp_dre_divisoes WHERE company_id=v_bot)
  );
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- fn_demo_reset: adiciona o braço 004 → fn_gold_ge_seed_reparar (blocos 2..6 encadeiam depois)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_demo_reset(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_is_demo boolean; v_nome text; v_seed text; v_res jsonb; v_gar jsonb; v_leads jsonb;
BEGIN
  IF p_company_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'company_id_nulo'); END IF;
  SELECT c.is_demo, coalesce(c.nome_fantasia, c.razao_social, c.id::text) INTO v_is_demo, v_nome
    FROM public.companies c WHERE c.id = p_company_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'empresa_inexistente'); END IF;
  IF v_is_demo IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_demo', 'empresa', v_nome); END IF;

  v_seed := CASE p_company_id
    WHEN 'b0700000-0000-4000-a000-000000000001'::uuid THEN 'fn_gold_oficina_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000002'::uuid THEN 'fn_gold_pm_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000003'::uuid THEN 'fn_gold_revenda_seed_reparar'
    WHEN 'b0700000-0000-4000-a000-000000000004'::uuid THEN 'fn_gold_ge_seed_reparar'
    ELSE NULL END;
  IF v_seed IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_seed_para_esta_demo', 'empresa', v_nome); END IF;

  EXECUTE format('SELECT %I($1)', v_seed) INTO v_res USING p_company_id;

  -- Revenda: garantia (A) + leads do CRM (T15). Junta as contagens ao resultado (prova).
  IF p_company_id = 'b0700000-0000-4000-a000-000000000003'::uuid THEN
    v_gar := fn_demo_seed_revenda_garantia(p_company_id);
    v_leads := fn_demo_seed_revenda_leads(p_company_id);
    v_res := COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('garantia', v_gar, 'leads', v_leads);
  END IF;

  RETURN jsonb_build_object('ok', true, 'empresa', v_nome, 'seed', v_seed, 'resultado', v_res);
END $function$;

REVOKE ALL ON FUNCTION public.fn_demo_cpf_valido(bigint)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_demo_cnpj_valido(bigint)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_gold_ge_seed_reparar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_demo_reset(uuid)           FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_demo_cpf_valido(bigint)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_demo_cnpj_valido(bigint)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_gold_ge_seed_reparar(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_demo_reset(uuid)           TO authenticated, service_role;
