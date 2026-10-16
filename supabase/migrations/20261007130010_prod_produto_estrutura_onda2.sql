-- Produtividade · Onda 2 (banco) · catálogo genérico de produtos + estrutura de desmontagem + RPCs.
-- Genérico (Indústria V1 §1): nada de código de empresa/sistema aqui. Aditivo; RLS por empresa; sem GRANT a anon (RD-79).
-- Escrita só pelas RPCs (SECURITY DEFINER, search_path fixo, guarda de empresa, REVOKE anon). Arquivar, nunca apagar (RD-30).

CREATE TABLE IF NOT EXISTS public.prod_produto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id   uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  codigo text NOT NULL CHECK (btrim(codigo) <> ''),
  nome text NOT NULL CHECK (btrim(nome) <> ''),
  unidade_id uuid REFERENCES public.prod_unidade_medida(id) ON DELETE SET NULL,
  papel text NOT NULL DEFAULT 'acabado' CHECK (papel IN ('acabado','intermediario','origem','subproduto')),
  fonte_id uuid REFERENCES public.prod_fonte_dados(id) ON DELETE SET NULL,   -- NULL = cadastro manual
  chave_externa text,                                                         -- código na fonte
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, plant_id, codigo)
);

CREATE TABLE IF NOT EXISTS public.prod_estrutura (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plant_id   uuid NOT NULL REFERENCES public.industrial_plants(id) ON DELETE CASCADE,
  origem_produto_id uuid NOT NULL REFERENCES public.prod_produto(id) ON DELETE RESTRICT,
  produto_id uuid NOT NULL REFERENCES public.prod_produto(id) ON DELETE RESTRICT,   -- saída
  fluxo_id uuid REFERENCES public.prod_fluxo(id) ON DELETE SET NULL,
  tipo_saida text NOT NULL DEFAULT 'principal' CHECK (tipo_saida IN ('principal','coproduto','subproduto')),
  rendimento_padrao_pct numeric CHECK (rendimento_padrao_pct IS NULL OR (rendimento_padrao_pct > 0 AND rendimento_padrao_pct <= 100)), -- NULL = "a definir", nunca zero
  fonte_padrao text,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','validado')),
  vigencia_inicio date,
  vigencia_fim date,
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid,
  atualizado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (origem_produto_id <> produto_id),
  CHECK (vigencia_fim IS NULL OR vigencia_inicio IS NULL OR vigencia_fim >= vigencia_inicio)
);
CREATE UNIQUE INDEX IF NOT EXISTS prod_estrutura_ativa_uq
  ON public.prod_estrutura (company_id, plant_id, origem_produto_id, produto_id, COALESCE(fluxo_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE ativo;
CREATE INDEX IF NOT EXISTS prod_estrutura_produto_idx ON public.prod_estrutura (produto_id) WHERE ativo;
CREATE INDEX IF NOT EXISTS prod_estrutura_origem_idx ON public.prod_estrutura (origem_produto_id) WHERE ativo;

-- Entrada da etapa e FK de produto (aditivo: linhas antigas não são validadas)
ALTER TABLE public.prod_fluxo ADD COLUMN IF NOT EXISTS produto_origem_id uuid REFERENCES public.prod_produto(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prod_fluxo_produto_id_fkey2') THEN
    ALTER TABLE public.prod_fluxo ADD CONSTRAINT prod_fluxo_produto_id_fkey2
      FOREIGN KEY (produto_id) REFERENCES public.prod_produto(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['prod_produto','prod_estrutura'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (company_id IN (SELECT public.get_user_company_ids()))', t||'_sel', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'tg_'||t||'_upd', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_update_updated_at()', 'tg_'||t||'_upd', t);
  END LOOP;
END $$;

-- ── helpers internos (sem GRANT: só as RPCs chamam) ───────────────────────
CREATE OR REPLACE FUNCTION public.fn_prod_estrutura_alcanca(p_company_id uuid, p_de uuid, p_ate uuid, p_excluir uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  -- true se, partindo de p_de e descendo (origem→saída), chega em p_ate
  WITH RECURSIVE d(id, caminho) AS (
    SELECT p_de, ARRAY[p_de]
    UNION ALL
    SELECT e.produto_id, d.caminho || e.produto_id
      FROM d JOIN public.prod_estrutura e ON e.origem_produto_id = d.id AND e.company_id = p_company_id AND e.ativo AND e.id IS DISTINCT FROM p_excluir
     WHERE NOT e.produto_id = ANY(d.caminho)
  )
  SELECT EXISTS (SELECT 1 FROM d WHERE id = p_ate)
$$;
REVOKE ALL ON FUNCTION public.fn_prod_estrutura_alcanca(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_prod_assert_planta(p_company_id uuid, p_plant_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  IF NOT EXISTS (SELECT 1 FROM public.industrial_plants WHERE id = p_plant_id AND company_id = p_company_id) THEN
    RAISE EXCEPTION 'planta_invalida';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_prod_assert_planta(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── produto ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_prod_produto_listar(p_company_id uuid, p_plant_id uuid, p_busca text DEFAULT NULL, p_papel text DEFAULT NULL, p_incluir_arquivados boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb; b text := NULLIF(btrim(coalesce(p_busca,'')),'');
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.codigo), '[]'::jsonb) INTO v FROM (
    SELECT p.id, p.codigo, p.nome, p.unidade_id, u.codigo AS unidade, p.papel, p.fonte_id, p.chave_externa, p.ativo
      FROM public.prod_produto p LEFT JOIN public.prod_unidade_medida u ON u.id = p.unidade_id
     WHERE p.company_id = p_company_id AND p.plant_id = p_plant_id
       AND (p_incluir_arquivados OR p.ativo)
       AND (p_papel IS NULL OR p.papel = p_papel)
       AND (b IS NULL OR p.codigo ILIKE '%'||b||'%' OR p.nome ILIKE '%'||b||'%')
     ORDER BY p.codigo LIMIT 200) x;
  RETURN jsonb_build_object('ok', true, 'itens', v);
END $$;

CREATE OR REPLACE FUNCTION public.fn_prod_produto_salvar(p_company_id uuid, p_plant_id uuid, p_id uuid, p_codigo text, p_nome text,
  p_unidade_id uuid DEFAULT NULL, p_papel text DEFAULT 'acabado', p_fonte_id uuid DEFAULT NULL, p_chave_externa text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF p_codigo IS NULL OR btrim(p_codigo) = '' THEN RAISE EXCEPTION 'codigo_invalido'; END IF;
  IF p_nome IS NULL OR btrim(p_nome) = '' THEN RAISE EXCEPTION 'nome_invalido'; END IF;
  IF p_papel NOT IN ('acabado','intermediario','origem','subproduto') THEN RAISE EXCEPTION 'papel_invalido'; END IF;
  IF p_unidade_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.prod_unidade_medida WHERE id = p_unidade_id AND company_id = p_company_id AND plant_id = p_plant_id) THEN RAISE EXCEPTION 'unidade_invalida'; END IF;
  IF p_fonte_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.prod_fonte_dados WHERE id = p_fonte_id AND company_id = p_company_id AND plant_id = p_plant_id) THEN RAISE EXCEPTION 'fonte_invalida'; END IF;
  IF p_id IS NULL THEN
    -- reaproveita o produto arquivado de mesmo código (evita duplicar) e o reativa
    INSERT INTO public.prod_produto (company_id, plant_id, codigo, nome, unidade_id, papel, fonte_id, chave_externa)
    VALUES (p_company_id, p_plant_id, btrim(p_codigo), btrim(p_nome), p_unidade_id, p_papel, p_fonte_id, p_chave_externa)
    ON CONFLICT (company_id, plant_id, codigo) DO UPDATE
      SET nome = EXCLUDED.nome, unidade_id = EXCLUDED.unidade_id, papel = EXCLUDED.papel, fonte_id = EXCLUDED.fonte_id,
          chave_externa = EXCLUDED.chave_externa, ativo = true
      WHERE NOT public.prod_produto.ativo
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'codigo_ja_existe'; END IF;
  ELSE
    UPDATE public.prod_produto SET codigo = btrim(p_codigo), nome = btrim(p_nome), unidade_id = p_unidade_id, papel = p_papel,
           fonte_id = p_fonte_id, chave_externa = p_chave_externa
     WHERE id = p_id AND company_id = p_company_id AND plant_id = p_plant_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'produto_nao_encontrado'; END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'codigo_ja_existe';
END $$;

CREATE OR REPLACE FUNCTION public.fn_prod_produto_arquivar(p_company_id uuid, p_id uuid, p_ativo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  UPDATE public.prod_produto SET ativo = coalesce(p_ativo, false) WHERE id = p_id AND company_id = p_company_id RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'produto_nao_encontrado'; END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'ativo', coalesce(p_ativo, false));
END $$;

-- ── estrutura ─────────────────────────────────────────────────────────────
-- Árvore do acabado até a origem: nível 0 = acabado; cada linha = uma ligação origem→saída (nível = distância do acabado).
CREATE OR REPLACE FUNCTION public.fn_prod_estrutura_listar(p_company_id uuid, p_plant_id uuid, p_produto_id uuid, p_incluir_arquivados boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb; v_avisos jsonb;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  WITH RECURSIVE arv AS (
    SELECT e.id, e.origem_produto_id, e.produto_id, 1 AS nivel, ARRAY[e.produto_id] AS caminho
      FROM public.prod_estrutura e
     WHERE e.company_id = p_company_id AND e.plant_id = p_plant_id AND e.produto_id = p_produto_id AND (p_incluir_arquivados OR e.ativo)
    UNION ALL
    SELECT e.id, e.origem_produto_id, e.produto_id, a.nivel + 1, a.caminho || e.produto_id
      FROM arv a JOIN public.prod_estrutura e ON e.produto_id = a.origem_produto_id
       AND e.company_id = p_company_id AND e.plant_id = p_plant_id AND (p_incluir_arquivados OR e.ativo)
     WHERE NOT e.produto_id = ANY(a.caminho) AND a.nivel < 30
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', e.id, 'nivel', a.nivel, 'origem_produto_id', e.origem_produto_id, 'origem_codigo', po.codigo, 'origem_nome', po.nome,
           'produto_id', e.produto_id, 'produto_codigo', ps.codigo, 'produto_nome', ps.nome,
           'fluxo_id', e.fluxo_id, 'fluxo_nome', f.nome, 'tipo_saida', e.tipo_saida, 'rendimento_padrao_pct', e.rendimento_padrao_pct,
           'fonte_padrao', e.fonte_padrao, 'status', e.status, 'vigencia_inicio', e.vigencia_inicio, 'vigencia_fim', e.vigencia_fim, 'ativo', e.ativo
         ) ORDER BY a.nivel, ps.codigo, po.codigo), '[]'::jsonb) INTO v
    FROM arv a JOIN public.prod_estrutura e ON e.id = a.id
    JOIN public.prod_produto po ON po.id = e.origem_produto_id
    JOIN public.prod_produto ps ON ps.id = e.produto_id
    LEFT JOIN public.prod_fluxo f ON f.id = e.fluxo_id;

  -- aviso (não bloqueio): origens cujas saídas somam mais de 100%
  SELECT COALESCE(jsonb_agg(jsonb_build_object('origem_produto_id', s.origem_produto_id, 'origem_codigo', s.codigo, 'soma_pct', s.soma)), '[]'::jsonb) INTO v_avisos FROM (
    SELECT e.origem_produto_id, po.codigo, sum(e.rendimento_padrao_pct) AS soma
      FROM public.prod_estrutura e JOIN public.prod_produto po ON po.id = e.origem_produto_id
     WHERE e.company_id = p_company_id AND e.plant_id = p_plant_id AND e.ativo
       AND e.origem_produto_id IN (SELECT (x->>'origem_produto_id')::uuid FROM jsonb_array_elements(v) x)
     GROUP BY e.origem_produto_id, po.codigo HAVING sum(e.rendimento_padrao_pct) > 100) s;
  RETURN jsonb_build_object('ok', true, 'nos', v, 'avisos_soma', v_avisos);
END $$;

CREATE OR REPLACE FUNCTION public.fn_prod_estrutura_salvar(p_company_id uuid, p_plant_id uuid, p_id uuid, p_origem_produto_id uuid, p_produto_id uuid,
  p_fluxo_id uuid DEFAULT NULL, p_tipo_saida text DEFAULT 'principal', p_rendimento_pct numeric DEFAULT NULL, p_fonte_padrao text DEFAULT NULL,
  p_status text DEFAULT 'rascunho', p_vigencia_inicio date DEFAULT NULL, p_vigencia_fim date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; v_soma numeric; v_aviso jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF p_origem_produto_id IS NULL OR p_produto_id IS NULL THEN RAISE EXCEPTION 'produto_obrigatorio'; END IF;
  IF p_origem_produto_id = p_produto_id THEN RAISE EXCEPTION 'ciclo_na_estrutura'; END IF;
  IF p_tipo_saida NOT IN ('principal','coproduto','subproduto') THEN RAISE EXCEPTION 'tipo_saida_invalido'; END IF;
  IF p_status NOT IN ('rascunho','validado') THEN RAISE EXCEPTION 'status_invalido'; END IF;
  IF p_rendimento_pct IS NOT NULL AND (p_rendimento_pct <= 0 OR p_rendimento_pct > 100) THEN RAISE EXCEPTION 'rendimento_invalido'; END IF;
  IF p_vigencia_fim IS NOT NULL AND p_vigencia_inicio IS NOT NULL AND p_vigencia_fim < p_vigencia_inicio THEN RAISE EXCEPTION 'vigencia_invalida'; END IF;
  IF (SELECT count(*) FROM public.prod_produto WHERE id IN (p_origem_produto_id, p_produto_id) AND company_id = p_company_id AND plant_id = p_plant_id) <> 2 THEN
    RAISE EXCEPTION 'produto_invalido'; END IF;
  IF p_fluxo_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.prod_fluxo WHERE id = p_fluxo_id AND company_id = p_company_id AND plant_id = p_plant_id) THEN
    RAISE EXCEPTION 'fluxo_invalido'; END IF;
  -- sem ciclo: a saída não pode já levar de volta à origem (desconsidera a própria ligação ao editar)
  IF public.fn_prod_estrutura_alcanca(p_company_id, p_produto_id, p_origem_produto_id, p_id) THEN RAISE EXCEPTION 'ciclo_na_estrutura'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.prod_estrutura (company_id, plant_id, origem_produto_id, produto_id, fluxo_id, tipo_saida, rendimento_padrao_pct, fonte_padrao, status,
                                       vigencia_inicio, vigencia_fim, criado_por, atualizado_por)
    VALUES (p_company_id, p_plant_id, p_origem_produto_id, p_produto_id, p_fluxo_id, p_tipo_saida, p_rendimento_pct, p_fonte_padrao, p_status,
            p_vigencia_inicio, p_vigencia_fim, auth.uid(), auth.uid()) RETURNING id INTO v_id;
  ELSE
    UPDATE public.prod_estrutura SET origem_produto_id = p_origem_produto_id, produto_id = p_produto_id, fluxo_id = p_fluxo_id, tipo_saida = p_tipo_saida,
           rendimento_padrao_pct = p_rendimento_pct, fonte_padrao = p_fonte_padrao, status = p_status,
           vigencia_inicio = p_vigencia_inicio, vigencia_fim = p_vigencia_fim, atualizado_por = auth.uid()
     WHERE id = p_id AND company_id = p_company_id AND plant_id = p_plant_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'estrutura_nao_encontrada'; END IF;
  END IF;
  SELECT sum(rendimento_padrao_pct) INTO v_soma FROM public.prod_estrutura
   WHERE company_id = p_company_id AND plant_id = p_plant_id AND origem_produto_id = p_origem_produto_id AND ativo;
  IF v_soma > 100 THEN v_aviso := jsonb_build_array(jsonb_build_object('tipo', 'soma_acima_100', 'soma_pct', v_soma)); END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'avisos', v_aviso);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'ligacao_ja_existe';
END $$;

CREATE OR REPLACE FUNCTION public.fn_prod_estrutura_arquivar(p_company_id uuid, p_id uuid, p_ativo boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; r public.prod_estrutura;
BEGIN
  PERFORM public.fn_compliance_assert(p_company_id);
  SELECT * INTO r FROM public.prod_estrutura WHERE id = p_id AND company_id = p_company_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'estrutura_nao_encontrada'; END IF;
  IF coalesce(p_ativo, false) AND public.fn_prod_estrutura_alcanca(p_company_id, r.produto_id, r.origem_produto_id) THEN RAISE EXCEPTION 'ciclo_na_estrutura'; END IF;
  UPDATE public.prod_estrutura SET ativo = coalesce(p_ativo, false), atualizado_por = auth.uid() WHERE id = p_id RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'ativo', coalesce(p_ativo, false));
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'ligacao_ja_existe';
END $$;

-- ── Colar lista: "origem;produto;tipo_saida;rendimento_pct;etapa" (códigos). Prévia (p_gravar=false) ou grava como RASCUNHO.
CREATE OR REPLACE FUNCTION public.fn_prod_estrutura_colar(p_company_id uuid, p_plant_id uuid, p_linhas text, p_gravar boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  l text; n int := 0; c text[]; v_o uuid; v_p uuid; v_f uuid; v_tipo text; v_rend numeric; v_rt text; v_motivo text;
  v_ok jsonb := '[]'::jsonb; v_erros jsonb := '[]'::jsonb; v_gravadas int := 0;
  -- simula ligações já aceitas na própria colagem para o teste de ciclo (prévia = gravação, em transação interna)
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF p_linhas IS NULL OR btrim(p_linhas) = '' THEN RAISE EXCEPTION 'lista_vazia'; END IF;
  IF length(p_linhas) > 200000 THEN RAISE EXCEPTION 'lista_grande_demais'; END IF;
  -- tudo roda gravando num subbloco; na prévia o bloco é desfeito por exceção controlada
  BEGIN
    FOREACH l IN ARRAY regexp_split_to_array(p_linhas, E'\r?\n') LOOP
      n := n + 1;
      IF btrim(l) = '' THEN CONTINUE; END IF;
      c := string_to_array(l, ';');
      IF n = 1 AND lower(btrim(c[1])) IN ('origem','origem_codigo') THEN CONTINUE; END IF;
      v_motivo := NULL; v_o := NULL; v_p := NULL; v_f := NULL; v_rend := NULL;
      v_tipo := lower(coalesce(NULLIF(btrim(c[3]),''), 'principal'));
      v_rt := NULLIF(replace(btrim(coalesce(c[4],'')), ',', '.'), '');
      SELECT id INTO v_o FROM public.prod_produto WHERE company_id = p_company_id AND plant_id = p_plant_id AND ativo AND codigo = btrim(coalesce(c[1],''));
      SELECT id INTO v_p FROM public.prod_produto WHERE company_id = p_company_id AND plant_id = p_plant_id AND ativo AND codigo = btrim(coalesce(c[2],''));
      IF array_length(c,1) < 2 THEN v_motivo := 'linha_incompleta';
      ELSIF v_o IS NULL THEN v_motivo := 'origem_nao_encontrada: ' || btrim(coalesce(c[1],''));
      ELSIF v_p IS NULL THEN v_motivo := 'produto_nao_encontrado: ' || btrim(coalesce(c[2],''));
      ELSIF v_tipo NOT IN ('principal','coproduto','subproduto') THEN v_motivo := 'tipo_saida_invalido: ' || v_tipo;
      ELSE
        IF v_rt IS NOT NULL THEN
          BEGIN v_rend := v_rt::numeric; EXCEPTION WHEN others THEN v_motivo := 'rendimento_invalido: ' || v_rt; END;
          IF v_motivo IS NULL AND (v_rend <= 0 OR v_rend > 100) THEN v_motivo := 'rendimento_invalido: ' || v_rt; END IF;
        END IF;
        IF v_motivo IS NULL AND NULLIF(btrim(coalesce(c[5],'')),'') IS NOT NULL THEN
          SELECT id INTO v_f FROM public.prod_fluxo WHERE company_id = p_company_id AND plant_id = p_plant_id AND ativo AND lower(nome) = lower(btrim(c[5])) LIMIT 1;
          IF v_f IS NULL THEN v_motivo := 'etapa_nao_encontrada: ' || btrim(c[5]); END IF;
        END IF;
        IF v_motivo IS NULL AND v_o = v_p THEN v_motivo := 'ciclo_na_estrutura'; END IF;
        IF v_motivo IS NULL AND public.fn_prod_estrutura_alcanca(p_company_id, v_p, v_o) THEN v_motivo := 'ciclo_na_estrutura'; END IF;
        IF v_motivo IS NULL AND EXISTS (SELECT 1 FROM public.prod_estrutura WHERE company_id = p_company_id AND plant_id = p_plant_id AND ativo
              AND origem_produto_id = v_o AND produto_id = v_p AND COALESCE(fluxo_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_f,'00000000-0000-0000-0000-000000000000'::uuid)) THEN
          v_motivo := 'ligacao_ja_existe';
        END IF;
      END IF;
      IF v_motivo IS NOT NULL THEN
        v_erros := v_erros || jsonb_build_object('linha', n, 'texto', left(l, 200), 'motivo', v_motivo);
      ELSE
        INSERT INTO public.prod_estrutura (company_id, plant_id, origem_produto_id, produto_id, fluxo_id, tipo_saida, rendimento_padrao_pct, status, criado_por, atualizado_por)
        VALUES (p_company_id, p_plant_id, v_o, v_p, v_f, v_tipo, v_rend, 'rascunho', auth.uid(), auth.uid());
        v_ok := v_ok || jsonb_build_object('linha', n, 'origem', btrim(c[1]), 'produto', btrim(c[2]), 'tipo_saida', v_tipo, 'rendimento_pct', v_rend, 'etapa', NULLIF(btrim(coalesce(c[5],'')),''));
      END IF;
    END LOOP;
    IF NOT p_gravar THEN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = '__previa__'; END IF;
    v_gravadas := jsonb_array_length(v_ok);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> '__previa__' THEN RAISE; END IF;   -- desfaz só o bloco da prévia
  END;
  RETURN jsonb_build_object('ok', true, 'gravado', p_gravar, 'validas', v_ok, 'nao_casaram', v_erros, 'gravadas', v_gravadas);
END $$;

REVOKE ALL ON FUNCTION public.fn_prod_produto_listar(uuid,uuid,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_produto_listar(uuid,uuid,text,text,boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_prod_produto_salvar(uuid,uuid,uuid,text,text,uuid,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_produto_salvar(uuid,uuid,uuid,text,text,uuid,text,uuid,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_prod_produto_arquivar(uuid,uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_produto_arquivar(uuid,uuid,boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_prod_estrutura_listar(uuid,uuid,uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_estrutura_listar(uuid,uuid,uuid,boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_prod_estrutura_salvar(uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,text,text,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_estrutura_salvar(uuid,uuid,uuid,uuid,uuid,uuid,text,numeric,text,text,date,date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_prod_estrutura_arquivar(uuid,uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_estrutura_arquivar(uuid,uuid,boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_prod_estrutura_colar(uuid,uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_estrutura_colar(uuid,uuid,text,boolean) TO authenticated, service_role;
  END LOOP;
END $$;
