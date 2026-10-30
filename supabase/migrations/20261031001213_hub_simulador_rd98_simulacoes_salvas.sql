-- Hub · Simulador de Obra (/dashboard/projetos/simulador) — RD-98: Salvar simulação, listar salvas e Excluir rastreável.
-- ADITIVA: 1 tabela nova (erp_hub_simulacao, RLS por empresa, leitura só da própria empresa, escrita SÓ pelas RPCs),
-- 2 RPCs novas. O resultado é recalculado no servidor por fn_simular_montagem (o cliente não escolhe o valor salvo).
-- Excluir = soft-delete (excluido_em/excluido_por/motivo) + audit_log_global; nenhum DELETE físico.

CREATE TABLE IF NOT EXISTS public.erp_hub_simulacao (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  servico_id       uuid NOT NULL,
  nome             text NOT NULL CHECK (length(btrim(nome)) > 0),
  montagem         text,
  unidade          text,
  area             numeric NOT NULL CHECK (area > 0),
  total_obra       numeric,
  total_m2         numeric,
  margem_pct       numeric,
  resultado        jsonb NOT NULL DEFAULT '{}'::jsonb,
  cliente_id       uuid,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  criado_por       uuid DEFAULT auth.uid(),
  excluido_em      timestamptz,
  excluido_por     uuid,
  motivo_exclusao  text
);
CREATE INDEX IF NOT EXISTS ix_hub_simulacao_empresa
  ON public.erp_hub_simulacao (company_id, criado_em DESC) WHERE excluido_em IS NULL;

ALTER TABLE public.erp_hub_simulacao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hub_simulacao_sel ON public.erp_hub_simulacao;
CREATE POLICY hub_simulacao_sel ON public.erp_hub_simulacao FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()));
REVOKE ALL ON public.erp_hub_simulacao FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.erp_hub_simulacao FROM authenticated;
GRANT SELECT ON public.erp_hub_simulacao TO authenticated;
GRANT ALL ON public.erp_hub_simulacao TO service_role;

CREATE OR REPLACE FUNCTION public.fn_simulador_salvar(
  p_company_id uuid, p_servico_id uuid, p_business_line_id uuid, p_area numeric, p_nome text, p_cliente_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r jsonb; v_id uuid;
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF p_area IS NULL OR p_area <= 0 THEN RAISE EXCEPTION 'Informe uma metragem maior que zero.'; END IF;
  IF length(btrim(coalesce(p_nome, ''))) < 2 THEN RAISE EXCEPTION 'Dê um nome para a simulação.'; END IF;
  r := public.fn_simular_montagem(p_servico_id, p_company_id, p_business_line_id, p_area);
  IF coalesce((r->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Não foi possível simular esta montagem (%).', coalesce(r->>'erro', 'sem detalhe');
  END IF;
  INSERT INTO public.erp_hub_simulacao (company_id, servico_id, nome, montagem, unidade, area, total_obra, total_m2, margem_pct, resultado, cliente_id)
  VALUES (p_company_id, p_servico_id, btrim(p_nome), r->>'montagem', r->>'unidade', p_area,
          nullif(r->>'total_obra', '')::numeric, nullif(r#>>'{preco_m2,total_m2}', '')::numeric, nullif(r#>>'{preco_m2,margem_pct}', '')::numeric,
          r, p_cliente_id)
  RETURNING id INTO v_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (p_company_id, auth.uid(), 'erp_hub_simulacao', v_id::text, 'criar', NULL,
            jsonb_build_object('nome', btrim(p_nome), 'area', p_area, 'total_obra', r->'total_obra'));
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_simulador_excluir(p_id uuid, p_motivo text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s public.erp_hub_simulacao%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.erp_hub_simulacao WHERE id = p_id AND excluido_em IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Simulação não encontrada.'; END IF;
  PERFORM public.fn__guarda_empresa(s.company_id);
  IF length(btrim(coalesce(p_motivo, ''))) < 3 THEN RAISE EXCEPTION 'Informe o motivo da exclusão.'; END IF;
  UPDATE public.erp_hub_simulacao SET excluido_em = now(), excluido_por = auth.uid(), motivo_exclusao = btrim(p_motivo) WHERE id = p_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (s.company_id, auth.uid(), 'erp_hub_simulacao', p_id::text, 'excluir',
            jsonb_build_object('nome', s.nome, 'area', s.area, 'total_obra', s.total_obra),
            jsonb_build_object('motivo', btrim(p_motivo)));
  RETURN jsonb_build_object('ok', true);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_simulador_salvar(uuid, uuid, uuid, numeric, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_simulador_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_simulador_salvar(uuid, uuid, uuid, numeric, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_simulador_excluir(uuid, text) TO authenticated, service_role;

UPDATE public.system_screens
   SET views_consumidas = ARRAY['projetos_servicos', 'erp_clientes', 'erp_hub_simulacao'],
       rpcs_chamadas = ARRAY['fn_produtividade_por_linha_obter', 'fn_simular_montagem', 'fn_simulador_gerar_orcamento', 'fn_simulador_salvar', 'fn_simulador_excluir']
 WHERE rota = '/dashboard/projetos/simulador';

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT * FROM (VALUES
  ('projetos.simulador.quantitativo', '/dashboard/projetos/simulador', 'Resultado', 'Quantitativo de materiais',
   'Lista de insumos da montagem escolhida, já multiplicada pela metragem informada.', 'Mostra quanto comprar de cada material e quanto isso custa.', '100 m² de piso: 106 m² de porcelanato', 'Esperar insumo que não está na composição da montagem: complete a composição no Catálogo.', 'hub', 980, 1, 'publicado'),
  ('projetos.simulador.nome_simulacao', '/dashboard/projetos/simulador', 'Salvar', 'Nome da simulação',
   'Um nome curto para reencontrar esta simulação depois.', 'Guarda o cenário (montagem, metragem e valores) para comparar ou consultar depois.', 'Piso galpão — 450 m²', 'Deixar em branco: a simulação não é salva.', 'hub', 981, 1, 'publicado'),
  ('projetos.simulador.salvar', '/dashboard/projetos/simulador', 'Salvar', 'Salvar simulação',
   'Grava o resultado atual com o nome informado. O valor é recalculado no servidor na hora de salvar.', 'Cria um histórico de cenários sem gerar orçamento.', 'Salvar “Piso galpão — 450 m²”', 'Achar que salvar gera orçamento: para isso use Gerar orçamento.', 'hub', 982, 1, 'publicado'),
  ('projetos.simulador.salvas', '/dashboard/projetos/simulador', 'Salvas', 'Simulações salvas',
   'Lista dos cenários que a empresa já salvou, com metragem, total e margem.', 'Consultar e comparar simulações anteriores; abrir uma recarrega a montagem e a metragem.', 'Piso galpão — R$ 52.300', 'Procurar simulação excluída: ela sai da lista (fica só na auditoria).', 'hub', 983, 1, 'publicado'),
  ('projetos.simulador.excluir', '/dashboard/projetos/simulador', 'Salvas', 'Excluir simulação',
   'Tira a simulação da lista informando o motivo. Não apaga: guarda quem excluiu, quando e por quê.', 'Limpa cenários errados sem perder o histórico.', 'Metragem digitada errada', 'Deixar o motivo em branco: a exclusão não é aceita.', 'hub', 984, 1, 'publicado'),
  ('projetos.simulador.motivo_exclusao', '/dashboard/projetos/simulador', 'Salvas', 'Motivo da exclusão',
   'Por que a simulação está sendo excluída (mínimo 3 letras).', 'Fica na auditoria da simulação.', 'duplicada', 'Deixar em branco: a exclusão não é aceita.', 'hub', 985, 1, 'publicado')
) AS t(chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = t.chave);
