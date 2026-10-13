-- 🚨 Segurança (CEO 01/10 · "corrija JÁ, em PR própria"): fn_inventario_registrar_contagem roda como dono (SECURITY
-- DEFINER, pula a RLS) e gravava a quantidade contada em QUALQUER item de inventário pelo id — um cliente logado podia
-- alterar a contagem (e, no fechamento, o ajuste de estoque) de outra empresa. Achada na PR #1951 (planilha de contagem).
-- Correção: antes de gravar, o item tem de ser de uma empresa do usuário (mesma guarda das PR A2/A2b:
-- sem usuário = serviço/cron passa; is_admin passa). Inventário FECHADO também não aceita contagem (o ajuste já foi
-- gerado — mudar a contagem depois deixaria o inventário dizendo uma coisa e o estoque outra). "contado_por" passa a
-- vir da sessão (antes vinha do parâmetro: dava para assinar a contagem em nome de outro). Resto do corpo igual
-- (20260608120000): diferenca é GENERATED; valor_diferenca e totais recalculados.

CREATE OR REPLACE FUNCTION public.fn_inventario_registrar_contagem(
  p_item_id uuid,
  p_quantidade_contada numeric,
  p_usuario character varying DEFAULT NULL::character varying
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inv_id uuid;
  v_company uuid;
  v_status text;
BEGIN
  IF p_quantidade_contada IS NULL OR p_quantidade_contada < 0 THEN
    RAISE EXCEPTION 'Quantidade contada invalida: %', p_quantidade_contada;
  END IF;

  SELECT it.inventario_id, it.company_id, inv.status
    INTO v_inv_id, v_company, v_status
    FROM public.erp_inventario_itens it
    JOIN public.erp_inventarios inv ON inv.id = it.inventario_id
   WHERE it.id = p_item_id;

  IF v_inv_id IS NULL THEN
    RAISE EXCEPTION 'Item de inventario nao encontrado: %', p_item_id;
  END IF;

  -- 01/10: o item tem de ser de uma empresa do usuário (sem usuário = serviço/cron passa)
  IF auth.uid() IS NOT NULL AND NOT public.is_admin()
     AND v_company NOT IN (SELECT public.get_user_company_ids()) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  IF v_status = 'fechado' THEN
    RAISE EXCEPTION 'Inventario fechado: a contagem nao pode mais ser alterada' USING ERRCODE = '22023';
  END IF;

  -- 1) Atualiza apenas colunas mutaveis · diferenca e GENERATED (auto)
  UPDATE public.erp_inventario_itens
     SET quantidade_contada = p_quantidade_contada,
         contado_em = now(),
         -- autoria vem da sessão (nunca do parâmetro do cliente); sem sessão = serviço/cron usa o que veio
         contado_por = CASE WHEN auth.uid() IS NULL THEN p_usuario ELSE public.fn_user_email_atual() END
   WHERE id = p_item_id;

  -- 2) Recalcula valor_diferenca explicit (trigger BEFORE ve generated stale)
  UPDATE public.erp_inventario_itens
     SET valor_diferenca = COALESCE(diferenca, 0) * COALESCE(custo_unitario, 0)
   WHERE id = p_item_id;

  -- 3) Recalcula totais do pai (so conta itens com quantidade_contada IS NOT NULL)
  UPDATE public.erp_inventarios i
     SET total_contados     = sub.total_contados,
         total_divergencias = sub.total_divergencias,
         valor_divergencia  = sub.valor_divergencia,
         updated_at         = now()
    FROM (
      SELECT inventario_id,
             COUNT(*) FILTER (WHERE quantidade_contada IS NOT NULL)::int AS total_contados,
             COUNT(*) FILTER (WHERE quantidade_contada IS NOT NULL AND COALESCE(diferenca,0) <> 0)::int AS total_divergencias,
             COALESCE(SUM(valor_diferenca) FILTER (WHERE quantidade_contada IS NOT NULL), 0) AS valor_divergencia
        FROM public.erp_inventario_itens
       WHERE inventario_id = v_inv_id
       GROUP BY inventario_id
    ) sub
   WHERE i.id = v_inv_id;
END $function$;

REVOKE ALL ON FUNCTION public.fn_inventario_registrar_contagem(uuid, numeric, character varying) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_inventario_registrar_contagem(uuid, numeric, character varying) TO authenticated, service_role;
