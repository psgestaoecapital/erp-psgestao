-- Orçamentos · o takeoff passa a aplicar BDI (1 preço só).
-- ANTES: fn_takeoff_gerar_orcamento gravava preco_unitario = custo (margem ZERO) — orçamento
-- saía a preço de custo. Erro silencioso (só aparece quando o cliente aceita e a obra dá prejuízo).
-- AGORA: preco_custo = custo_unitario_total; preco_unitario = custo × (1 + BDI/100) — mesmo preço
-- que o editor manual usa (projetos_modulo_config.bdi_total_pct por empresa).
-- Auditado: 0 orçamentos existentes com item de takeoff a custo → nenhuma proposta enviada é afetada.

CREATE OR REPLACE FUNCTION public.fn_takeoff_gerar_orcamento(p_company_id uuid, p_planta_id uuid, p_orcamento_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE v_count int := 0; a record; v_qtd numeric; v_ordem int; v_bdi numeric; v_preco numeric;
BEGIN
  SELECT COALESCE(bdi_total_pct,0) INTO v_bdi FROM projetos_modulo_config WHERE company_id=p_company_id;
  v_bdi := COALESCE(v_bdi,0);

  SELECT COALESCE(max(ordem),0) INTO v_ordem FROM erp_orcamentos_itens WHERE orcamento_id=p_orcamento_id;
  FOR a IN
    SELECT amb.*, s.nome AS s_nome, s.codigo AS s_codigo, s.unidade AS s_unidade, s.custo_unitario_total
    FROM erp_obra_planta_ambiente amb
    JOIN projetos_servicos s ON s.id=amb.servico_id
    WHERE amb.planta_id=p_planta_id AND amb.company_id=p_company_id AND amb.confirmado=true AND amb.servico_id IS NOT NULL
  LOOP
    v_qtd := CASE a.base_calculo
               WHEN 'perimetro' THEN COALESCE(a.perimetro_ml,0)
               WHEN 'pe_direito_parede' THEN COALESCE(a.perimetro_ml,0)*COALESCE(a.pe_direito_m,0)
               ELSE COALESCE(a.area_m2,0) END;
    v_preco := ROUND(COALESCE(a.custo_unitario_total,0) * (1 + v_bdi/100), 2); -- preço de venda com BDI
    v_ordem := v_ordem + 1;
    INSERT INTO erp_orcamentos_itens(orcamento_id,company_id,ordem,tipo_item,servico_id,servico_codigo,servico_descricao,
      produto_nome,unidade,quantidade,preco_custo,preco_unitario,subtotal,observacoes)
    VALUES (p_orcamento_id,p_company_id,v_ordem,'servico',a.servico_id,a.s_codigo,a.s_nome,
      a.s_nome||' - '||a.nome, a.s_unidade, v_qtd, a.custo_unitario_total, v_preco,
      ROUND(v_qtd*v_preco,2), 'Gerado por takeoff IA - '||a.nome);
    v_count := v_count + 1;
  END LOOP;
  UPDATE erp_obra_planta SET status='confirmada' WHERE id=p_planta_id AND company_id=p_company_id;
  RETURN v_count;
END $function$;
