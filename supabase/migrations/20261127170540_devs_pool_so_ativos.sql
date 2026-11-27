-- fix(roteamento de chamados): fn_devs_pool só lista dev ATIVO (erp_agente_rotina.ativo) — CEO 25/11.
-- Antes a lista era FIXA com 3 Codes já extintos (dev7claudeps, rodrigo-code, jordana-code), e o roteador
-- (fn_dev_mais_vazio → fn_devs_pool) podia mandar chamado pra agente que não existe mais. Agora o universo de devs
-- que atendem chamado é filtrado por erp_agente_rotina.ativo = true: hoje retorna só code-desenvolvedor-3 e
-- desenvolvedor_4_g; se um Code for reativado no banco, ele volta à fila sozinho (sem nova migration). Os agentes
-- que NÃO atendem chamado (auditores, revisor, esteira) continuam fora porque não entram no universo abaixo.
-- Vira STABLE (lê tabela). Nenhum dado de cliente é tocado; só a definição da função. RD-97: fn_* não é tabela de domínio.
CREATE OR REPLACE FUNCTION public.fn_devs_pool()
 RETURNS TABLE(agente text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- Universo de devs que podem atender chamado; só os que estão ATIVOS em erp_agente_rotina entram na fila.
  SELECT x.a
  FROM (VALUES
    ('code-desenvolvedor-3'),
    ('desenvolvedor_4_g'),
    ('dev7claudeps'),
    ('rodrigo-code'),
    ('jordana-code')
  ) AS x(a)
  WHERE EXISTS (
    SELECT 1 FROM public.erp_agente_rotina r WHERE r.agente = x.a AND r.ativo = true
  );
$function$;

REVOKE ALL ON FUNCTION public.fn_devs_pool() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_devs_pool() TO authenticated, service_role;
