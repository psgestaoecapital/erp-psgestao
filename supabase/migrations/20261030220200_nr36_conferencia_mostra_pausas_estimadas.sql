-- #4032 · Pausas térmicas · Conferência: mostrar as pausas pendentes de veredito (estimativa do sistema)
--
-- Problema relatado (Karol/Frioeste, chamados #4032 e #2119): o colaborador aparece com N dias
-- "precisando de conferência" no Painel/Supervisão, mas ao auditar o mês na aba Conferência "não aparece
-- nada pendente de ajuste".
--
-- Causa (provada no dado, RD-38): a APURAÇÃO (fn_nr36_apurar_nucleo) marca o dia como
-- 'pendente_confirmacao' quando ALGUMA pausa não tem fim com origem efetiva OU quando o fim tem origem
-- 'estimado'/'indeterminado' — decisão do CEO: a estimativa do SISTEMA não fecha o veredito. Já a aba
-- Conferência (fn_nr36_pausas_pendentes_listar) só listava as pausas SEM origem efetiva
-- (fn_nr36_fim_origem_efetiva(...) IS NULL), ignorando as de origem 'estimado'/'indeterminado'. Assim a
-- pausa com estimativa do sistema ficava pendente no Painel/Supervisão mas INVISÍVEL na Conferência — e a
-- responsável não tinha onde dar o veredito.
--
-- Correção: alinhar o filtro da Conferência EXATAMENTE à regra de pendência da apuração. Passa a listar
-- também as pausas com fim_origem IN ('indeterminado','estimado'). Mudança somente de LEITURA (a função é
-- STABLE e não grava nada); apenas ACRESCENTA linhas que a apuração já considera pendentes. Depois que a
-- responsável confirma (pela batida ou pela estimativa) a pausa recebe origem 'confirmado_ponto'/'confirmado_manual'
-- e sai da lista — e, reapurado o dia, sai também do Painel/Supervisão.
--
-- Observação para o Eng. Chefe: resta tratar a defasagem do Painel após a conferência (chamado #2119):
-- fn_nr36_confirmar_fim_pausa / _lote e fn_nr36_desfazer_amarracao_periodo NÃO reapuram o dia, então o
-- snapshot nr36_pausa_apurada fica velho até alguém clicar "Apurar". Essa parte é alteração de EFEITO
-- (mutação) em função crítica e foi deixada para revisão — patch proposto no handoff da sessão.

CREATE OR REPLACE FUNCTION public.fn_nr36_pausas_pendentes_listar(p_company_id uuid, p_limite integer DEFAULT 1000)
 RETURNS TABLE(pausa_id uuid, cpf text, colaborador text, data date, classe_evento text, inicio_local text, fim_sugerido_local text, fim_sugerido_tipo text, batida_local text, minutos_ate_batida numeric, sem_saida boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN RETURN; END IF;
  RETURN QUERY
  SELECT p.id, p.cpf,
    COALESCE(c.nome, p.cpf) AS colaborador,
    p.data, p.classe_evento,
    to_char(p.inicio AT TIME ZONE 'America/Sao_Paulo','HH24:MI'),
    to_char(p.fim_sugerido AT TIME ZONE 'America/Sao_Paulo','HH24:MI'),
    p.fim_sugerido_tipo,
    CASE WHEN p.fim_sugerido_tipo='batida_forte' THEN to_char(p.fim_sugerido AT TIME ZONE 'America/Sao_Paulo','HH24:MI') ELSE NULL END,
    NULL::numeric,
    COALESCE(p.inicio_origem = 'sem_saida', false)
  FROM public.ind_ponto_pausa p
  LEFT JOIN public.ind_ponto_colaborador c ON c.company_id=p.company_id AND c.cpf=p.cpf
  WHERE p.company_id = p_company_id
    -- #4032 · mesma regra de pendência da apuração: sem fim de origem efetiva OU fim 'estimado'/'indeterminado'
    -- (estimativa do sistema não fecha veredito — decisão do CEO). Antes só o 1º caso aparecia aqui.
    AND (public.fn_nr36_fim_origem_efetiva(p.fim, p.classe_evento, p.fim_origem) IS NULL
         OR p.fim_origem IN ('indeterminado','estimado'))
  ORDER BY p.data, p.cpf, p.inicio
  LIMIT p_limite;
END $function$;

-- Mesmos grants da versão viva (authenticated + service_role; nada a anon/PUBLIC) — check_fn_guards.
REVOKE ALL ON FUNCTION public.fn_nr36_pausas_pendentes_listar(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nr36_pausas_pendentes_listar(uuid, integer) TO authenticated, service_role;
