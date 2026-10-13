-- Revenda R0.3 · Vistoria RÁPIDA (9 itens) — chamado #31 (Alliance)
--
-- Modo de vistoria por empresa (escolha visível na Config da garagem). Regras (decisão do Eng. Chefe):
--  • A rápida (9 itens) vira o PADRÃO para demo, empresas NOVAS e a Alliance (que pediu no #31).
--    As demais revendas reais mantêm a completa (abertura não muda por baixo).
--  • Vistorias EM ANDAMENTO não mudam: seguem no modelo em que começaram (nada aqui toca insp_vistoria).
--    Só vistorias NOVAS abrem no modo padrão da empresa.
--  • Foto obrigatória só no que for reparo/troca (validado na conclusão).

-- ── (1) modo no modelo ────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.insp_modelo ADD COLUMN IF NOT EXISTS modo text NOT NULL DEFAULT 'completa';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='insp_modelo_modo_chk') THEN
    ALTER TABLE public.insp_modelo ADD CONSTRAINT insp_modelo_modo_chk CHECK (modo IN ('rapida','completa'));
  END IF;
END $$;

-- ── (2) modo padrão por empresa (Config da garagem) ──────────────────────────────────────────────────
-- ADD com default 'completa' → linhas EXISTENTES ficam 'completa' (reais não mudam). Depois viramos o
-- default para 'rapida' (empresas NOVAS nascem em rápida) e marcamos demo + Alliance como 'rapida'.
ALTER TABLE public.veic_config ADD COLUMN IF NOT EXISTS vistoria_modo_padrao text NOT NULL DEFAULT 'completa';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='veic_config_vistoria_modo_chk') THEN
    ALTER TABLE public.veic_config ADD CONSTRAINT veic_config_vistoria_modo_chk CHECK (vistoria_modo_padrao IN ('rapida','completa'));
  END IF;
END $$;
ALTER TABLE public.veic_config ALTER COLUMN vistoria_modo_padrao SET DEFAULT 'rapida';
-- SÓ demo passa a abrir a rápida por padrão nesta migration. A virada do padrão da ALLIANCE (empresa
-- REAL) é o ÚLTIMO passo, feito DEPOIS do merge + auditoria, junto com o texto do chamado #31 para o CEO
-- aprovar — nada em produção de empresa real antes disso (regra do Eng. Chefe). A migration só semeia o
-- MODELO rápido da Alliance (padrao=false), que não muda nada para o cliente.
UPDATE public.veic_config c SET vistoria_modo_padrao='rapida'
 WHERE c.company_id IN (SELECT id FROM companies WHERE is_demo = true);

-- ── (3) semeador da vistoria rápida (9 regiões de 1 item, foto_obrigatoria=false) ─────────────────────
CREATE OR REPLACE FUNCTION public.fn_insp_modelo_semear_rapido(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE v_modelo uuid; v_existe uuid; v_user uuid := auth.uid();
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true),'') = '';
BEGIN
  IF NOT (v_interno OR coalesce(auth.role(),'')='service_role' OR p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT id INTO v_existe FROM insp_modelo
   WHERE company_id=p_company_id AND escopo='veiculo_revenda' AND modo='rapida' AND tipo_alvo='carro' LIMIT 1;
  IF v_existe IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'ja_existia', true, 'modelo_id', v_existe); END IF;

  INSERT INTO insp_modelo (company_id, escopo, nome, tipo_alvo, ativo, padrao, modo, criado_por)
  VALUES (p_company_id, 'veiculo_revenda', 'Vistoria rápida — carro', 'carro', true, false, 'rapida', v_user)
  RETURNING id INTO v_modelo;

  -- 9 regiões de 1 item (foto obrigatória NÃO no nível da região — só no reparo/troca, validado na conclusão)
  INSERT INTO insp_regiao (modelo_id, codigo, nome, ordem, foto_obrigatoria, foto_rotulo)
  SELECT v_modelo, x.codigo, x.nome, x.ordem, false, NULL
  FROM (VALUES
    ('lataria','Lataria',1),('pneus','Pneus',2),('parte_interna','Parte interna',3),
    ('motor','Motor',4),('cambio','Câmbio',5),('suspensao','Suspensão',6),
    ('lanternas','Lanternas',7),('farois','Faróis',8),('vidros','Vidros',9)
  ) AS x(codigo,nome,ordem);

  INSERT INTO insp_item (regiao_id, nome, ordem, categoria_custo)
  SELECT r.id, it.nome, 1, it.categoria_custo
  FROM (VALUES
    ('lataria','lataria','preparacao'),('pneus','pneus','peca'),('parte_interna','parte interna','preparacao'),
    ('motor','motor','mao_de_obra'),('cambio','câmbio','mao_de_obra'),('suspensao','suspensão','peca'),
    ('lanternas','lanternas','peca'),('farois','faróis','peca'),('vidros','vidros','peca')
  ) AS it(regiao_codigo, nome, categoria_custo)
  JOIN insp_regiao r ON r.modelo_id=v_modelo AND r.codigo=it.regiao_codigo;

  RETURN jsonb_build_object('ok', true, 'modelo_id', v_modelo, 'itens', 9);
END $function$;
REVOKE ALL ON FUNCTION public.fn_insp_modelo_semear_rapido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_insp_modelo_semear_rapido(uuid) TO authenticated, service_role;

-- Semeia a rápida na demo Revenda e na Alliance (as que já abrem rápida por padrão)
SELECT public.fn_insp_modelo_semear_rapido('b0700000-0000-4000-a000-000000000003');
SELECT public.fn_insp_modelo_semear_rapido('5ab9cfd2-1446-4c0b-a069-0c7ea04e0cfb');

-- ── (4) conclusão: foto obrigatória só em reparo/troca (modelo rápido) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_insp_vistoria_concluir(p_vistoria_id uuid, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v record; v_fotos jsonb; v_gastos jsonb; v_fotos_rt jsonb; v_total int; v_aval int; v_cob numeric; v_modo text;
BEGIN
  SELECT * INTO v FROM insp_vistoria WHERE id = p_vistoria_id;
  IF v.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'vistoria_nao_encontrada'); END IF;
  IF NOT (v.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v.situacao = 'concluida' THEN
    RETURN jsonb_build_object('ok', true, 'ja_concluida', true, 'previsao_total', v.previsao_total); END IF;
  IF v.situacao <> 'em_andamento' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'vistoria_nao_editavel', 'situacao', v.situacao); END IF;

  SELECT modo INTO v_modo FROM insp_modelo WHERE id = v.modelo_id;

  -- guard 1: regiao com foto_obrigatoria sem foto (modelo completa)
  SELECT jsonb_agg(r.nome ORDER BY r.ordem) INTO v_fotos FROM insp_regiao r
   WHERE r.modelo_id = v.modelo_id AND r.foto_obrigatoria = true
     AND NOT EXISTS (SELECT 1 FROM insp_foto f WHERE f.vistoria_id = v.id AND f.regiao_id = r.id);

  -- guard 1b (R0.3, modelo rápido): item em reparo/troca SEM foto (na resposta ou na região) bloqueia
  IF v_modo = 'rapida' THEN
    SELECT jsonb_agg(i.nome ORDER BY i.nome) INTO v_fotos_rt
    FROM insp_resposta resp JOIN insp_item i ON i.id = resp.item_id JOIN insp_regiao r ON r.id = i.regiao_id
    WHERE resp.vistoria_id = v.id AND resp.estado IN ('reparo','troca')
      AND coalesce(btrim(resp.foto_path),'') = ''
      AND NOT EXISTS (SELECT 1 FROM insp_foto f WHERE f.vistoria_id = v.id AND f.regiao_id = r.id);
  END IF;

  -- guard 2: item em reparo/troca sem gasto_previsto
  SELECT jsonb_agg(i.nome ORDER BY i.nome) INTO v_gastos FROM insp_resposta resp
   JOIN insp_item i ON i.id = resp.item_id
   WHERE resp.vistoria_id = v.id AND resp.estado IN ('reparo','troca') AND resp.gasto_previsto IS NULL;

  IF v_fotos IS NOT NULL OR v_gastos IS NOT NULL OR v_fotos_rt IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'pendencias',
      'fotos_faltando', COALESCE(v_fotos, '[]'::jsonb),
      'fotos_reparo_troca_faltando', COALESCE(v_fotos_rt, '[]'::jsonb),
      'gastos_faltando', COALESCE(v_gastos, '[]'::jsonb));
  END IF;

  SELECT count(*) INTO v_total FROM insp_item i JOIN insp_regiao r ON r.id = i.regiao_id
    WHERE r.modelo_id = v.modelo_id AND i.ativo;
  SELECT count(*) INTO v_aval FROM insp_resposta resp
    WHERE resp.vistoria_id = v.id AND resp.estado IS NOT NULL;
  v_cob := CASE WHEN v_total > 0 THEN round((v_aval::numeric / v_total * 100), 1) ELSE NULL END;

  UPDATE insp_vistoria
     SET situacao = 'concluida', concluida_em = now(),
         observacao = COALESCE(NULLIF(btrim(v.observacao),'') || ' | ', '')
                      || 'Cobertura na conclusao: ' || v_aval || ' de ' || v_total || ' itens avaliados (' || COALESCE(v_cob::text,'-') || '%)'
   WHERE id = v.id;

  RETURN jsonb_build_object('ok', true, 'previsao_total', v.previsao_total, 'concluida_em', now(),
    'itens_total', v_total, 'itens_avaliados', v_aval, 'cobertura_pct', v_cob);
END $function$;

-- ── (5) fn_veic_config_salvar aceita vistoria_modo_padrao ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_veic_config_salvar(p_company_id uuid, p_dados jsonb, p_user uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_imp numeric; v_com numeric; v_gar numeric; v_margem numeric; v_sv int; v_sa int; v_vmodo text;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  BEGIN v_imp := NULLIF(btrim(p_dados->>'impostos_venda_pct'),'')::numeric; EXCEPTION WHEN others THEN v_imp := NULL; END;
  BEGIN v_com := NULLIF(btrim(p_dados->>'comissao_venda_pct'),'')::numeric; EXCEPTION WHEN others THEN v_com := NULL; END;
  BEGIN v_gar := NULLIF(btrim(p_dados->>'provisao_garantia_pct'),'')::numeric; EXCEPTION WHEN others THEN v_gar := NULL; END;
  BEGIN v_margem := NULLIF(btrim(p_dados->>'margem_alvo_pct'),'')::numeric; EXCEPTION WHEN others THEN v_margem := NULL; END;
  BEGIN v_sv := NULLIF(btrim(p_dados->>'semaforo_verde_ate_dias'),'')::int; EXCEPTION WHEN others THEN v_sv := NULL; END;
  BEGIN v_sa := NULLIF(btrim(p_dados->>'semaforo_amarelo_ate_dias'),'')::int; EXCEPTION WHEN others THEN v_sa := NULL; END;
  -- R0.3: modo padrão de vistoria ('rapida'|'completa'); valor inválido é ignorado (mantém o atual)
  v_vmodo := CASE WHEN p_dados->>'vistoria_modo_padrao' IN ('rapida','completa') THEN p_dados->>'vistoria_modo_padrao' ELSE NULL END;

  INSERT INTO veic_config (company_id, semaforo_verde_ate_dias, semaforo_amarelo_ate_dias, margem_alvo_pct,
      impostos_venda_pct, comissao_venda_pct, provisao_garantia_pct, vistoria_modo_padrao, updated_at)
  VALUES (p_company_id, COALESCE(v_sv, 30), COALESCE(v_sa, 60), COALESCE(v_margem, 20), v_imp, v_com, v_gar,
      COALESCE(v_vmodo,'rapida'), now())
  ON CONFLICT (company_id) DO UPDATE SET
    semaforo_verde_ate_dias   = COALESCE(v_sv, veic_config.semaforo_verde_ate_dias),
    semaforo_amarelo_ate_dias = COALESCE(v_sa, veic_config.semaforo_amarelo_ate_dias),
    margem_alvo_pct           = COALESCE(v_margem, veic_config.margem_alvo_pct),
    impostos_venda_pct        = v_imp,
    comissao_venda_pct        = v_com,
    provisao_garantia_pct     = v_gar,
    vistoria_modo_padrao      = COALESCE(v_vmodo, veic_config.vistoria_modo_padrao),
    updated_at                = now();

  RETURN jsonb_build_object('ok', true, 'impostos_venda_pct', v_imp, 'comissao_venda_pct', v_com,
    'provisao_garantia_pct', v_gar, 'margem_alvo_pct', COALESCE(v_margem,
      (SELECT margem_alvo_pct FROM veic_config WHERE company_id = p_company_id)),
    'vistoria_modo_padrao', (SELECT vistoria_modo_padrao FROM veic_config WHERE company_id = p_company_id));
END $function$;
