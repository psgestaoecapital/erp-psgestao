-- GUARDIÃO 2 (pós-merge) anti-órfã · parte A: função de detecção.
-- Incidente 04/11 (migration órfã 20261104002141): o deploy-migrations ficou VERMELHO e NINGUÉM foi avisado
-- por ~1h45 — a esteira travou em silêncio. O deploy-migrations.yml já abre issue + posta uma tarefa P0 na
-- caixa do gilberto-esteira em failure, mas isso não sobe para o CEO/briefing nem para a aba Codes.
--
-- Esta função surfacea o deploy travado em erp_contexto_projeto (categoria pendencia, prioridade critica),
-- que é o canal do fn_briefing_sessao (alertas_pendentes_para_ceo) e da aba Codes. Sinal DB-knowable e
-- confiável: a tarefa P0 'deploy-migrations VERMELHO na main' postada pelo workflow (deduplicada; uma aberta
-- por vez). Enriquece com a última migration aplicada (ledger, fn_migrations_ledger/schema_migrations) para
-- nomear o alerta. Idempotente (1 pendência por episódio, chave em refs->>'episodio'); auto-resolve quando o
-- deploy volta (a P0 some da caixa). Aditiva, SECURITY DEFINER + search_path, REVOKE anon/PUBLIC.
--
-- Observação de honestidade (RD-38): o banco NÃO tem registro dos ARQUIVOS de migration da main (não há tabela
-- de "migrations esperadas"; schema_migrations só guarda o que FOI aplicado, sem carimbo de horário de
-- aplicação). Por isso a detecção por NOME de arquivo "não aplicado" não é possível puramente no banco; o sinal
-- correto e completo é o deploy VERMELHO persistente. A prevenção do pulo-em-silêncio (db push --include-all
-- pulando migration com versão menor) fica no Guardião 1 (check:migrations), que reprova no PR/deploy.

CREATE OR REPLACE FUNCTION public.fn_guardiao_deploy_travado()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_p0_id uuid;
  v_p0_criado timestamptz;
  v_min numeric;
  v_ult_ver text;
  v_ult_nome text;
  v_key text;
  v_exists int;
BEGIN
  -- Sinal: tarefa P0 aberta do deploy vermelho (postada pelo deploy-migrations.yml em failure).
  SELECT id, criado_em INTO v_p0_id, v_p0_criado
  FROM erp_agente_mensagem
  WHERE para = 'gilberto-esteira'
    AND assunto = 'P0: deploy-migrations VERMELHO na main'
    AND status <> 'concluida'
    AND NOT arquivada
  ORDER BY criado_em DESC
  LIMIT 1;

  IF v_p0_id IS NOT NULL THEN
    v_min := EXTRACT(EPOCH FROM (now() - v_p0_criado)) / 60;
    IF v_min >= 20 THEN
      -- contexto: última migration aplicada no ledger (nomeia o alerta)
      SELECT version::text, name::text INTO v_ult_ver, v_ult_nome
      FROM supabase_migrations.schema_migrations
      ORDER BY version DESC
      LIMIT 1;

      v_key := 'deploy_travado:' || to_char(v_p0_criado, 'YYYYMMDDHH24MISS');

      -- idempotente: 1 pendência por episódio
      SELECT count(*) INTO v_exists
      FROM erp_contexto_projeto
      WHERE categoria = 'pendencia'
        AND refs->>'guardiao' = 'deploy_travado'
        AND refs->>'episodio' = v_key;

      IF v_exists = 0 THEN
        INSERT INTO erp_contexto_projeto
          (projeto, categoria, prioridade, status, titulo, descricao, refs, criado_por, tags)
        VALUES (
          'esteira_dev',
          'pendencia',
          'critica',
          'ativo',
          'MIGRATION NÃO APLICADA: deploy-migrations travado há ' || round(v_min) || 'min',
          format(
            'O deploy-migrations está VERMELHO há %s min (tarefa P0 %s na caixa do gilberto-esteira). '
            || 'Enquanto o deploy está vermelho, NENHUMA migration nova aplica na produção (dívida invisível). '
            || 'Última migration aplicada no ledger: %s (%s). '
            || 'Playbook: comparar ledger x repo, reproduzir o erro em BEGIN...ROLLBACK (statement_timeout curto), '
            || 'reconciliar (RD-52) ou reverter a PR culpada, e re-rodar o deploy (workflow_dispatch).',
            round(v_min), v_p0_id, coalesce(v_ult_ver, '?'), coalesce(v_ult_nome, '?')
          ),
          jsonb_build_object(
            'guardiao', 'deploy_travado',
            'episodio', v_key,
            'p0_mensagem', v_p0_id,
            'ultima_aplicada', v_ult_ver
          ),
          'fn_guardiao_deploy_travado',
          ARRAY['deploy', 'migration', 'codes', 'esteira']
        );
      END IF;
    END IF;
  ELSE
    -- deploy recuperou (P0 concluída/inexistente): auto-resolve as pendências abertas do guardião
    UPDATE erp_contexto_projeto
    SET status = 'concluido',
        concluido_em = now(),
        atualizado_em = now()
    WHERE categoria = 'pendencia'
      AND refs->>'guardiao' = 'deploy_travado'
      AND status = 'ativo';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_guardiao_deploy_travado() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_guardiao_deploy_travado() FROM anon;
