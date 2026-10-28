-- Hub · Simulador (/dashboard/projetos/simulador) — fechamento até 95 (PDCA 27/10, nota 22).
-- RD-98 p2/p4: salvar simulação, listar as salvas e excluir de forma rastreável. RD-95: "?" nos blocos novos.
-- 1) projetos_simulacao: foto da simulação (montagem, metragem, totais e quantitativo em jsonb). RLS por empresa
--    (só SELECT direto; escrita só pelas RPCs). Soft-delete: deleted_at/deleted_by/deleted_motivo — nunca DELETE físico.
-- 2) fn_simulacao_salvar / fn_simulacao_listar / fn_simulacao_excluir: SECURITY DEFINER, escopo get_user_company_ids(),
--    audit_log_global em salvar e excluir.
-- 3) system_screens: views/RPCs consumidas (RD-98 p3). 4) Textos de ajuda. Aditiva; nenhum dado de cliente é alterado.
-- Plano de volta: DROP FUNCTION das 3 RPCs; DROP TABLE projetos_simulacao (tabela nova, sem dependentes).
CREATE TABLE IF NOT EXISTS public.projetos_simulacao (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id),
  servico_id     uuid NOT NULL,
  montagem_nome  text NOT NULL,
  unidade        text,
  area           numeric(14,3) NOT NULL CHECK (area > 0),
  total_m2       numeric(14,2),
  total_obra     numeric(14,2),
  nome           text,
  snapshot       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  deleted_by     uuid,
  deleted_motivo text
);
CREATE INDEX IF NOT EXISTS projetos_simulacao_company_idx ON public.projetos_simulacao (company_id, created_at DESC) WHERE deleted_at IS NULL;
ALTER TABLE public.projetos_simulacao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projetos_simulacao_sel ON public.projetos_simulacao;
CREATE POLICY projetos_simulacao_sel ON public.projetos_simulacao FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()));
REVOKE ALL ON public.projetos_simulacao FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.projetos_simulacao FROM authenticated;
GRANT SELECT ON public.projetos_simulacao TO authenticated;
GRANT ALL ON public.projetos_simulacao TO service_role;

CREATE OR REPLACE FUNCTION public.fn_simulacao_salvar(p_company_id uuid, p_servico_id uuid, p_montagem_nome text, p_unidade text,
    p_area numeric, p_total_m2 numeric, p_total_obra numeric, p_nome text, p_snapshot jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  IF p_company_id IS NULL OR p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF COALESCE(p_area, 0) <= 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'metragem_invalida'); END IF;
  IF p_servico_id IS NULL OR NULLIF(btrim(COALESCE(p_montagem_nome, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'montagem_obrigatoria'); END IF;
  INSERT INTO public.projetos_simulacao (company_id, servico_id, montagem_nome, unidade, area, total_m2, total_obra, nome, snapshot, created_by)
  VALUES (p_company_id, p_servico_id, btrim(p_montagem_nome), p_unidade, p_area, p_total_m2, p_total_obra,
          NULLIF(btrim(COALESCE(p_nome, '')), ''), COALESCE(p_snapshot, '{}'::jsonb), auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
  VALUES (p_company_id, auth.uid(), 'projetos_simulacao', v_id::text, 'SIMULACAO_SALVAR',
          jsonb_build_object('montagem', p_montagem_nome, 'area', p_area, 'total_obra', p_total_obra));
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_simulacao_listar(p_company_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', s.id, 'servico_id', s.servico_id, 'montagem_nome', s.montagem_nome,
           'unidade', s.unidade, 'area', s.area, 'total_m2', s.total_m2, 'total_obra', s.total_obra, 'nome', s.nome,
           'created_at', s.created_at) ORDER BY s.created_at DESC), '[]'::jsonb)
    FROM (SELECT * FROM public.projetos_simulacao
           WHERE company_id = p_company_id AND deleted_at IS NULL AND p_company_id IN (SELECT get_user_company_ids())
           ORDER BY created_at DESC LIMIT 50) s;
$function$;

CREATE OR REPLACE FUNCTION public.fn_simulacao_excluir(p_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v public.projetos_simulacao%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'nao_autenticado'); END IF;
  SELECT * INTO v FROM public.projetos_simulacao WHERE id = p_id AND deleted_at IS NULL AND company_id IN (SELECT get_user_company_ids());
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'simulacao_nao_encontrada'); END IF;
  UPDATE public.projetos_simulacao SET deleted_at = now(), deleted_by = auth.uid(), deleted_motivo = NULLIF(btrim(COALESCE(p_motivo, '')), '') WHERE id = p_id;
  INSERT INTO audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_novo)
  VALUES (v.company_id, auth.uid(), 'projetos_simulacao', p_id::text, 'SIMULACAO_EXCLUIR_SOFT',
          jsonb_build_object('montagem', v.montagem_nome, 'area', v.area, 'motivo', p_motivo));
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_simulacao_salvar(uuid, uuid, text, text, numeric, numeric, numeric, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_simulacao_listar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_simulacao_excluir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_simulacao_salvar(uuid, uuid, text, text, numeric, numeric, numeric, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_simulacao_listar(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_simulacao_excluir(uuid, text) TO authenticated, service_role;

UPDATE public.system_screens
   SET rpcs_chamadas = ARRAY['fn_produtividade_por_linha_obter','fn_simular_montagem','fn_simulador_gerar_orcamento','fn_simulacao_salvar','fn_simulacao_listar','fn_simulacao_excluir'],
       views_consumidas = ARRAY['projetos_simulacao','erp_clientes']
 WHERE rota = '/dashboard/projetos/simulador' AND rpcs_chamadas IS NULL;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/projetos/simulador', 'hub_projetos', 'publicado'
FROM (VALUES
 ('projetos.simulador.salvar', 'Simulador', 'Salvar simulação',
  'Escreva um nome curto (opcional) e salve.',
  'Guarda a montagem, a metragem e o total desta simulação para consultar ou comparar depois.',
  '"Gesso acartonado — Casa Silva" com 120 m².',
  'Achar que salvar gera orçamento: a simulação só fica guardada; para orçar use Gerar orçamento.', 20),
 ('projetos.simulador.nome_simulacao', 'Simulador', 'Nome da simulação',
  'Nome curto que identifica o cenário (opcional).',
  'Facilita achar a simulação na lista de salvas.',
  'Cenário A — parede 120 m²',
  'Usar o mesmo nome em cenários diferentes.', 21),
 ('projetos.simulador.salvas', 'Simulador', 'Simulações salvas',
  'Não se preenche: lista das simulações guardadas pela sua empresa.',
  'Reabrir um cenário e comparar valores sem refazer a conta.',
  'Duas simulações da mesma montagem com metragens diferentes.',
  'Esperar que o valor salvo acompanhe mudanças de preço: ele é a foto do dia em que foi salvo.', 22),
 ('projetos.simulador.reabrir', 'Simulador', 'Reabrir simulação',
  'Clique para carregar montagem e metragem salvas.',
  'Recalcula com os preços de hoje a partir do cenário guardado.',
  'Reabrir a simulação do mês passado e ver o novo total.',
  'Comparar o total reaberto com o salvo sem lembrar que os preços mudam.', 23),
 ('projetos.simulador.excluir', 'Simulador', 'Excluir simulação',
  'Confirme a exclusão.',
  'Remove a simulação da lista; ela fica guardada com quem excluiu e quando (soft-delete).',
  'Excluir cenário duplicado.',
  'Excluir para "refazer": basta mudar a metragem e salvar de novo.', 24),
 ('projetos.simulador.quantitativo', 'Simulador', 'Quantitativo de materiais',
  'Não se preenche: lista de insumos da composição da montagem multiplicada pela metragem.',
  'Mostra o que comprar e quanto custa cada insumo.',
  'Placa 12,5 mm: 0,33 un/m² × 120 m² = 39,6 un.',
  'Ignorar perdas: o quantitativo já considera a composição cadastrada.', 25),
 ('projetos.simulador.quantitativo_total', 'Simulador', 'Total do quantitativo',
  'Não se preenche: soma do custo dos insumos.',
  'Compara com o preço de venda para ver a margem.',
  'R$ 4.300,00 de custo de material.',
  'Confundir custo de material com preço de venda.', 26)
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
