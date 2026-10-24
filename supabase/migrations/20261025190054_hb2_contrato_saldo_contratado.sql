-- Contrato de preços · SALDO CONTRATADO (requisito 821125f2) — auditor_pdca_g 24/10 · desenvolvedor_6_g (faixa 54).
-- Quantidade contratada por serviço do contrato; o saldo = contratado − soma das medições salvas. ADITIVA: 1 tabela NOVA
-- (RLS por empresa, leitura direta; escrita só pela função, barrada para perfil de consulta pelo gatilho existente) e 2 funções NOVAS.
CREATE TABLE IF NOT EXISTS public.erp_tabela_preco_saldo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  tabela_id uuid NOT NULL REFERENCES public.erp_tabela_preco_cliente(id),
  servico_ref text NOT NULL,
  quantidade_contratada numeric(15,3) NOT NULL CHECK (quantidade_contratada >= 0),
  UNIQUE (tabela_id, servico_ref)
);
CREATE INDEX IF NOT EXISTS ix_tp_saldo_company ON public.erp_tabela_preco_saldo (company_id);
ALTER TABLE public.erp_tabela_preco_saldo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_tabela_preco_saldo_select ON public.erp_tabela_preco_saldo;
CREATE POLICY erp_tabela_preco_saldo_select ON public.erp_tabela_preco_saldo FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
REVOKE ALL ON public.erp_tabela_preco_saldo FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.erp_tabela_preco_saldo FROM authenticated;
GRANT SELECT ON public.erp_tabela_preco_saldo TO authenticated;
DROP TRIGGER IF EXISTS trg_tabela_preco_trava_viewer ON public.erp_tabela_preco_saldo;
CREATE TRIGGER trg_tabela_preco_trava_viewer BEFORE INSERT OR UPDATE OR DELETE ON public.erp_tabela_preco_saldo
  FOR EACH ROW EXECUTE FUNCTION public.fn__tabela_preco_trava_viewer();

CREATE OR REPLACE FUNCTION public.fn_tabela_preco_saldo_definir(p_tabela uuid, p_servico_ref text, p_quantidade numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_co uuid;
BEGIN
  SELECT company_id INTO v_co FROM erp_tabela_preco_cliente WHERE id = p_tabela AND ativo;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;
  PERFORM public.fn__guarda_empresa(v_co);
  IF NOT EXISTS (SELECT 1 FROM erp_tabela_preco_item WHERE tabela_id = p_tabela AND servico_ref = p_servico_ref) THEN
    RAISE EXCEPTION 'Serviço não existe neste contrato'; END IF;
  IF p_quantidade IS NULL OR p_quantidade < 0 THEN RAISE EXCEPTION 'Informe uma quantidade contratada maior ou igual a zero'; END IF;
  INSERT INTO erp_tabela_preco_saldo (company_id, tabela_id, servico_ref, quantidade_contratada)
  VALUES (v_co, p_tabela, p_servico_ref, p_quantidade)
  ON CONFLICT (tabela_id, servico_ref) DO UPDATE SET quantidade_contratada = EXCLUDED.quantidade_contratada;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.fn_tabela_preco_saldo(p_tabela uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_co uuid;
BEGIN
  SELECT company_id INTO v_co FROM erp_tabela_preco_cliente WHERE id = p_tabela;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;
  PERFORM public.fn__guarda_empresa(v_co);
  RETURN jsonb_build_object('ok', true, 'linhas', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('servico_ref', s.servico_ref, 'contratado', s.quantidade_contratada,
             'medido', COALESCE(m.q, 0), 'saldo', s.quantidade_contratada - COALESCE(m.q, 0)) ORDER BY s.servico_ref)
      FROM erp_tabela_preco_saldo s
      LEFT JOIN LATERAL (SELECT sum(i.quantidade) q FROM erp_medicao_cliente_item i
                           JOIN erp_medicao_cliente c ON c.id = i.medicao_id
                          WHERE c.tabela_id = p_tabela AND i.servico_ref = s.servico_ref) m ON true
     WHERE s.tabela_id = p_tabela), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.fn_tabela_preco_saldo_definir(uuid, text, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_tabela_preco_saldo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_saldo_definir(uuid, text, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_saldo(uuid) TO authenticated, service_role;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Tabela de preço', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/tabelas-preco', 'hub_construcao', 'publicado'
FROM (VALUES
 ('hub.tabela_preco.saldo', 'Saldo contratado', 'Por serviço, a quantidade total prevista no contrato. O medido e o saldo são calculados das medições salvas.', 'Mostra quanto do contrato já foi medido e quanto ainda resta a medir.', 'Contratado 1.000 m² · medido 640 m² · saldo 360 m²', 'Esquecer de salvar a medição: só as medições salvas abatem o saldo.', 70),
 ('hub.tabela_preco.saldo_contratado', 'Quantidade contratada', 'Número maior ou igual a zero, na unidade do serviço (m², h, un).', 'Base do saldo: contratado menos medido.', '1000', 'Usar vírgula de milhar (1.000,5 fica 1,0005 em alguns teclados): digite 1000,5.', 71),
 ('hub.tabela_preco.medicao_exportar', 'Baixar medição', 'Escolha PDF (para imprimir/enviar ao cliente) ou Excel (para conferir em planilha).', 'Gera o arquivo da medição aberta com serviço, quantidade, regime, código do cliente, unitário e total.', 'medicao-outubro-2026.xlsx', 'Exportar antes de abrir os itens: abra a medição com Ver itens primeiro.', 72)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
