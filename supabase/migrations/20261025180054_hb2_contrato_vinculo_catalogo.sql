-- HB2 · Contrato de preços: VÍNCULO do serviço do contrato com o catálogo de serviços (gap 6) · desenvolvedor_6_g (faixa 54).
-- Cada serviço da tabela do cliente aponta para um serviço do catálogo (projetos_servicos); o custo da CPU vem do catálogo
-- e alimenta a margem. ADITIVA: 1 tabela NOVA (RLS por empresa, leitura direta), 2 funções NOVAS com guarda de empresa,
-- gatilho de consulta (viewer só lê) e "?" NOVOS (RD-95). Nada existente é reescrito.
CREATE TABLE IF NOT EXISTS public.erp_tabela_preco_vinculo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  tabela_id uuid NOT NULL REFERENCES public.erp_tabela_preco_cliente(id) ON DELETE CASCADE,
  servico_ref text NOT NULL,
  catalogo_servico_id uuid NOT NULL REFERENCES public.projetos_servicos(id) ON DELETE CASCADE,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tabela_id, servico_ref)
);
CREATE INDEX IF NOT EXISTS ix_tabela_preco_vinculo_company ON public.erp_tabela_preco_vinculo (company_id);
ALTER TABLE public.erp_tabela_preco_vinculo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS erp_tabela_preco_vinculo_select ON public.erp_tabela_preco_vinculo;
CREATE POLICY erp_tabela_preco_vinculo_select ON public.erp_tabela_preco_vinculo FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
REVOKE ALL ON public.erp_tabela_preco_vinculo FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.erp_tabela_preco_vinculo FROM authenticated;
GRANT SELECT ON public.erp_tabela_preco_vinculo TO authenticated;

DROP TRIGGER IF EXISTS trg_tabela_preco_trava_viewer ON public.erp_tabela_preco_vinculo;
CREATE TRIGGER trg_tabela_preco_trava_viewer BEFORE INSERT OR UPDATE OR DELETE ON public.erp_tabela_preco_vinculo
  FOR EACH ROW EXECUTE FUNCTION public.fn__tabela_preco_trava_viewer();

-- Vincula (ou desvincula, com catálogo nulo) um serviço do contrato a um serviço do catálogo da MESMA empresa.
CREATE OR REPLACE FUNCTION public.fn_tabela_preco_vinculo_gravar(p_tabela uuid, p_servico_ref text, p_catalogo uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_co uuid;
BEGIN
  SELECT company_id INTO v_co FROM erp_tabela_preco_cliente WHERE id = p_tabela;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;
  PERFORM public.fn__guarda_empresa(v_co);
  IF btrim(coalesce(p_servico_ref,'')) = '' THEN RAISE EXCEPTION 'Informe o serviço'; END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_tabela_preco_item WHERE tabela_id = p_tabela AND servico_ref = p_servico_ref) THEN
    RAISE EXCEPTION 'Serviço não existe neste contrato';
  END IF;
  IF p_catalogo IS NULL THEN
    DELETE FROM erp_tabela_preco_vinculo WHERE tabela_id = p_tabela AND servico_ref = p_servico_ref;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM projetos_servicos WHERE id = p_catalogo AND ativo AND (company_id = v_co OR is_publico)) THEN
      RAISE EXCEPTION 'Serviço do catálogo não encontrado';
    END IF;
    INSERT INTO erp_tabela_preco_vinculo (company_id, tabela_id, servico_ref, catalogo_servico_id)
    VALUES (v_co, p_tabela, p_servico_ref, p_catalogo)
    ON CONFLICT (tabela_id, servico_ref) DO UPDATE SET catalogo_servico_id = EXCLUDED.catalogo_servico_id, atualizado_em = now();
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Vínculos do contrato com o custo unitário (CPU) vindo do catálogo e a margem sobre o preço base da 1ª faixa.
CREATE OR REPLACE FUNCTION public.fn_tabela_preco_vinculos(p_tabela uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_co uuid; v_out jsonb;
BEGIN
  SELECT company_id INTO v_co FROM erp_tabela_preco_cliente WHERE id = p_tabela;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;
  PERFORM public.fn__guarda_empresa(v_co);
  SELECT coalesce(jsonb_agg(jsonb_build_object('servico_ref', v.servico_ref, 'catalogo_id', s.id, 'codigo', s.codigo,
           'nome', s.nome, 'unidade', s.unidade, 'custo_unitario', s.custo_unitario_total) ORDER BY v.servico_ref), '[]'::jsonb)
    INTO v_out
    FROM erp_tabela_preco_vinculo v JOIN projetos_servicos s ON s.id = v.catalogo_servico_id
   WHERE v.tabela_id = p_tabela;
  RETURN jsonb_build_object('ok', true, 'linhas', v_out);
END $$;

REVOKE ALL ON FUNCTION public.fn_tabela_preco_vinculo_gravar(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_tabela_preco_vinculos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_vinculo_gravar(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tabela_preco_vinculos(uuid) TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Tabela de preço', v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/projetos/tabelas-preco', 'hub_construcao', 'publicado'
FROM (VALUES
 ('hub.tabela_preco.vinculo', 'Vínculo com o catálogo', 'Para cada serviço do contrato, escolha o serviço correspondente do seu catálogo.', 'Liga o preço vendido ao custo do catálogo: a calculadora traz o custo da CPU sozinha e mostra a margem.', 'Piso epóxi autonivelante → Epóxi autonivelante 3 mm (CPU R$ 48,00/m²)', 'Vincular a um serviço com unidade diferente da do contrato (m² com m³).', 64),
 ('hub.tabela_preco.vinculo_catalogo', 'Serviço do catálogo', 'Escolha o serviço do catálogo que corresponde a este serviço do contrato. Escolha "sem vínculo" para desfazer.', 'O custo unitário do catálogo vira o custo da CPU na calculadora e na margem.', 'Epóxi autonivelante 3 mm', 'Escolher serviço do catálogo sem custo cadastrado: a margem fica em branco.', 65)
) AS v(chave, rotulo, o, p, e, x, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo a WHERE a.chave = v.chave);
