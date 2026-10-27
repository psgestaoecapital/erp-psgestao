-- Hub · /dashboard/projetos/simulador — nota 22 → 95 (aud8 27/10, caixa 875dce9c · Code: dev7claudeps)
--   Causa-raiz do "resultado não aparece": a empresa DEMO Construtora não tinha erp_precificacao_config, então
--   fn_simular_montagem devolvia 'sem_config_precificacao' para toda montagem (provado no banco, RD-38). Semente da config DEMO.
--   RD-98 p2/p4: Salvar simulação + lista de simulações salvas + Excluir rastreável (soft-delete: deleted_at + autor + motivo + audit_log_global).
--   RD-98 p3: system_screens.views_consumidas/rpcs_chamadas.   RD-95: "?" dos campos novos.
-- Aditiva: tabela nova com RLS por empresa (escrita só por RPC), funções novas, semente só da DEMO.

-- 1) Semente da configuração de precificação da DEMO Construtora (idempotente; só empresa DEMO)
INSERT INTO public.erp_precificacao_config (company_id, business_line_id, custo_folha_hora, tempo_m2_min, imposto_mo_pct, margem_mo_pct,
  margem_material_pct, icms_pct, pis_cofins_pct, creditos_pct, comissao_pct, meta_producao_m2, custo_fixo_mensal, custo_fixo_origem, base_custo_fixo, ativo, observacao)
SELECT c.id, NULL, 28, 18, 8, 35, 32, 12, 3.65, 0, 3, 3000, 42000, 'rateio', 'meta', true, 'Semente DEMO Construtora (simulador)'
  FROM public.companies c
 WHERE c.id = 'b0700000-0000-4000-a000-000000000006' AND c.is_demo
   AND NOT EXISTS (SELECT 1 FROM public.erp_precificacao_config p WHERE p.company_id = c.id);

-- 2) Simulações salvas
CREATE TABLE IF NOT EXISTS public.projetos_simulacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  nome text NOT NULL,
  servico_id uuid NOT NULL,
  business_line_id uuid,
  montagem text NOT NULL,
  unidade text,
  area numeric NOT NULL CHECK (area > 0),
  total_obra numeric NOT NULL DEFAULT 0,
  preco_m2 jsonb NOT NULL DEFAULT '{}'::jsonb,
  quantitativo jsonb NOT NULL DEFAULT '[]'::jsonb,
  cliente_id uuid,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_motivo text
);
CREATE INDEX IF NOT EXISTS ix_projetos_simulacoes_empresa ON public.projetos_simulacoes (company_id, created_at DESC) WHERE deleted_at IS NULL;
ALTER TABLE public.projetos_simulacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projetos_simulacoes_select ON public.projetos_simulacoes;
CREATE POLICY projetos_simulacoes_select ON public.projetos_simulacoes FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()));
REVOKE ALL ON public.projetos_simulacoes FROM anon, public;
GRANT SELECT ON public.projetos_simulacoes TO authenticated;

-- Salvar: o servidor recalcula a simulação (não confia em número vindo do navegador).
CREATE OR REPLACE FUNCTION public.fn_simulacao_salvar(p_company_id uuid, p_servico_id uuid, p_business_line_id uuid, p_area numeric, p_nome text DEFAULT NULL, p_cliente_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_sim jsonb; v_id uuid; v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para salvar'); END IF;
  IF p_company_id IS NULL OR p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF COALESCE(p_area, 0) <= 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'metragem_invalida'); END IF;
  v_sim := public.fn_simular_montagem(p_servico_id, p_company_id, p_business_line_id, p_area);
  IF (v_sim->>'ok')::boolean IS NOT TRUE THEN RETURN v_sim; END IF;
  v_nome := COALESCE(NULLIF(btrim(p_nome), ''), (v_sim->>'montagem') || ' · ' || replace(trim(to_char(p_area, 'FM999999990D99')), '.', ',') || ' ' || COALESCE(v_sim->>'unidade', 'm²'));
  INSERT INTO public.projetos_simulacoes (company_id, nome, servico_id, business_line_id, montagem, unidade, area, total_obra, preco_m2, quantitativo, cliente_id, created_by)
  VALUES (p_company_id, v_nome, p_servico_id, p_business_line_id, v_sim->>'montagem', v_sim->>'unidade', p_area,
          COALESCE((v_sim->>'total_obra')::numeric, 0), COALESCE(v_sim->'preco_m2', '{}'::jsonb), COALESCE(v_sim->'quantitativo', '[]'::jsonb), p_cliente_id, auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (p_company_id, auth.uid(), 'projetos_simulacoes', v_id, 'criar', NULL, jsonb_build_object('nome', v_nome, 'area', p_area, 'total_obra', v_sim->'total_obra'));
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'nome', v_nome);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_simulacoes_listar(p_company_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_company_id IS NULL OR p_company_id NOT IN (SELECT public.get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  RETURN jsonb_build_object('ok', true, 'itens', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', s.id, 'nome', s.nome, 'servico_id', s.servico_id, 'business_line_id', s.business_line_id,
             'montagem', s.montagem, 'unidade', s.unidade, 'area', s.area, 'total_obra', s.total_obra, 'cliente_id', s.cliente_id, 'created_at', s.created_at)
           ORDER BY s.created_at DESC)
      FROM (SELECT * FROM public.projetos_simulacoes WHERE company_id = p_company_id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100) s), '[]'::jsonb));
END $function$;

CREATE OR REPLACE FUNCTION public.fn_simulacao_excluir(p_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s public.projetos_simulacoes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para excluir'); END IF;
  SELECT * INTO s FROM public.projetos_simulacoes WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Simulação não encontrada ou já excluída'); END IF;
  IF s.company_id NOT IN (SELECT public.get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE public.projetos_simulacoes SET deleted_at = now(), deleted_by = auth.uid(), delete_motivo = NULLIF(btrim(p_motivo), '') WHERE id = p_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
  VALUES (s.company_id, auth.uid(), 'projetos_simulacoes', p_id, 'excluir', jsonb_build_object('nome', s.nome, 'total_obra', s.total_obra),
          jsonb_build_object('deleted_at', now(), 'motivo', NULLIF(btrim(p_motivo), '')));
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_simulacao_salvar(uuid, uuid, uuid, numeric, text, uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_simulacoes_listar(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.fn_simulacao_excluir(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_simulacao_salvar(uuid, uuid, uuid, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_simulacoes_listar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_simulacao_excluir(uuid, text) TO authenticated;

-- 3) RD-98 p3
UPDATE public.system_screens
   SET views_consumidas = ARRAY['projetos_servicos','projetos_servicos_bom','m16_insumos','erp_precificacao_config','projetos_simulacoes','erp_clientes']::text[],
       rpcs_chamadas = ARRAY['fn_produtividade_por_linha_obter','fn_simular_montagem','fn_simulador_gerar_orcamento','fn_simulacao_salvar','fn_simulacoes_listar','fn_simulacao_excluir']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/simulador';

-- 4) RD-95
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('projetos.simulador.quantitativo', 'Resultado', 'Quantitativo de materiais',
 'Nada a preencher: lista cada insumo da montagem com a quantidade por unidade, a quantidade total para a metragem informada (já com a perda) e o custo.',
 'É a lista de compras da obra. A perda de cada insumo entra na quantidade total, por isso ela é maior que quantidade × metragem.',
 'Resina epóxi: 0,32 kg/m² → 336 kg para 100 m²', 'Comprar só quantidade × metragem e esquecer a perda.', 300, '/dashboard/projetos/simulador', 'projetos', 'publicado'),
('projetos.simulador.camadas', 'Resultado', 'Orçamento em camadas',
 'Nada a preencher: mostra material, mão de obra, comissão e custo fixo somados no preço por unidade, e a margem que sobra.',
 'Mostra de onde vem o preço de venda e quanto sobra de margem, para negociar com segurança.',
 'Total R$ 187,73/m² com margem de 21,96%', 'Dar desconto sem olhar a margem: o custo fixo e a comissão já estão dentro do preço.', 310, '/dashboard/projetos/simulador', 'projetos', 'publicado'),
('projetos.simulador.nome_simulacao', 'Salvar', 'Nome da simulação',
 'Opcional. Dê um nome para achar a simulação depois. Em branco, o nome é montagem + metragem.',
 'Identifica a simulação na lista de salvas.', 'Piso epóxi — galpão do Sr. Carlos', 'Salvar várias com o mesmo nome.', 320, '/dashboard/projetos/simulador', 'projetos', 'publicado'),
('projetos.simulador.salvar', 'Salvar', 'Salvar simulação',
 'Guarda a montagem, a metragem e o resultado calculado agora, para consultar ou comparar depois.',
 'O valor é recalculado no servidor na hora de salvar, com a tabela de preços e o custo dos insumos de hoje.', 'Salvar a simulação de 100 m² de forro', 'Achar que a simulação salva acompanha reajustes futuros: ela guarda os números de quando foi salva.', 330, '/dashboard/projetos/simulador', 'projetos', 'publicado'),
('projetos.simulador.salvas', 'Salvar', 'Simulações salvas',
 'Nada a preencher: lista as simulações já salvas da empresa, da mais nova para a mais antiga.',
 'Permite rever o valor passado ao cliente sem refazer a conta. Excluir pede o motivo e fica registrado.', 'Forro 250 m² — R$ 22.497,50', 'Usar uma simulação antiga como preço atual sem refazer.', 340, '/dashboard/projetos/simulador', 'projetos', 'publicado'),
('projetos.simulador.excluir_motivo', 'Salvar', 'Motivo da exclusão',
 'Escreva em uma frase por que a simulação está sendo excluída.',
 'Fica na trilha de auditoria junto com seu nome e a data.', 'Metragem digitada errada', 'Deixar em branco: depois ninguém lembra o motivo.', 355, '/dashboard/projetos/simulador', 'projetos', 'publicado'),
('projetos.simulador.excluir', 'Salvar', 'Excluir simulação',
 'Pede o motivo e tira a simulação da lista. Fica gravado quem excluiu e quando.',
 'Mantém a lista limpa sem perder o rastro da exclusão.', 'Simulação feita com a metragem errada', 'Excluir uma simulação já usada para gerar orçamento: o orçamento continua existindo.', 350, '/dashboard/projetos/simulador', 'projetos', 'publicado')
ON CONFLICT (chave) DO NOTHING;
