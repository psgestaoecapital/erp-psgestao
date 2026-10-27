-- FC Pisos · Virada 01/11 · integração estoque × obra, passo 2 (decisão CEO 06/10, ctx 9f84074b):
-- ao APROVAR o orçamento (obra criada), RESERVA o material no estoque da empresa de produto do grupo e avisa se faltar.
-- Aditiva: tabela nova (RLS por empresa, REVOKE anon, sem DELETE, escrita só pela função) + funções novas.
-- Não altera fn_obra_criar_de_orcamento nem nenhum objeto existente; a tela chama fn_obra_reservar_material após criar a obra.
-- Material de cada item da obra = BOM do serviço (tipo insumo) × quantidade contratada × (1 + perda%), via hub_insumo_produto.

CREATE TABLE IF NOT EXISTS public.obra_reserva_material (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,   -- empresa de serviço (dona da obra)
  obra_id            uuid NOT NULL REFERENCES public.projetos_obras(id) ON DELETE CASCADE,
  produto_id         uuid NOT NULL REFERENCES public.erp_produtos(id),
  produto_company_id uuid NOT NULL,                                                      -- empresa de produto (dona do estoque)
  quantidade         numeric NOT NULL CHECK (quantidade > 0),
  situacao           text NOT NULL DEFAULT 'reservado' CHECK (situacao IN ('reservado','cancelado','baixado')),
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.obra_reserva_material IS
  'Reserva de material da obra no estoque da empresa de produto do grupo (escrita só por fn_obra_reservar_material).';
CREATE UNIQUE INDEX IF NOT EXISTS obra_reserva_material_uk ON public.obra_reserva_material (obra_id, produto_id) WHERE situacao = 'reservado';
CREATE INDEX IF NOT EXISTS obra_reserva_material_prod_idx ON public.obra_reserva_material (produto_id) WHERE situacao = 'reservado';

ALTER TABLE public.obra_reserva_material ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.obra_reserva_material FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS obra_reserva_material_empresa ON public.obra_reserva_material;
CREATE POLICY obra_reserva_material_empresa ON public.obra_reserva_material FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
GRANT SELECT ON public.obra_reserva_material TO authenticated;
GRANT ALL ON public.obra_reserva_material TO service_role;

-- Reserva (idempotente: refaz a reserva em aberto da obra) e devolve o aviso de falta por produto.
CREATE OR REPLACE FUNCTION public.fn_obra_reservar_material(p_obra_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_obra projetos_obras%ROWTYPE; r record; v_falta jsonb := '[]'::jsonb; v_sem_vinculo int := 0; v_n int := 0; v_disp numeric;
BEGIN
  SELECT * INTO v_obra FROM projetos_obras WHERE id = p_obra_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'obra não encontrada'); END IF;
  PERFORM public.fn__guarda_empresa(v_obra.company_id);

  UPDATE obra_reserva_material SET situacao = 'cancelado', updated_at = now()
   WHERE obra_id = p_obra_id AND situacao = 'reservado';

  SELECT count(*) INTO v_sem_vinculo
    FROM projetos_obra_item oi
    JOIN projetos_servicos_bom b ON b.servico_id = oi.servico_id AND b.tipo = 'insumo'
    LEFT JOIN hub_insumo_produto hp ON hp.insumo_id = b.insumo_id AND hp.ativo
   WHERE oi.obra_id = p_obra_id AND oi.excluido_em IS NULL AND hp.id IS NULL;

  FOR r IN
    SELECT hp.produto_id, p.company_id AS produto_company_id, p.nome, p.estoque_atual,
           SUM(oi.quantidade_contratada * b.quantidade * (1 + COALESCE(b.perda_pct, 0) / 100.0)) AS qtd
      FROM projetos_obra_item oi
      JOIN projetos_servicos_bom b ON b.servico_id = oi.servico_id AND b.tipo = 'insumo'
      JOIN hub_insumo_produto hp ON hp.insumo_id = b.insumo_id AND hp.ativo
      JOIN erp_produtos p ON p.id = hp.produto_id
     WHERE oi.obra_id = p_obra_id AND oi.excluido_em IS NULL
     GROUP BY hp.produto_id, p.company_id, p.nome, p.estoque_atual
    HAVING SUM(oi.quantidade_contratada * b.quantidade * (1 + COALESCE(b.perda_pct, 0) / 100.0)) > 0
  LOOP
    PERFORM public.fn__guarda_empresa(r.produto_company_id);
    -- disponível = saldo − reservas de OUTRAS obras em aberto
    SELECT COALESCE(r.estoque_atual, 0) - COALESCE(SUM(quantidade), 0) INTO v_disp
      FROM obra_reserva_material
     WHERE produto_id = r.produto_id AND situacao = 'reservado' AND obra_id <> p_obra_id;
    INSERT INTO obra_reserva_material (company_id, obra_id, produto_id, produto_company_id, quantidade, created_by)
    VALUES (v_obra.company_id, p_obra_id, r.produto_id, r.produto_company_id, round(r.qtd, 4), auth.uid());
    v_n := v_n + 1;
    IF r.qtd > v_disp THEN
      v_falta := v_falta || jsonb_build_object('produto_id', r.produto_id, 'produto', r.nome,
        'necessario', round(r.qtd, 4), 'disponivel', GREATEST(v_disp, 0), 'falta', round(r.qtd - GREATEST(v_disp, 0), 4));
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'produtos_reservados', v_n, 'insumos_sem_vinculo', v_sem_vinculo, 'falta', v_falta);
END $function$;

-- Libera a reserva da obra (obra cancelada/encerrada).
CREATE OR REPLACE FUNCTION public.fn_obra_cancelar_reserva(p_obra_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_emp uuid; v_n int;
BEGIN
  SELECT company_id INTO v_emp FROM projetos_obras WHERE id = p_obra_id;
  IF v_emp IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'obra não encontrada'); END IF;
  PERFORM public.fn__guarda_empresa(v_emp);
  UPDATE obra_reserva_material SET situacao = 'cancelado', updated_at = now()
   WHERE obra_id = p_obra_id AND situacao = 'reservado';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'canceladas', v_n);
END $function$;

REVOKE ALL ON FUNCTION public.fn_obra_reservar_material(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_obra_cancelar_reserva(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obra_reservar_material(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_obra_cancelar_reserva(uuid) TO authenticated, service_role;
