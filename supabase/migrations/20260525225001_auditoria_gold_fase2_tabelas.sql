-- AUDITORIA GOLD FASE 2 · 3 tabelas Veredito Triplo
-- Aplicado via MCP apply_migration 25/05/2026 ~22:50 BRT
-- Cristalização foundational: erp_contexto_projeto id 860912d7
--
-- Correção vs briefing: gold_veredito_triplo.camada1_evidencia_id
-- declarado como BIGINT (não UUID), pois rd38_playwright_falhas.id é bigint.

CREATE TABLE IF NOT EXISTS public.gold_screen_buttons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  screen_id TEXT NOT NULL REFERENCES public.system_screens(id) ON DELETE CASCADE,
  rota TEXT NOT NULL,
  botao_label TEXT NOT NULL,
  botao_selector_css TEXT NOT NULL,
  destino_esperado_rota TEXT,
  destino_esperado_descricao TEXT,
  prioridade TEXT NOT NULL DEFAULT 'normal' CHECK (prioridade IN ('critico','normal','opcional')),
  tipo TEXT NOT NULL DEFAULT 'navegacao' CHECK (tipo IN ('navegacao','submit','acao','modal')),
  ativo BOOLEAN DEFAULT TRUE,
  cadastrado_em TIMESTAMPTZ DEFAULT NOW(),
  cadastrado_por TEXT DEFAULT 'engenheiro_chefe',
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gold_buttons_rota ON public.gold_screen_buttons(rota) WHERE ativo = TRUE;
CREATE INDEX IF NOT EXISTS idx_gold_buttons_prioridade ON public.gold_screen_buttons(prioridade, ativo);

CREATE TABLE IF NOT EXISTS public.gold_camada2_validacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  botao_id UUID NOT NULL REFERENCES public.gold_screen_buttons(id) ON DELETE CASCADE,
  executado_em TIMESTAMPTZ DEFAULT NOW(),
  destino_real_url TEXT,
  destino_match_esperado BOOLEAN,
  http_status_destino INT,
  tem_elementos_esperados BOOLEAN,
  elementos_detectados TEXT[],
  elementos_faltando TEXT[],
  tempo_resposta_ms INT,
  screenshot_url TEXT,
  claude_analysis_jornada JSONB,
  claude_model_used TEXT,
  claude_custo_usd NUMERIC(10,5),
  veredito_camada2 TEXT CHECK (veredito_camada2 IN ('verde','amarelo','vermelho','pendente')),
  motivo_veredito TEXT,
  request_id_playwright BIGINT
);

CREATE INDEX IF NOT EXISTS idx_gold_c2_executado ON public.gold_camada2_validacoes(executado_em DESC);
CREATE INDEX IF NOT EXISTS idx_gold_c2_veredito ON public.gold_camada2_validacoes(veredito_camada2);

CREATE TABLE IF NOT EXISTS public.gold_veredito_triplo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  screen_id TEXT NOT NULL REFERENCES public.system_screens(id),
  rota TEXT NOT NULL,
  pr_numero INT,
  executado_em TIMESTAMPTZ DEFAULT NOW(),
  camada1_status TEXT CHECK (camada1_status IN ('verde','amarelo','vermelho','pendente')),
  camada1_evidencia_id BIGINT,
  camada2_status TEXT CHECK (camada2_status IN ('verde','amarelo','vermelho','pendente')),
  camada2_evidencia_id UUID,
  camada3_status TEXT CHECK (camada3_status IN ('verde','amarelo','vermelho','pendente')),
  camada3_evidencia_id BIGINT,
  veredito_final TEXT CHECK (veredito_final IN ('OURO','PRATA','BRONZE','SUSPEITO','BLOQUEADO','PENDENTE')),
  politica_fix TEXT CHECK (politica_fix IN ('verde_automatico','amarelo_sugerido','vermelho_ceo','sem_acao')),
  pr_fix_gerado_numero INT,
  alertou_engenheiro_chefe BOOLEAN DEFAULT FALSE,
  alertou_ceo BOOLEAN DEFAULT FALSE,
  custo_total_usd NUMERIC(10,5),
  notas TEXT
);

CREATE INDEX IF NOT EXISTS idx_gold_vt_rota ON public.gold_veredito_triplo(rota, executado_em DESC);
CREATE INDEX IF NOT EXISTS idx_gold_vt_veredito ON public.gold_veredito_triplo(veredito_final);
CREATE INDEX IF NOT EXISTS idx_gold_vt_pr ON public.gold_veredito_triplo(pr_numero) WHERE pr_numero IS NOT NULL;
