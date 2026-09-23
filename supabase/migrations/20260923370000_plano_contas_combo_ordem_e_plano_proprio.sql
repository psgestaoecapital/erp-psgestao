-- Combo "Em qual categoria do DRE?" (CategoriaCombobox) — bug de UX visto na Estância Umuarama.
-- fn_plano_contas_buscar ordenava por "is_totalizador ASC, codigo ASC", jogando os totalizadores
-- para o FIM da lista (2 CUSTO DA PECUARIA aparecia depois de 3.05). Agora ordena pela HIERARQUIA
-- do plano em ordem crescente de código, tratando cada segmento como número:
--   string_to_array(codigo, '.')::int[]  →  [1] < [1,1] < [2] < [10]  (não o texto '10' < '2').
-- Todos os 1382 códigos ativos batem ^[0-9]+(\.[0-9]+)*$ e o criador inline gera pai||'.'||lpad(n,2)
-- (sempre numérico-pontuado), então o cast é seguro e continua seguro para códigos futuros.
--
-- Também expõe `plano_proprio` (o v_exclusivo já calculado) para a tela decidir:
--   • agrupar por totalizador (empresa com plano próprio) vs por tipo (template global) e
--   • esconder o rótulo "custom" quando TODAS as contas são da empresa.
--
-- Empresas com flag=false continuam vendo o template global na mesma ordem hierárquica — a única
-- diferença é o totalizador deixar de ser clicável na tela (isso é frontend; lançar em totalizador
-- quebra o DRE em qualquer empresa).
--
-- RD-52 (arquivo=ledger) · RD-38. Muda o RETURNS TABLE (nova coluna) → DROP + CREATE.
-- SECURITY DEFINER → REVOKE anon + GRANT authenticated/service_role.

DROP FUNCTION IF EXISTS public.fn_plano_contas_buscar(uuid, text, text);

CREATE OR REPLACE FUNCTION public.fn_plano_contas_buscar(p_company_id uuid, p_termo text DEFAULT NULL::text, p_aplicacao text DEFAULT NULL::text)
 RETURNS TABLE(codigo text, descricao text, grupo text, tipo text, nivel integer, pai_codigo text, is_totalizador boolean, origem text, plano_proprio boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_exclusivo boolean := false;
BEGIN
  IF NOT (p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'acesso_negado';
  END IF;

  SELECT COALESCE(c.plano_contas_proprio, false) INTO v_exclusivo
    FROM public.companies c WHERE c.id = p_company_id;

  -- trava anti-combo-vazio: so isola se a empresa realmente tem plano proprio ativo
  IF v_exclusivo AND NOT EXISTS (
    SELECT 1 FROM public.erp_plano_contas pc
     WHERE pc.company_id = p_company_id AND pc.ativo = true
  ) THEN
    v_exclusivo := false;
  END IF;

  RETURN QUERY
  WITH filtrada AS (
    SELECT pc.codigo, pc.descricao, pc.grupo, pc.tipo, pc.nivel, pc.pai_codigo, pc.is_totalizador,
      CASE WHEN pc.company_id IS NULL THEN 'global' ELSE 'empresa' END AS origem,
      CASE WHEN pc.company_id = p_company_id THEN 1 ELSE 2 END AS prio
    FROM public.erp_plano_contas pc
    WHERE pc.ativo = true
      AND ( pc.company_id = p_company_id
         OR (pc.company_id IS NULL AND NOT v_exclusivo) )
      AND ( p_aplicacao IS NULL
        OR (p_aplicacao = 'receber' AND pc.tipo = 'receita')
        OR (p_aplicacao = 'pagar' AND pc.tipo IN ('despesa','custo','investimento','financeiro')) )
      AND ( p_termo IS NULL OR btrim(p_termo) = ''
        OR pc.codigo ILIKE '%' || btrim(p_termo) || '%'
        OR pc.descricao ILIKE '%' || btrim(p_termo) || '%' )
  ),
  dedup AS (
    SELECT DISTINCT ON (filtrada.codigo)
      filtrada.codigo, filtrada.descricao, filtrada.grupo, filtrada.tipo,
      filtrada.nivel, filtrada.pai_codigo, filtrada.is_totalizador, filtrada.origem
    FROM filtrada ORDER BY filtrada.codigo, filtrada.prio
  )
  SELECT dedup.codigo, dedup.descricao, dedup.grupo, dedup.tipo, dedup.nivel,
         dedup.pai_codigo, dedup.is_totalizador, dedup.origem, v_exclusivo AS plano_proprio
  FROM dedup
  ORDER BY string_to_array(dedup.codigo, '.')::int[] ASC
  LIMIT 50;
END $function$;

REVOKE ALL ON FUNCTION public.fn_plano_contas_buscar(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_plano_contas_buscar(uuid,text,text) TO authenticated, service_role;
