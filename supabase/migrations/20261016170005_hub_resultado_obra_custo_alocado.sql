-- FC Pisos · Virada 01/11 · Resultado por obra com CUSTO ALOCADO (pedido do Diego, ctx 9f84074b).
-- Hoje a v_obra_resultado só enxerga material (CMV) e viagens. Esta entrega cria o lançamento de custo por obra
-- (mão de obra, compra, outro) e o soma na margem realizada. Tabela NOVA (RLS por empresa, REVOKE anon, sem DELETE:
-- estorno por exclusão lógica, escrita só pela função) + função nova + colunas NOVAS no fim da view (as antigas ficam
-- na mesma ordem e tipo; só a margem passa a descontar o custo alocado).
CREATE TABLE IF NOT EXISTS public.projetos_obra_custo (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  obra_id      uuid NOT NULL REFERENCES public.projetos_obras(id),
  tipo         text NOT NULL CHECK (tipo IN ('mao_de_obra','compra','outro')),
  descricao    text NOT NULL CHECK (length(btrim(descricao)) > 0),
  valor        numeric(15,2) NOT NULL CHECK (valor > 0),
  competencia  date NOT NULL DEFAULT current_date,
  criado_por   uuid,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  excluido_em  timestamptz
);
COMMENT ON TABLE public.projetos_obra_custo IS 'Custo alocado à obra (mão de obra, compra, outro). Alimenta v_obra_resultado. Escrita só por fn_obra_custo_lancar / fn_obra_custo_estornar.';
CREATE INDEX IF NOT EXISTS projetos_obra_custo_obra_idx ON public.projetos_obra_custo (obra_id) WHERE excluido_em IS NULL;

ALTER TABLE public.projetos_obra_custo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.projetos_obra_custo FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS projetos_obra_custo_empresa ON public.projetos_obra_custo;
CREATE POLICY projetos_obra_custo_empresa ON public.projetos_obra_custo FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
GRANT SELECT ON public.projetos_obra_custo TO authenticated;
GRANT ALL ON public.projetos_obra_custo TO service_role;

CREATE OR REPLACE FUNCTION public.fn_obra_custo_lancar(p_obra_id uuid, p_tipo text, p_descricao text, p_valor numeric, p_competencia date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_emp uuid; v_id uuid;
BEGIN
  SELECT company_id INTO v_emp FROM projetos_obras WHERE id = p_obra_id;
  IF v_emp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'obra não encontrada'); END IF;
  PERFORM public.fn__guarda_empresa(v_emp);
  IF p_tipo IS NULL OR p_tipo NOT IN ('mao_de_obra','compra','outro') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'tipo inválido (mao_de_obra, compra ou outro)'); END IF;
  IF COALESCE(p_valor, 0) <= 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'valor deve ser maior que zero'); END IF;
  IF p_descricao IS NULL OR btrim(p_descricao) = '' THEN RETURN jsonb_build_object('ok', false, 'erro', 'descreva o custo'); END IF;
  INSERT INTO projetos_obra_custo (company_id, obra_id, tipo, descricao, valor, competencia, criado_por)
  VALUES (v_emp, p_obra_id, p_tipo, btrim(p_descricao), round(p_valor, 2), COALESCE(p_competencia, current_date), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $function$;

CREATE OR REPLACE FUNCTION public.fn_obra_custo_estornar(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_emp uuid;
BEGIN
  SELECT company_id INTO v_emp FROM projetos_obra_custo WHERE id = p_id AND excluido_em IS NULL;
  IF v_emp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'lançamento não encontrado'); END IF;
  PERFORM public.fn__guarda_empresa(v_emp);
  UPDATE projetos_obra_custo SET excluido_em = now() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_obra_custo_lancar(uuid, text, text, numeric, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_custo_estornar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_custo_lancar(uuid, text, text, numeric, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_custo_estornar(uuid) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_obra_resultado
WITH (security_invoker = true) AS
SELECT
  o.id AS obra_id,
  o.company_id,
  o.numero,
  o.nome,
  o.status,
  COALESCE(prev.custo_previsto, 0)::numeric(15,2)  AS custo_previsto,
  COALESCE(prev.valor_contratado, 0)::numeric(15,2) AS receita_prevista,
  COALESCE(med.valor, 0)::numeric(15,2)            AS receita_servico,
  COALESCE(ped.receita, 0)::numeric(15,2)          AS receita_material,
  COALESCE(ped.cmv, 0)::numeric(15,2)              AS custo_material,
  COALESCE(via.valor, 0)::numeric(15,2)            AS custo_viagens,
  (COALESCE(med.valor,0) + COALESCE(ped.receita,0)
   - COALESCE(ped.cmv,0) - COALESCE(via.valor,0)
   - COALESCE(cus.mao_de_obra,0) - COALESCE(cus.compra,0) - COALESCE(cus.outro,0))::numeric(15,2) AS margem_realizada,
  COALESCE(cus.mao_de_obra, 0)::numeric(15,2)      AS custo_mao_obra,
  COALESCE(cus.compra, 0)::numeric(15,2)           AS custo_compras,
  COALESCE(cus.outro, 0)::numeric(15,2)            AS custo_outros
FROM public.projetos_obras o
LEFT JOIN (
  SELECT obra_id,
         SUM(quantidade_contratada * COALESCE(custo_unitario_previsto,0)) AS custo_previsto,
         SUM(valor_contratado) AS valor_contratado
  FROM public.projetos_obra_item WHERE excluido_em IS NULL GROUP BY obra_id
) prev ON prev.obra_id = o.id
LEFT JOIN (
  SELECT obra_id, SUM(valor) AS valor FROM public.erp_nfse_obra_medicao
  WHERE estornada_em IS NULL AND descartada_em IS NULL GROUP BY obra_id
) med ON med.obra_id = o.id
LEFT JOIN (
  SELECT obra_id, SUM(total) AS receita, SUM(COALESCE(cmv,0)) AS cmv
  FROM public.erp_pedidos WHERE obra_id IS NOT NULL
    AND COALESCE(status,'') NOT IN ('cancelado','cancelada') GROUP BY obra_id
) ped ON ped.obra_id = o.id
LEFT JOIN (
  SELECT obra_id, SUM(valor) AS valor FROM public.erp_viagem_lancamento
  WHERE obra_id IS NOT NULL AND excluido_em IS NULL GROUP BY obra_id
) via ON via.obra_id = o.id
LEFT JOIN (
  SELECT obra_id,
         SUM(valor) FILTER (WHERE tipo = 'mao_de_obra') AS mao_de_obra,
         SUM(valor) FILTER (WHERE tipo = 'compra') AS compra,
         SUM(valor) FILTER (WHERE tipo = 'outro') AS outro
  FROM public.projetos_obra_custo WHERE excluido_em IS NULL GROUP BY obra_id
) cus ON cus.obra_id = o.id;

REVOKE ALL ON public.v_obra_resultado FROM anon, PUBLIC;
GRANT SELECT ON public.v_obra_resultado TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.resultado_obra.custo_mao_obra', 'Resultado por obra', 'Mão de obra', 'Nada a preencher: soma o que foi lançado como mão de obra nesta obra.', 'Mostra quanto da equipe já pesou no custo e desconta da margem.', 'Equipe de piso, 12 dias: R$ 8.400.', 'Achar que entra sozinho: o lançamento é feito na obra.', 22, '/dashboard/projetos/obras/resultado'),
 ('projetos.resultado_obra.custo_compras', 'Resultado por obra', 'Compras', 'Nada a preencher: soma as compras lançadas para esta obra.', 'Mostra o que foi comprado direto para a obra e desconta da margem.', 'Argamassa e rejunte: R$ 3.200.', 'Lançar também no material: conta duas vezes.', 23, '/dashboard/projetos/obras/resultado'),
 ('projetos.resultado_obra.custo_outros', 'Resultado por obra', 'Outros custos', 'Nada a preencher: soma os demais custos lançados na obra.', 'Completa o custo da obra para a margem ficar verdadeira.', 'Aluguel de equipamento: R$ 900.', 'Lançar viagem aqui: viagem tem coluna própria.', 24, '/dashboard/projetos/obras/resultado')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
