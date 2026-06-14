-- =============================================================
-- ONDA-A-1.2 · TOGGLE AUTO-CONCILIACAO (cascata empresa->conta)
-- =============================================================
-- Adiciona toggle de auto-conciliacao em 2 camadas:
--   1. erp_conciliacao_config (por empresa) · default OFF
--   2. erp_banco_contas.auto_conciliar (por conta) · NULL=herda
--
-- Runner com semantica nova de p_auto_aplicar:
--   - p_auto_aplicar=NULL (default): usa preferencia
--     COALESCE(bc.auto_conciliar, cfg.auto_conciliar_global, false)
--     E o corte usa cfg.score_minimo (ou p_score_auto default 90)
--   - p_auto_aplicar=true/false: override manual
--     usa p_score_auto como corte
--
-- Novos campos no jsonb de retorno:
--   modo_auto: 'preferencia_usuario' | 'override_manual'
--   auto_desligado: quantos movimentos passariam o corte
--                   mas auto_efetivo=false (revela quanto a tela
--                   manual tem pendente por escolha de config)
--
-- Pilar 2: RLS espelhada de erp_banco_contas (mesmo isolamento
-- por company_id + bypass adm). Sem RLS, nao mergeia.
--
-- Aplicada via MCP em 2026-06-14.
-- =============================================================

CREATE TABLE IF NOT EXISTS erp_conciliacao_config (
  company_id            uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  auto_conciliar_global boolean NOT NULL DEFAULT false,
  score_minimo          int     NOT NULL DEFAULT 90 CHECK (score_minimo BETWEEN 60 AND 100),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid
);
ALTER TABLE erp_conciliacao_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conciliacao_config_all ON erp_conciliacao_config;
CREATE POLICY conciliacao_config_all ON erp_conciliacao_config
  FOR ALL TO public USING (
    company_id IN (SELECT company_id FROM user_companies WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid()
               AND role = ANY (ARRAY['adm','acesso_total','adm_investimentos']))
  );

ALTER TABLE erp_banco_contas
  ADD COLUMN IF NOT EXISTS auto_conciliar boolean DEFAULT NULL;
COMMENT ON COLUMN erp_banco_contas.auto_conciliar IS
  'NULL = herda erp_conciliacao_config da empresa; true/false = override por conta';

CREATE OR REPLACE FUNCTION public.fn_conciliacao_rodar_lote(
  p_company_id uuid, p_lote_id uuid DEFAULT NULL,
  p_auto_aplicar boolean DEFAULT NULL, p_score_auto integer DEFAULT 90, p_limite integer DEFAULT 500
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_mov RECORD; v_best RECORD;
  v_processados int:=0; v_com_sugestao int:=0; v_perfeitos int:=0; v_quase int:=0;
  v_sem_match int:=0; v_auto_conc int:=0; v_colisao_pulada int:=0; v_auto_off int:=0;
  v_lancs_usados text[]:='{}'; v_chave text; v_deve_auto boolean; v_corte int;
BEGIN
  FOR v_mov IN
    SELECT m.id, m.lote_id,
           COALESCE(bc.auto_conciliar, cfg.auto_conciliar_global, false) AS auto_efetivo,
           COALESCE(cfg.score_minimo, p_score_auto) AS score_efetivo
    FROM conciliacao_movimento m
    JOIN conciliacao_lote l ON l.id=m.lote_id
    LEFT JOIN erp_banco_contas bc ON bc.id=l.conta_bancaria_id
    LEFT JOIN erp_conciliacao_config cfg ON cfg.company_id=m.company_id
    WHERE m.company_id=p_company_id AND m.status IN ('pendente','divergente')
      AND (p_lote_id IS NULL OR m.lote_id=p_lote_id)
    ORDER BY m.data_transacao LIMIT p_limite
  LOOP
    v_processados:=v_processados+1;
    SELECT * INTO v_best FROM fn_conciliacao_sugerir_match(v_mov.id,1) ORDER BY match_score DESC LIMIT 1;
    IF v_best.lancamento_id IS NULL THEN v_sem_match:=v_sem_match+1; CONTINUE; END IF;
    UPDATE conciliacao_movimento
       SET psgc_sugestao=v_best.lancamento_tabela||':'||v_best.lancamento_id,
           psgc_confianca=v_best.match_score, motivo_status=v_best.motivo, updated_at=now()
     WHERE id=v_mov.id;
    v_com_sugestao:=v_com_sugestao+1;
    IF v_best.match_score>=90 THEN v_perfeitos:=v_perfeitos+1;
    ELSIF v_best.match_score>=60 THEN v_quase:=v_quase+1; END IF;
    v_deve_auto:=COALESCE(p_auto_aplicar, v_mov.auto_efetivo);
    v_corte:=CASE WHEN p_auto_aplicar IS NOT NULL THEN p_score_auto ELSE v_mov.score_efetivo END;
    IF v_best.match_score>=v_corte THEN
      IF NOT v_deve_auto THEN v_auto_off:=v_auto_off+1;
      ELSE
        v_chave:=v_best.lancamento_tabela||':'||v_best.lancamento_id;
        IF v_chave=ANY(v_lancs_usados)
           OR EXISTS(SELECT 1 FROM conciliacao_movimento cm
                     WHERE cm.lancamento_id=v_best.lancamento_id
                       AND cm.lancamento_tabela=v_best.lancamento_tabela AND cm.status='conciliado')
        THEN v_colisao_pulada:=v_colisao_pulada+1;
        ELSE
          PERFORM fn_conciliacao_aplicar_match(v_mov.id,v_best.lancamento_tabela,v_best.lancamento_id,NULL,'auto');
          v_lancs_usados:=array_append(v_lancs_usados,v_chave); v_auto_conc:=v_auto_conc+1;
        END IF;
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'company_id',p_company_id,
    'modo_auto',CASE WHEN p_auto_aplicar IS NULL THEN 'preferencia_usuario' ELSE 'override_manual' END,
    'processados',v_processados,'com_sugestao',v_com_sugestao,'perfeitos',v_perfeitos,
    'quase',v_quase,'sem_match',v_sem_match,'auto_conciliados',v_auto_conc,
    'colisao_pulada',v_colisao_pulada,'auto_desligado',v_auto_off,'rodado_em',now());
END; $$;
