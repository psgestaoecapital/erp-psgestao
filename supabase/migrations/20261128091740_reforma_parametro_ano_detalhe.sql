-- RD-104 (CBS/IBS · EC 132/2023 · LC 214/2025) — aba "Reforma Tributária" do cadastro de serviços.
--
-- PROBLEMA (auditoria RD-104, CEO 26/11): fiscal_reforma_parametro só tem a linha de TESTE 2026 (CBS 0,9%).
-- fn_reforma_parametro_ano(p_ano) devolve SILENCIOSAMENTE o último ano <= p_ano. A partir de 01/01/2027 ele
-- devolve a alíquota de teste de 2026 para QUALQUER serviço novo, e o ServicoForm prefila o CBS/IBS com esse
-- valor como se fosse autoritativo — induzindo o cliente ao erro na NFS-e (RD-104 a e c).
--
-- CORREÇÃO (aditiva, fail-safe, SEM asserir alíquota futura ainda não fixada em lei):
--   nova função-irmã fn_reforma_parametro_ano_detalhe(p_ano) que, além da alíquota, informa:
--     - ano_base      = o ano da linha realmente usada (pode ser anterior ao pedido);
--     - defasado       = ano_base <> p_ano (devolveu um ano diferente do pedido);
--     - a_confirmar    = a linha é provisória/estimativa (observação marca "a confirmar"/"teste"/"estimativa");
--     - encontrou      = havia alguma linha <= p_ano.
--   A função ANTIGA fn_reforma_parametro_ano NÃO é alterada (sem DROP, sem ripple nos demais consumidores).
--   Com isto a UI decide: quando defasado/a_confirmar, AVISA e NÃO prefila como valor autoritativo.
--   As alíquotas de 2027..2033 (CBS de referência ~8,8%, IBS em rampa) dependem de resolução do Senado e NÃO
--   são gravadas aqui como autoritativas; enquanto não houver linha oficial do ano, a tela trata como defasado.
CREATE OR REPLACE FUNCTION public.fn_reforma_parametro_ano_detalhe(p_ano int)
RETURNS TABLE(
  ano_pedido int,
  ano_base int,
  cbs_pct numeric,
  ibs_uf_pct numeric,
  ibs_mun_pct numeric,
  defasado boolean,
  a_confirmar boolean,
  encontrou boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE(p_ano, p.ano)                                        AS ano_pedido,
    p.ano                                                         AS ano_base,
    p.cbs_pct, p.ibs_uf_pct, p.ibs_mun_pct,
    (p.ano IS DISTINCT FROM COALESCE(p_ano, p.ano))               AS defasado,
    (p.observacao ILIKE '%a confirmar%'
       OR p.observacao ILIKE '%estimativa%'
       OR p.observacao ILIKE '%teste%'
       OR p.observacao ILIKE '%provis%')                          AS a_confirmar,
    true                                                          AS encontrou
  FROM public.fiscal_reforma_parametro p
  WHERE p.ano <= COALESCE(p_ano, p.ano)
  ORDER BY p.ano DESC
  LIMIT 1;
$function$;
REVOKE ALL ON FUNCTION public.fn_reforma_parametro_ano_detalhe(int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_reforma_parametro_ano_detalhe(int) TO authenticated, service_role;
