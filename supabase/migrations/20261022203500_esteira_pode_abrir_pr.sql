-- Limite de trabalho em andamento da esteira (CEO 14/10): no máximo 3 PRs prontas esperando.
-- Função NOVA, só canal de serviço. Mesma contagem do painel "PRs prontas esperando"
-- Janela de 3 dias: eventos mais antigos sem fim são resíduo (PR fechada sem evento), não fila real.
-- (src/lib/dev/desempenhoCodes.ts › ciclos/pilhaProntas): PR com evento 'pronta' e sem 'publicada'/'fechada'.
CREATE OR REPLACE FUNCTION public.fn_esteira_pode_abrir_pr(
  p_agente text,
  p_urgente boolean DEFAULT false,
  p_correcao_esteira boolean DEFAULT false
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH ciclo AS (
    SELECT pr_numero,
           bool_or(evento = 'pronta') AS pronta,
           bool_or(evento IN ('publicada','fechada')) AS fim
      FROM erp_dev_entrega
     WHERE ocorrido_em > now() - interval '3 days'
     GROUP BY pr_numero
  ), n AS (
    SELECT count(*)::int AS prontas FROM ciclo WHERE pronta AND NOT fim
  )
  SELECT jsonb_build_object(
    'ok', true,
    'agente', p_agente,
    'prontas', n.prontas,
    'limite', 3,
    'pode', (n.prontas <= 3 OR COALESCE(p_urgente,false) OR COALESCE(p_correcao_esteira,false)),
    'motivo', CASE
      WHEN n.prontas <= 3 THEN 'ok: ' || n.prontas || ' prontas (limite 3)'
      WHEN COALESCE(p_urgente,false) THEN 'exceção: tarefa URGENTE (cliente/produção), ' || n.prontas || ' prontas'
      WHEN COALESCE(p_correcao_esteira,false) THEN 'exceção: correção de esteira, ' || n.prontas || ' prontas'
      ELSE n.prontas || ' PRs prontas esperando (> 3): só destravar — aceitação vermelha, AJUSTES do revisor, rascunho autorizado → Ready, conflito com a main, ordem das migrations'
    END)
  FROM n;
$$;

REVOKE ALL ON FUNCTION public.fn_esteira_pode_abrir_pr(text, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_esteira_pode_abrir_pr(text, boolean, boolean) TO service_role;
