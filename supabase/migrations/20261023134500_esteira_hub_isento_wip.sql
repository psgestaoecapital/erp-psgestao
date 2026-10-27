-- CEO 23/10: "Hub inteiro no dev, sem parar; produção máxima." O limite de WIP (máx. 3 PRs prontas) travava o dev de
-- abrir PR do Hub enquanto o backlog geral não drenasse (fila Ready=21 → pode=false → dev parado no Hub). Mas o Hub agora
-- tem VIA EXPRESSA (label hub: prioridade + via rápida + lote aditivo) e drena rápido, reauditado pelo PDCA. Então a
-- produção do Hub NÃO precisa esperar o backlog geral: enquanto o agente tiver uma tarefa de Hub ABERTA na caixa, ele
-- pode abrir PR (exceção, como urgente/correção de esteira). O limite de 3 segue valendo para o resto.
CREATE OR REPLACE FUNCTION public.fn_esteira_pode_abrir_pr(p_agente text, p_urgente boolean DEFAULT false, p_correcao_esteira boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH ciclo AS (
    SELECT pr_numero,
           bool_or(evento = 'pronta') AS pronta,
           bool_or(evento IN ('publicada','fechada')) AS fim
      FROM erp_dev_entrega
     WHERE ocorrido_em > now() - interval '3 days'
     GROUP BY pr_numero
  ), n AS (
    SELECT count(*)::int AS prontas FROM ciclo WHERE pronta AND NOT fim
  ), hub AS (
    -- produção do Hub em curso: tarefa de Hub aberta na caixa do agente (via expressa drena, PDCA reaudita)
    SELECT EXISTS (
      SELECT 1 FROM erp_agente_mensagem
       WHERE para = p_agente
         AND status IN ('nova','em_andamento')
         AND COALESCE(arquivada,false) = false
         AND (assunto ILIKE '%hub%' OR assunto ILIKE '%HB0%' OR assunto ILIKE '%HB1%' OR assunto ILIKE '%HB2%' OR assunto ILIKE '%HB3%')
    ) AS tem_hub
  )
  SELECT jsonb_build_object(
    'ok', true,
    'agente', p_agente,
    'prontas', n.prontas,
    'limite', 3,
    'tem_hub', hub.tem_hub,
    'pode', (n.prontas <= 3 OR COALESCE(p_urgente,false) OR COALESCE(p_correcao_esteira,false) OR hub.tem_hub),
    'motivo', CASE
      WHEN n.prontas <= 3 THEN 'ok: ' || n.prontas || ' prontas (limite 3)'
      WHEN hub.tem_hub THEN 'exceção: produção do Hub (via expressa drena + PDCA reaudita), ' || n.prontas || ' prontas'
      WHEN COALESCE(p_urgente,false) THEN 'exceção: tarefa URGENTE (cliente/produção), ' || n.prontas || ' prontas'
      WHEN COALESCE(p_correcao_esteira,false) THEN 'exceção: correção de esteira, ' || n.prontas || ' prontas'
      ELSE n.prontas || ' PRs prontas esperando (> 3): só destravar — aceitação vermelha, AJUSTES do revisor, rascunho autorizado → Ready, conflito com a main, ordem das migrations'
    END)
  FROM n, hub;
$function$;
