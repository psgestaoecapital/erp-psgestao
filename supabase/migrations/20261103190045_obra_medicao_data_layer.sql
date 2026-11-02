-- Hub · Gestão de Obras · MEDIÇÃO ao cliente (CEO 02/11, Blueprint §15 ⑧/⑨ e §16 H4) — slice 1: CAMADA DE DADOS.
-- A medição NASCE dos itens de escopo da obra (projetos_obra_item). Cada medição soma linhas por PERCENTUAL ou por
-- QUANTIDADE do item; o ACUMULADO aprovado por item nunca passa do valor contratado (vigente) e nunca fica negativo;
-- linha NEGATIVA é permitida para CORREÇÃO. Esta PR entrega só as tabelas + RPCs (criar/aprovar/listar/excluir).
-- A ponte [→GE] (medição aprovada → erp_receber com retenção) e a aba Medições na tela vêm nas PRs seguintes.
-- ADITIVA: tabelas NOVAS (hub-owned) + RPCs guardadas. NÃO recria financeiro nem toca dado de cliente de outras áreas.

-- 1) Tabelas NOVAS -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.projetos_obra_medicao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  obra_id       uuid NOT NULL REFERENCES public.projetos_obras(id) ON DELETE CASCADE,
  numero        integer NOT NULL DEFAULT 1,
  tipo          text NOT NULL DEFAULT 'percentual' CHECK (tipo IN ('percentual','quantidade')),
  competencia   date NOT NULL DEFAULT current_date,
  status        text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','aprovada')),
  valor_total   numeric NOT NULL DEFAULT 0,
  observacoes   text,
  aprovada_em   timestamptz,
  aprovada_por  uuid,
  criado_por    uuid,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  excluido_em   timestamptz,
  excluido_por  uuid,
  motivo_exclusao text
);

CREATE TABLE IF NOT EXISTS public.projetos_obra_medicao_item (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  medicao_id    uuid NOT NULL REFERENCES public.projetos_obra_medicao(id) ON DELETE CASCADE,
  obra_item_id  uuid NOT NULL REFERENCES public.projetos_obra_item(id) ON DELETE CASCADE,
  percentual    numeric,
  quantidade    numeric,
  valor         numeric NOT NULL DEFAULT 0,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  excluido_em   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_obra_medicao_obra ON public.projetos_obra_medicao(obra_id) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_obra_medicao_item_med ON public.projetos_obra_medicao_item(medicao_id) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_obra_medicao_item_oitem ON public.projetos_obra_medicao_item(obra_item_id) WHERE excluido_em IS NULL;

-- 2) RLS por company_id + REVOKE anon ------------------------------------------------------------------
ALTER TABLE public.projetos_obra_medicao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projetos_obra_medicao_item ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projetos_obra_medicao_rw ON public.projetos_obra_medicao;
CREATE POLICY projetos_obra_medicao_rw ON public.projetos_obra_medicao
  FOR ALL USING (company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()));

DROP POLICY IF EXISTS projetos_obra_medicao_item_rw ON public.projetos_obra_medicao_item;
CREATE POLICY projetos_obra_medicao_item_rw ON public.projetos_obra_medicao_item
  FOR ALL USING (company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()));

REVOKE ALL ON public.projetos_obra_medicao FROM anon;
REVOKE ALL ON public.projetos_obra_medicao_item FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projetos_obra_medicao TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projetos_obra_medicao_item TO authenticated, service_role;

-- 3) RPC: criar medição (rascunho) a partir de linhas por item -----------------------------------------
-- p_itens: [{ "obra_item_id": uuid, "percentual": num, "quantidade": num }]
-- Regra do acumulado (em R$, unifica os dois tipos): 0 <= (aprovado do item + linha) <= valor contratado do item.
CREATE OR REPLACE FUNCTION public.fn_obra_medicao_criar(
  p_obra_id uuid,
  p_tipo text DEFAULT 'percentual',
  p_competencia date DEFAULT current_date,
  p_itens jsonb DEFAULT '[]'::jsonb,
  p_observacoes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE
  v_obra       public.projetos_obras%ROWTYPE;
  v_med_id     uuid;
  v_numero     integer;
  v_total      numeric := 0;
  v_ln         jsonb;
  v_item       public.projetos_obra_item%ROWTYPE;
  v_valor      numeric;
  v_acum       numeric;
  v_contr      numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  IF p_tipo NOT IN ('percentual','quantidade') THEN RETURN jsonb_build_object('ok', false, 'erro', 'Tipo inválido.'); END IF;

  SELECT * INTO v_obra FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada.'); END IF;
  PERFORM public.fn__guarda_empresa(v_obra.company_id);

  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Informe ao menos uma linha de medição.');
  END IF;

  v_numero := COALESCE((SELECT max(numero) FROM public.projetos_obra_medicao WHERE obra_id = p_obra_id), 0) + 1;

  INSERT INTO public.projetos_obra_medicao (company_id, obra_id, numero, tipo, competencia, status, observacoes, criado_por)
  VALUES (v_obra.company_id, p_obra_id, v_numero, p_tipo, COALESCE(p_competencia, current_date), 'rascunho', NULLIF(btrim(p_observacoes), ''), auth.uid())
  RETURNING id INTO v_med_id;

  FOR v_ln IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    SELECT * INTO v_item FROM public.projetos_obra_item
     WHERE id = (v_ln->>'obra_item_id')::uuid AND obra_id = p_obra_id AND company_id = v_obra.company_id AND excluido_em IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item de escopo % não encontrado nesta obra.', v_ln->>'obra_item_id'; END IF;

    v_contr := COALESCE(v_item.valor_contratado,
                        COALESCE(v_item.preco_unitario,0) * COALESCE(v_item.quantidade_contratada,0));

    IF p_tipo = 'percentual' THEN
      v_valor := round(COALESCE((v_ln->>'percentual')::numeric, 0) / 100.0 * v_contr, 2);
    ELSE
      v_valor := round(COALESCE((v_ln->>'quantidade')::numeric, 0) * COALESCE(v_item.preco_unitario, 0), 2);
    END IF;

    -- Acumulado já APROVADO deste item (medições vivas e aprovadas).
    SELECT COALESCE(sum(mi.valor), 0) INTO v_acum
      FROM public.projetos_obra_medicao_item mi
      JOIN public.projetos_obra_medicao m ON m.id = mi.medicao_id
     WHERE mi.obra_item_id = v_item.id AND mi.excluido_em IS NULL
       AND m.status = 'aprovada' AND m.excluido_em IS NULL;

    IF v_acum + v_valor < -0.005 THEN
      RAISE EXCEPTION 'Linha negativa demais no item "%": o acumulado ficaria abaixo de zero.', COALESCE(v_item.descricao, v_item.id::text);
    END IF;
    IF v_contr > 0 AND v_acum + v_valor > v_contr + 0.005 THEN
      RAISE EXCEPTION 'Item "%": o acumulado (R$ %) passaria do contratado (R$ %).',
        COALESCE(v_item.descricao, v_item.id::text), round(v_acum + v_valor, 2), round(v_contr, 2);
    END IF;

    INSERT INTO public.projetos_obra_medicao_item (company_id, medicao_id, obra_item_id, percentual, quantidade, valor)
    VALUES (v_obra.company_id, v_med_id, v_item.id,
            CASE WHEN p_tipo = 'percentual' THEN COALESCE((v_ln->>'percentual')::numeric, 0) END,
            CASE WHEN p_tipo = 'quantidade' THEN COALESCE((v_ln->>'quantidade')::numeric, 0) END,
            v_valor);
    v_total := v_total + v_valor;
  END LOOP;

  UPDATE public.projetos_obra_medicao SET valor_total = v_total, atualizado_em = now() WHERE id = v_med_id;

  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
  VALUES (v_obra.company_id, auth.uid(), 'projetos_obra_medicao', v_med_id::text, 'CRIOU',
          jsonb_build_object('obra_id', p_obra_id, 'numero', v_numero, 'tipo', p_tipo, 'valor_total', v_total));

  RETURN jsonb_build_object('ok', true, 'medicao_id', v_med_id, 'numero', v_numero, 'valor_total', v_total);
END $f$;

-- 4) RPC: aprovar medição (atualiza quantidade_medida do item e valor_medido da obra) ------------------
CREATE OR REPLACE FUNCTION public.fn_obra_medicao_aprovar(p_medicao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE
  v_med   public.projetos_obra_medicao%ROWTYPE;
  v_mi    record;
  v_item  public.projetos_obra_item%ROWTYPE;
  v_contr numeric;
  v_acum  numeric;
  v_qtd   numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_med FROM public.projetos_obra_medicao WHERE id = p_medicao_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Medição não encontrada.'); END IF;
  PERFORM public.fn__guarda_empresa(v_med.company_id);
  IF v_med.status = 'aprovada' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Medição já aprovada.'); END IF;

  FOR v_mi IN
    SELECT mi.* FROM public.projetos_obra_medicao_item mi WHERE mi.medicao_id = p_medicao_id AND mi.excluido_em IS NULL
  LOOP
    SELECT * INTO v_item FROM public.projetos_obra_item WHERE id = v_mi.obra_item_id AND excluido_em IS NULL;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_contr := COALESCE(v_item.valor_contratado, COALESCE(v_item.preco_unitario,0) * COALESCE(v_item.quantidade_contratada,0));
    SELECT COALESCE(sum(mi.valor), 0) INTO v_acum
      FROM public.projetos_obra_medicao_item mi JOIN public.projetos_obra_medicao m ON m.id = mi.medicao_id
     WHERE mi.obra_item_id = v_item.id AND mi.excluido_em IS NULL AND m.status = 'aprovada' AND m.excluido_em IS NULL;
    IF v_contr > 0 AND v_acum + v_mi.valor > v_contr + 0.005 THEN
      RAISE EXCEPTION 'Item "%": aprovar passaria do contratado.', COALESCE(v_item.descricao, v_item.id::text);
    END IF;
    IF v_acum + v_mi.valor < -0.005 THEN
      RAISE EXCEPTION 'Item "%": aprovar deixaria o acumulado negativo.', COALESCE(v_item.descricao, v_item.id::text);
    END IF;
    -- Quantidade medida equivalente (vale para os dois tipos): valor / preço unitário.
    v_qtd := v_mi.valor / NULLIF(COALESCE(v_item.preco_unitario,
                          NULLIF(v_contr / NULLIF(v_item.quantidade_contratada,0), 0)), 0);
    UPDATE public.projetos_obra_item
       SET quantidade_medida = COALESCE(quantidade_medida, 0) + COALESCE(v_qtd, 0), atualizado_em = now()
     WHERE id = v_item.id;
  END LOOP;

  UPDATE public.projetos_obra_medicao
     SET status = 'aprovada', aprovada_em = now(), aprovada_por = auth.uid(), atualizado_em = now()
   WHERE id = p_medicao_id;
  UPDATE public.projetos_obras
     SET valor_medido = COALESCE(valor_medido, 0) + COALESCE(v_med.valor_total, 0), updated_at = now()
   WHERE id = v_med.obra_id;

  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
  VALUES (v_med.company_id, auth.uid(), 'projetos_obra_medicao', p_medicao_id::text, 'APROVOU',
          jsonb_build_object('valor_total', v_med.valor_total, 'numero', v_med.numero));

  RETURN jsonb_build_object('ok', true, 'medicao_id', p_medicao_id, 'status', 'aprovada');
END $f$;

-- 5) RPC: listar medições da obra (histórico com itens e acumulado por item) ---------------------------
CREATE OR REPLACE FUNCTION public.fn_obra_medicao_listar(p_obra_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE
  v_company uuid;
  v_out jsonb;
BEGIN
  SELECT company_id INTO v_company FROM public.projetos_obras WHERE id = p_obra_id AND deleted_at IS NULL;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Obra não encontrada.'); END IF;
  PERFORM public.fn__guarda_empresa(v_company);

  SELECT COALESCE(jsonb_agg(row_to_json(m)::jsonb ORDER BY (m->>'numero')::int DESC), '[]'::jsonb) INTO v_out
  FROM (
    SELECT md.id, md.numero, md.tipo, md.competencia, md.status, md.valor_total, md.observacoes,
           md.aprovada_em, md.criado_em,
           (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                     'obra_item_id', mi.obra_item_id, 'descricao', it.descricao,
                     'percentual', mi.percentual, 'quantidade', mi.quantidade, 'valor', mi.valor,
                     'valor_contratado', COALESCE(it.valor_contratado, COALESCE(it.preco_unitario,0)*COALESCE(it.quantidade_contratada,0))
                   ) ORDER BY it.ordem NULLS LAST), '[]'::jsonb)
              FROM public.projetos_obra_medicao_item mi
              JOIN public.projetos_obra_item it ON it.id = mi.obra_item_id
             WHERE mi.medicao_id = md.id AND mi.excluido_em IS NULL) AS itens
      FROM public.projetos_obra_medicao md
     WHERE md.obra_id = p_obra_id AND md.excluido_em IS NULL
  ) m;

  RETURN jsonb_build_object('ok', true, 'obra_id', p_obra_id, 'medicoes', v_out);
END $f$;

-- 6) RPC: excluir medição (soft-delete rastreável, RD-98 p4; reverte acumulado se estava aprovada) -----
CREATE OR REPLACE FUNCTION public.fn_obra_medicao_excluir(p_medicao_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE
  v_med  public.projetos_obra_medicao%ROWTYPE;
  v_mi   record;
  v_item public.projetos_obra_item%ROWTYPE;
  v_qtd  numeric;
  v_contr numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sem sessão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_med FROM public.projetos_obra_medicao WHERE id = p_medicao_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Medição não encontrada.'); END IF;
  PERFORM public.fn__guarda_empresa(v_med.company_id);

  IF v_med.status = 'aprovada' THEN
    -- Reverte o que a aprovação somou (quantidade_medida do item e valor_medido da obra).
    FOR v_mi IN SELECT * FROM public.projetos_obra_medicao_item WHERE medicao_id = p_medicao_id AND excluido_em IS NULL LOOP
      SELECT * INTO v_item FROM public.projetos_obra_item WHERE id = v_mi.obra_item_id;
      IF FOUND THEN
        v_contr := COALESCE(v_item.valor_contratado, COALESCE(v_item.preco_unitario,0)*COALESCE(v_item.quantidade_contratada,0));
        v_qtd := v_mi.valor / NULLIF(COALESCE(v_item.preco_unitario, NULLIF(v_contr / NULLIF(v_item.quantidade_contratada,0),0)),0);
        UPDATE public.projetos_obra_item SET quantidade_medida = COALESCE(quantidade_medida,0) - COALESCE(v_qtd,0), atualizado_em = now()
         WHERE id = v_item.id;
      END IF;
    END LOOP;
    UPDATE public.projetos_obras SET valor_medido = COALESCE(valor_medido,0) - COALESCE(v_med.valor_total,0), updated_at = now()
     WHERE id = v_med.obra_id;
  END IF;

  UPDATE public.projetos_obra_medicao
     SET excluido_em = now(), excluido_por = auth.uid(), motivo_exclusao = NULLIF(btrim(p_motivo),''), atualizado_em = now()
   WHERE id = p_medicao_id;
  UPDATE public.projetos_obra_medicao_item SET excluido_em = now() WHERE medicao_id = p_medicao_id AND excluido_em IS NULL;

  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (v_med.company_id, auth.uid(), 'projetos_obra_medicao', p_medicao_id::text, 'EXCLUIU',
          jsonb_build_object('status', v_med.status, 'valor_total', v_med.valor_total),
          jsonb_build_object('motivo', NULLIF(btrim(p_motivo),'')));

  RETURN jsonb_build_object('ok', true, 'medicao_id', p_medicao_id);
END $f$;

REVOKE ALL ON FUNCTION public.fn_obra_medicao_criar(uuid, text, date, jsonb, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_obra_medicao_aprovar(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_obra_medicao_listar(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_obra_medicao_excluir(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_obra_medicao_criar(uuid, text, date, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_medicao_aprovar(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_medicao_listar(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_medicao_excluir(uuid, text) TO authenticated, service_role;
