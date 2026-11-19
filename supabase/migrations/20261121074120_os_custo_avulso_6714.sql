-- #6714 (Oficina) · custo avulso (sem NF) por Ordem de Serviço
-- Pedido do cliente: fornecedores que NÃO emitem nota fiscal por serviço prestado precisam
-- aparecer no custo da OS. Hoje o custo só vem das notas de entrada; isto permite lançar um
-- custo avulso (sem NF) atrelado à OS para que o custo real de cada serviço fique completo.
--
-- Aditiva (RD-94.1 c): tabela NOVA com RLS por empresa (mesmo padrão de erp_os_aprovacao),
-- REVOKE anon, e RPCs com guarda explícita de empresa + verificação da OS (padrão de
-- fn_oficina_diagnostico_salvar). Não altera dado de cliente nem estrutura existente.
-- Gate: scripts/gates/check-os-custo-avulso-6714.ts.

CREATE TABLE IF NOT EXISTS public.erp_os_custo_avulso (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  os_id       uuid NOT NULL REFERENCES public.erp_os(id) ON DELETE CASCADE,
  descricao   text NOT NULL,
  fornecedor  text,
  categoria   text,
  valor       numeric(14,2) NOT NULL CHECK (valor >= 0),
  data_custo  date NOT NULL DEFAULT current_date,
  observacao  text,
  criado_por  uuid,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  editado_por uuid,
  editado_em  timestamptz
);

COMMENT ON TABLE public.erp_os_custo_avulso IS
  '#6714 · custos avulsos (sem nota fiscal) lançados manualmente em uma OS, para compor o custo real do serviço.';

CREATE INDEX IF NOT EXISTS ix_erp_os_custo_avulso_os
  ON public.erp_os_custo_avulso (company_id, os_id);

ALTER TABLE public.erp_os_custo_avulso ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erp_os_custo_avulso_all ON public.erp_os_custo_avulso;
CREATE POLICY erp_os_custo_avulso_all ON public.erp_os_custo_avulso
  FOR ALL
  USING (company_id IN (SELECT get_user_company_ids()) OR is_admin())
  WITH CHECK (company_id IN (SELECT get_user_company_ids()) OR is_admin());

REVOKE ALL ON TABLE public.erp_os_custo_avulso FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.erp_os_custo_avulso TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Listar os custos avulsos de uma OS (+ total).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_os_custo_avulso_listar(p_company_id uuid, p_os_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_itens jsonb; v_total numeric;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'descricao', c.descricao, 'fornecedor', c.fornecedor,
           'categoria', c.categoria, 'valor', c.valor, 'data_custo', c.data_custo,
           'observacao', c.observacao, 'criado_em', c.criado_em
         ) ORDER BY c.data_custo DESC, c.criado_em DESC), '[]'::jsonb),
         coalesce(sum(c.valor), 0)
    INTO v_itens, v_total
    FROM erp_os_custo_avulso c
   WHERE c.company_id = p_company_id AND c.os_id = p_os_id;
  RETURN jsonb_build_object('ok', true, 'itens', v_itens, 'total', v_total);
END $function$;

-- ---------------------------------------------------------------------------
-- Adicionar um custo avulso a uma OS.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_os_custo_avulso_adicionar(
  p_company_id uuid, p_os_id uuid, p_descricao text, p_valor numeric,
  p_fornecedor text DEFAULT NULL, p_categoria text DEFAULT NULL,
  p_data_custo date DEFAULT NULL, p_observacao text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_os WHERE id = p_os_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'OS nao encontrada nesta empresa');
  END IF;
  IF length(btrim(coalesce(p_descricao,''))) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'informe a descricao do custo');
  END IF;
  IF coalesce(p_valor, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'informe um valor maior que zero');
  END IF;
  INSERT INTO erp_os_custo_avulso (company_id, os_id, descricao, fornecedor, categoria, valor, data_custo, observacao, criado_por)
  VALUES (p_company_id, p_os_id, btrim(p_descricao),
          nullif(btrim(coalesce(p_fornecedor,'')), ''),
          nullif(btrim(coalesce(p_categoria,'')), ''),
          round(p_valor, 2), coalesce(p_data_custo, current_date),
          nullif(btrim(coalesce(p_observacao,'')), ''), auth.uid())
  RETURNING id INTO v_id;
  BEGIN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (p_company_id, auth.uid(), (SELECT email FROM users WHERE id = auth.uid()),
            'erp_os_custo_avulso', v_id::text, 'CRIOU', NULL,
            jsonb_build_object('os_id', p_os_id, 'descricao', btrim(p_descricao), 'valor', round(p_valor, 2)));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

-- ---------------------------------------------------------------------------
-- Editar um custo avulso existente (RD-98).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_os_custo_avulso_editar(
  p_id uuid, p_descricao text, p_valor numeric,
  p_fornecedor text DEFAULT NULL, p_categoria text DEFAULT NULL,
  p_data_custo date DEFAULT NULL, p_observacao text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM erp_os_custo_avulso WHERE id = p_id;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'custo nao encontrado');
  END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  IF length(btrim(coalesce(p_descricao,''))) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'informe a descricao do custo');
  END IF;
  IF coalesce(p_valor, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'informe um valor maior que zero');
  END IF;
  UPDATE erp_os_custo_avulso SET
    descricao  = btrim(p_descricao),
    fornecedor = nullif(btrim(coalesce(p_fornecedor,'')), ''),
    categoria  = nullif(btrim(coalesce(p_categoria,'')), ''),
    valor      = round(p_valor, 2),
    data_custo = coalesce(p_data_custo, data_custo),
    observacao = nullif(btrim(coalesce(p_observacao,'')), ''),
    editado_por = auth.uid(),
    editado_em  = now()
  WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'id', p_id);
END $function$;

-- ---------------------------------------------------------------------------
-- Excluir um custo avulso.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_os_custo_avulso_excluir(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_os uuid; v_desc text; v_valor numeric;
BEGIN
  SELECT company_id, os_id, descricao, valor INTO v_company, v_os, v_desc, v_valor
    FROM erp_os_custo_avulso WHERE id = p_id;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'custo nao encontrado');
  END IF;
  IF NOT (v_company IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a esta empresa');
  END IF;
  DELETE FROM erp_os_custo_avulso WHERE id = p_id;
  BEGIN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), (SELECT email FROM users WHERE id = auth.uid()),
            'erp_os_custo_avulso', p_id::text, 'EXCLUIU',
            jsonb_build_object('os_id', v_os, 'descricao', v_desc, 'valor', v_valor), NULL);
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_os_custo_avulso_listar(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_os_custo_avulso_adicionar(uuid, uuid, text, numeric, text, text, date, text) FROM anon;
REVOKE ALL ON FUNCTION public.fn_os_custo_avulso_editar(uuid, text, numeric, text, text, date, text) FROM anon;
REVOKE ALL ON FUNCTION public.fn_os_custo_avulso_excluir(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_os_custo_avulso_listar(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_os_custo_avulso_adicionar(uuid, uuid, text, numeric, text, text, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_os_custo_avulso_editar(uuid, text, numeric, text, text, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_os_custo_avulso_excluir(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RD-95 · "?" de cada campo da nova seção (rota /dashboard/os).
-- ---------------------------------------------------------------------------
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem) VALUES
 ('oficina.os.custo_avulso.descricao', '/dashboard/os', 'Custos avulsos (sem nota)', 'Descrição do custo',
  'Descreva o custo avulso lançado na OS: o serviço ou material pago a um fornecedor que não emite nota fiscal.',
  'Compõe o custo real da OS junto com as notas de entrada, para o custo/lucro do serviço sair correto nos relatórios.',
  'Ex.: "Mão de obra de terceiro — funilaria" ou "Frete da peça".',
  'Deixar vago ("serviço", "custo"): dificulta conferir depois. Descreva o que foi pago.',
  'oficina', 10),
 ('oficina.os.custo_avulso.valor', '/dashboard/os', 'Custos avulsos (sem nota)', 'Valor (R$)',
  'Informe o valor pago, em reais. Aceita centavos.',
  'É somado ao custo da OS. Quanto maior o custo, menor o lucro do serviço — por isso lance o valor real.',
  'Ex.: 150,00.',
  'Lançar zero ou em branco: o custo não entra. Informe um valor maior que zero.',
  'oficina', 20),
 ('oficina.os.custo_avulso.fornecedor', '/dashboard/os', 'Custos avulsos (sem nota)', 'Fornecedor (opcional)',
  'Quem recebeu o pagamento — o prestador ou a loja. Pode deixar em branco.',
  'Ajuda a rastrear com quem foi gasto e a conferir depois, mesmo sem nota fiscal.',
  'Ex.: "Funilaria do Zé".',
  'Não é obrigatório; se não souber, deixe em branco em vez de inventar.',
  'oficina', 30),
 ('oficina.os.custo_avulso.data', '/dashboard/os', 'Custos avulsos (sem nota)', 'Data do custo',
  'A data em que o custo ocorreu. Começa com a data de hoje; mude se o gasto foi em outro dia.',
  'Organiza os custos no tempo e ajuda a conferir o período do serviço.',
  'Ex.: a data da compra ou do pagamento do terceiro.',
  'Usar a data de hoje para um gasto antigo: atrapalha a conferência por período.',
  'oficina', 40),
 ('oficina.os.custo_avulso.observacao', '/dashboard/os', 'Custos avulsos (sem nota)', 'Observação (opcional)',
  'Qualquer detalhe extra sobre o custo (número do recibo, combinado, etc.).',
  'Guarda o contexto do gasto para quem for conferir mais tarde.',
  'Ex.: "Recibo nº 42, pago em dinheiro".',
  'Não é obrigatório; use só se ajudar a entender o custo.',
  'oficina', 50)
ON CONFLICT (chave) DO NOTHING;
