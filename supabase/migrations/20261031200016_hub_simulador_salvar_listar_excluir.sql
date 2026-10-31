-- Hub · Simulador (/dashboard/projetos/simulador) — Salvar simulação, listar salvas e Excluir rastreável.
-- Motivo (auditor, nota 22): a tela só calculava e gerava orçamento; faltava persistência/CRUD (RD-98 p2/p4),
-- "?" no resultado e origem do dado em system_screens (RD-98 p3).
-- ADITIVA: 1 tabela nova (RLS por empresa, só leitura direta, REVOKE anon) + 3 funções novas + "?" novos + metadados.
-- Nada de cliente é alterado. Excluir = soft-delete (deleted_at/deleted_by/motivo + audit_log_global); nunca DELETE físico.
-- Reversão: DROP FUNCTION fn_simulacao_salvar/listar/excluir; DROP TABLE projetos_simulacoes; DELETE das chaves projetos.simulador.*.
CREATE TABLE IF NOT EXISTS public.projetos_simulacoes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  servico_id       uuid NOT NULL,
  business_line_id uuid,
  montagem         text NOT NULL,
  unidade          text NOT NULL DEFAULT 'm²',
  area             numeric NOT NULL CHECK (area > 0),
  total_m2         numeric NOT NULL DEFAULT 0,
  total_obra       numeric NOT NULL DEFAULT 0,
  margem_pct       numeric,
  preco_m2         jsonb NOT NULL DEFAULT '{}'::jsonb,
  quantitativo     jsonb NOT NULL DEFAULT '[]'::jsonb,
  cliente_id       uuid,
  titulo           text,
  criado_por       uuid DEFAULT auth.uid(),
  criado_em        timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  deleted_by       uuid,
  delete_motivo    text
);
CREATE INDEX IF NOT EXISTS projetos_simulacoes_ativas_idx ON public.projetos_simulacoes (company_id, criado_em DESC) WHERE deleted_at IS NULL;

ALTER TABLE public.projetos_simulacoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.projetos_simulacoes FROM PUBLIC, anon;
DROP POLICY IF EXISTS projetos_simulacoes_ler ON public.projetos_simulacoes;
CREATE POLICY projetos_simulacoes_ler ON public.projetos_simulacoes FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT ON public.projetos_simulacoes TO authenticated;

-- Salvar: refaz a simulação no servidor (não confia em valor vindo da tela) e grava o retrato (preço + quantitativo).
CREATE OR REPLACE FUNCTION public.fn_simulacao_salvar(
  p_servico_id uuid, p_company_id uuid, p_business_line_id uuid, p_area numeric,
  p_cliente_id uuid DEFAULT NULL, p_titulo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_sim jsonb; v_id uuid; v_total_m2 numeric; v_total numeric;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_login'); END IF;
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF COALESCE(p_area, 0) <= 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'metragem_invalida'); END IF;
  IF p_cliente_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM erp_clientes WHERE id = p_cliente_id AND company_id = p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'cliente_invalido'); END IF;
  v_sim := fn_simular_montagem(p_servico_id, p_company_id, p_business_line_id, p_area);
  IF NOT COALESCE((v_sim->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'erro', COALESCE(v_sim->>'erro', 'falha_simulacao')); END IF;
  v_total_m2 := COALESCE((v_sim->'preco_m2'->>'total_m2')::numeric, 0);
  v_total    := COALESCE((v_sim->>'total_obra')::numeric, round(p_area * v_total_m2, 2));
  INSERT INTO projetos_simulacoes (company_id, servico_id, business_line_id, montagem, unidade, area, total_m2, total_obra,
    margem_pct, preco_m2, quantitativo, cliente_id, titulo, criado_por)
  VALUES (p_company_id, p_servico_id, p_business_line_id, COALESCE(v_sim->>'montagem', 'Montagem'),
    COALESCE(NULLIF(v_sim->>'unidade', ''), 'm²'), p_area, v_total_m2, v_total,
    NULLIF(v_sim->'preco_m2'->>'margem_pct', '')::numeric, COALESCE(v_sim->'preco_m2', '{}'::jsonb),
    COALESCE(v_sim->'quantitativo', '[]'::jsonb), p_cliente_id, NULLIF(btrim(p_titulo), ''), auth.uid())
  RETURNING id INTO v_id;
  BEGIN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (p_company_id, auth.uid(), (SELECT email FROM users WHERE id = auth.uid()), 'projetos_simulacoes', v_id::text, 'CRIOU', NULL,
            jsonb_build_object('montagem', v_sim->>'montagem', 'area', p_area, 'total_obra', v_total));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'total_obra', v_total);
END $$;

CREATE OR REPLACE FUNCTION public.fn_simulacao_listar(p_company_id uuid, p_limite int DEFAULT 50)
RETURNS TABLE(id uuid, servico_id uuid, business_line_id uuid, montagem text, unidade text, area numeric, total_m2 numeric,
              total_obra numeric, margem_pct numeric, cliente_nome text, titulo text, criado_em timestamptz, criado_por_nome text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT s.id, s.servico_id, s.business_line_id, s.montagem, s.unidade, s.area, s.total_m2, s.total_obra, s.margem_pct,
         COALESCE(c.nome_fantasia, c.razao_social), s.titulo, s.criado_em,
         (SELECT COALESCE(u.raw_user_meta_data->>'full_name', u.email) FROM auth.users u WHERE u.id = s.criado_por)
    FROM public.projetos_simulacoes s
    LEFT JOIN public.erp_clientes c ON c.id = s.cliente_id AND c.company_id = s.company_id
   WHERE s.company_id = p_company_id AND s.company_id IN (SELECT get_user_company_ids())
     AND s.deleted_at IS NULL
   ORDER BY s.criado_em DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limite, 50), 1), 200);
$$;

CREATE OR REPLACE FUNCTION public.fn_simulacao_excluir(p_id uuid, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_s public.projetos_simulacoes%ROWTYPE; v_motivo text := NULLIF(btrim(p_motivo), '');
BEGIN
  SELECT * INTO v_s FROM public.projetos_simulacoes WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Simulação não encontrada'); END IF;
  IF NOT (v_s.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF v_motivo IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe o motivo da exclusão.'); END IF;
  UPDATE public.projetos_simulacoes SET deleted_at = now(), deleted_by = auth.uid(), delete_motivo = v_motivo WHERE id = p_id;
  BEGIN
    INSERT INTO audit_log_global (company_id, user_id, user_email, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_s.company_id, auth.uid(), (SELECT email FROM users WHERE id = auth.uid()), 'projetos_simulacoes', v_s.id::text, 'EXCLUIU',
            jsonb_build_object('montagem', v_s.montagem, 'area', v_s.area, 'total_obra', v_s.total_obra),
            jsonb_build_object('acao', 'soft_delete', 'motivo', v_motivo));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.fn_simulacao_salvar(uuid, uuid, uuid, numeric, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_simulacao_listar(uuid, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_simulacao_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_simulacao_salvar(uuid, uuid, uuid, numeric, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_simulacao_listar(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_simulacao_excluir(uuid, text) TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Simulador', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/simulador', 'projetos', 'publicado'
FROM (VALUES
 ('projetos.simulador.quantitativo', 'Quantitativo de materiais', 'Não se preenche: lista cada insumo da montagem com a quantidade por unidade, a quantidade total para a metragem e o custo.', 'Mostra o que comprar e quanto custa antes de orçar.', 'Porcelanato 100 m² × 1,05 = 105 m² de material (já com a perda).', 'Esquecer a perda: a quantidade total já a considera, não some de novo.', 70),
 ('projetos.simulador.salvar', 'Salvar simulação', 'Clique para guardar esta simulação (montagem, metragem, preço e quantitativo) na lista de salvas. Título é opcional.', 'Permite voltar depois, comparar cenários e abrir de novo sem digitar tudo.', 'Título "Salão 100 m² — opção premium".', 'Achar que salvar gera orçamento: salvar só guarda a simulação; o orçamento é o botão ao lado.', 80),
 ('projetos.simulador.titulo', 'Título da simulação', 'Opcional. Nome curto para reconhecer a simulação na lista de salvas.', 'Diferencia cenários da mesma montagem.', 'Cenário A — piso 60x60', 'Repetir o mesmo título em tudo: a lista fica difícil de ler.', 85),
 ('projetos.simulador.salvas', 'Simulações salvas', 'Não se preenche: lista das simulações guardadas da empresa, da mais nova para a mais antiga. Toque em Abrir para recalcular.', 'Reaproveita simulações e mostra quem simulou e quando.', '12/10 · Drywall 80 m² · R$ 9.840,00.', 'Esperar que o valor da lista mude sozinho: ao abrir, o preço é recalculado com a tabela de hoje.', 90),
 ('projetos.simulador.abrir_salva', 'Abrir simulação salva', 'Toque para carregar a montagem e a metragem salvas e recalcular com o preço de hoje.', 'Retoma a conta de onde parou.', 'Abrir "Salão 100 m²" e ver o total atualizado.', 'Estranhar o valor diferente do salvo: o preço do catálogo pode ter mudado desde então.', 91),
 ('projetos.simulador.excluir_salva', 'Excluir simulação', 'Toque, informe o motivo e confirme. A simulação sai da lista, mas o registro é guardado (quem excluiu, quando e por quê).', 'Limpa simulações antigas sem perder o rastro de auditoria.', 'Motivo: "Cenário descartado pelo cliente".', 'Deixar o motivo em branco: ele é obrigatório.', 92)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;

-- RD-98 p3 (origem do dado): o que a tela realmente consome (grep de src/app/dashboard/projetos/simulador/page.tsx).
UPDATE public.system_screens
   SET views_consumidas = ARRAY['projetos_simulacoes','erp_clientes']::text[],
       rpcs_chamadas = ARRAY['fn_produtividade_por_linha_obter','fn_simular_montagem','fn_simulador_gerar_orcamento',
                             'fn_simulacao_salvar','fn_simulacao_listar','fn_simulacao_excluir']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/simulador';
