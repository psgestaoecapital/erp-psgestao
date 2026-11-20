-- Item 4 (CEO 20/11) — banner da esteira mostra "verde (N em quarentena)" para a dívida não ser esquecida.
-- Acrescenta UM campo de leitura a fn_esteira_saude(): quarentena_abertas = quantas quarentenas estão abertas
-- (erp_quarentena_spec: quarentenado = true e ainda não resolvido). Nada mais muda no corpo da função.
-- Só leitura, sem company_id (status global de CI/esteira, como o resto de fn_esteira_saude). SECURITY DEFINER
-- preservado; sem parâmetro e sem escrita (não entra na guarda de funções). CREATE OR REPLACE mantém os grants.

CREATE OR REPLACE FUNCTION public.fn_esteira_saude()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH g AS (SELECT verde, desde, spec_falha FROM erp_dev_main_teste WHERE id=1),
hist AS (
  SELECT verde, mudou_em, COALESCE(lead(mudou_em) OVER (ORDER BY mudou_em), now()) AS ate
  FROM erp_esteira_portao_hist WHERE mudou_em > now() - interval '24 hours'
),
verm AS (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (ate-mudou_em))/60),0) AS min_v FROM hist WHERE verde=false),
quedas AS (SELECT count(*) AS n FROM erp_esteira_portao_hist WHERE verde=false AND mudou_em > now()-interval '24 hours'),
pubs AS (SELECT ocorrido_em - lag(ocorrido_em) OVER (ORDER BY ocorrido_em) AS gap
         FROM erp_dev_entrega WHERE evento='publicada' AND ocorrido_em > now()-interval '24 hours'),
med AS (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM gap)/60) AS m FROM pubs WHERE gap IS NOT NULL),
fila AS (SELECT count(*) FILTER (WHERE estado='esperando') AS esp,
                count(*) FILTER (WHERE estado='fora-da-rodada') AS par,
                EXTRACT(EPOCH FROM (now()-min(atualizado_em) FILTER (WHERE estado='fora-da-rodada')))/3600 AS antiga
         FROM erp_esteira_pr_estado)
SELECT jsonb_build_object(
  'portao_verde',(SELECT verde FROM g),
  'portao_desde',(SELECT desde FROM g),
  'portao_spec_falha',(SELECT spec_falha FROM g),
  'quarentena_abertas',(SELECT count(*) FROM erp_quarentena_spec WHERE quarentenado AND resolvido_em IS NULL),
  'quedas_24h',(SELECT n FROM quedas),
  'tempo_vermelho_24h_min',round((SELECT min_v FROM verm)::numeric,0),
  'merges_24h',(SELECT count(DISTINCT pr_numero) FROM erp_dev_entrega WHERE evento='publicada' AND ocorrido_em>now()-interval '24 hours'),
  'intervalo_mediano_merge_min',round((SELECT m FROM med)::numeric,0),
  'fila_esperando',(SELECT esp FROM fila),
  'fila_parada',(SELECT par FROM fila),
  'pr_parada_mais_antiga_h',round((SELECT antiga FROM fila)::numeric,1)
);
$function$;

-- Grants idênticos ao estado atual (SECURITY DEFINER: fecha anon/PUBLIC, abre p/ authenticated + service_role).
REVOKE ALL ON FUNCTION public.fn_esteira_saude() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_esteira_saude() TO authenticated, service_role;
