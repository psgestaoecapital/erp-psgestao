-- #91 (Jordana) · alerta de duplicidade em Despesas não pegava o caso dela.
-- CAUSA PROVADA: fn_pagar_checar_duplicidade_logica casava por data_vencimento EXATA e tinha uma cláusula
-- que EXCLUÍA matches quando os dois títulos tinham códigos de barras DIFERENTES — que é exatamente o caso
-- da Jordana: guias de imposto emitidas em duplicidade pelo site da prefeitura, com códigos de barras
-- distintos. Resultado: as duplicatas passavam batidas.
--
-- FIX: casar por fornecedor + valor + MÊS de vencimento (não a data exata — parcela quinzenal/dia diferente
-- no mesmo mês ainda é candidata) e NÃO excluir por código de barras diferente. Continua sendo só um AVISO
-- (a tela mostra "existe uma despesa parecida" com o registro e o vencimento na frente, e deixa lançar assim
-- mesmo — "É diferente, continuar"). NUNCA bloqueia: mesmo fornecedor/valor/mês pode ser legítimo
-- (parcela quinzenal, dois fretes iguais) — por isso avisa, não trava.
--
-- Prova: 312 grupos (fornecedor+valor+mês, 2+ títulos) hoje, 8 deles com códigos de barras diferentes —
-- que a regra antiga descartava e a nova passa a sinalizar.

CREATE OR REPLACE FUNCTION public.fn_pagar_checar_duplicidade_logica(p_company_id uuid, p_fornecedor_id uuid, p_valor numeric, p_vencimento date, p_codigo_barras text DEFAULT NULL::text, p_excluir_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, descricao text, valor numeric, vencimento date, status text, numero_documento text, codigo_barras text, criado_em timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.descricao::text, p.valor, p.data_vencimento, p.status::text,
         p.numero_documento::text, p.codigo_barras::text, p.created_at
  FROM public.erp_pagar p
  WHERE p.company_id = p_company_id
    AND p_fornecedor_id IS NOT NULL AND p.fornecedor_id = p_fornecedor_id
    AND p.valor = p_valor
    -- mesmo MÊS de vencimento (não a data exata) — pega a duplicata mesmo com dia diferente
    AND date_trunc('month', p.data_vencimento) = date_trunc('month', p_vencimento)
    AND coalesce(p.status, '') <> 'cancelado'
    AND (p_excluir_id IS NULL OR p.id <> p_excluir_id)
    -- (removida a exclusão por código de barras diferente: era o que escondia as guias duplicadas)
  ORDER BY p.data_vencimento DESC, p.created_at DESC;
$function$;
