-- HB2 · Contrato de preços: SALDO CONTRATADO por serviço (auditoria 24/10, item e · requisito 821125f2) · desenvolvedor_6_g (faixa 54).
-- Quantidade contratada por serviço; o saldo = contratada − soma medida nas medições salvas do contrato.
-- ADITIVA: 1 tabela NOVA (RLS por empresa, só leitura direta), 2 funções NOVAS com guarda de empresa, gatilho de consulta (viewer só lê)
-- e textos NOVOS de "?" (RD-95). Nenhuma função, view ou policy existente muda.
CREATE TABLE IF NOT EXISTS public.erp_tabela_preco_saldo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  tabela_id uuid NOT NULL REFERENCES public.erp_tabela_preco_cliente(id) ON DELETE CASCADE,
  servico_ref text NOT NULL,
  quantidade_contratada numeric NOT NULL CHECK (quantidade_contratada >= 0),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tabela_id, servico_ref)
);
CREATE INDEX IF NOT EXISTS ix_tabela_preco_saldo_company ON public.erp_tabela_preco_saldo (company_id);
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

-- Grava (ou limpa, com quantidade nula) a quantidade contratada de um serviço.
CREATE OR REPLACE FUNCTION public.fn_tabela_preco_saldo_gravar(p_tabela uuid, p_servico_ref text, p_quantidade numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_co uuid;
BEGIN
  SELECT company_id INTO v_co FROM erp_tabela_preco_cliente WHERE id = p_tabela;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;
  PERFORM public.fn__guarda_empresa(v_co);
  IF btrim(coalesce(p_servico_ref,'')) = '' THEN RAISE EXCEPTION 'Informe o serviço'; END IF;
  IF p_quantidade IS NULL THEN
    DELETE FROM erp_tabela_preco_saldo WHERE tabela_id = p_tabela AND servico_ref = p_servico_ref;
  ELSE
    IF p_quantidade < 0 THEN RAISE EXCEPTION 'A quantidade contratada não pode ser negativa'; END IF;
    INSERT INTO erp_tabela_preco_saldo (company_id, tabela_id, servico_ref, quantidade_contratada)
    VALUES (v_co, p_tabela, p_servico_ref, p_quantidade)
    ON CONFLICT (tabela_id, servico_ref) DO UPDATE SET quantidade_contratada = EXCLUDED.quantidade_contratada, atualizado_em = now();
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Saldo por serviço: contratada, medida (todas as medições salvas) e saldo; só serviços com quantidade contratada.
CREATE OR REPLACE FUNCTION public.fn_tabela_preco_saldo(p_tabela uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_co uuid; v_out jsonb;
BEGIN
  SELECT company_id INTO v_co FROM erp_tabela_preco_cliente WHERE id = p_tabela;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;
  PERFORM public.fn__guarda_empresa(v_co);
  SELECT coalesce(jsonb_agg(jsonb_build_object('servico_ref', s.servico_ref, 'contratada', s.quantidade_contratada,
           'medida', m.med, 'saldo', s.quantidade_contratada - m.med) ORDER BY s.servico_ref), '[]'::jsonb)
    INTO v_out
    FROM erp_tabela_preco_saldo s
    CROSS JOIN LATERAL (SELECT coalesce(sum(i.quantidade), 0) AS med
                          FROM erp_medicao_cliente_item i JOIN erp_medicao_cliente c ON c.id = i.medicao_id
                         WHERE c.tabela_id = p_tabela AND i.servico_ref = s.servico_ref) m
   WHERE s.tabela_id = p_tabela;
  RETURN jsonb_build_object('ok', true, 'linhas', v_out);
END $$;

REVOKE ALL ON FUNCTION public.fn_tabela_preco_saldo_gravar(uuid, text, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_tabela_preco_saldo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_saldo_gravar(uuid, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_saldo(uuid) TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Tabela de preço', v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/projetos/tabelas-preco', 'hub_construcao', 'publicado'
FROM (VALUES
 ('hub.tabela_preco.saldo', 'Saldo contratado', 'Informe, por serviço, a quantidade total prevista no contrato.', 'Mostra quanto já foi medido e quanto ainda resta do contrato (contratado − medido nas medições salvas).', 'Contratado 5.000 m², medido 1.200 m², saldo 3.800 m²', 'Esperar que o saldo desconte a medição ainda não salva: só as medições salvas contam.', 61),
 ('hub.tabela_preco.saldo_contratada', 'Quantidade contratada', 'Quantidade total do serviço prevista no contrato, na unidade do serviço. Deixe vazio para tirar o serviço do saldo.', 'É a base do saldo: contratado menos o que já foi medido.', '5000', 'Digitar o valor em R$ em vez da quantidade.', 62),
 ('hub.tabela_preco.medicao_exportar', 'Exportar medição (XLS/PDF)', 'Escolha Excel para planilha ou PDF para o documento de envio ao cliente.', 'Gera o extrato da medição com serviço, regime, código do cliente, unitário e total.', 'Exportar a medição de outubro em PDF', 'Exportar uma medição ainda não calculada: calcule ou abra uma salva antes.', 63)
) AS v(chave, rotulo, o, p, e, x, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo a WHERE a.chave = v.chave);
