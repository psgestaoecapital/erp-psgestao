-- Auto-conciliação só com DUPLA IDENTIFICAÇÃO (decisão do CEO · RD-51).
--
-- PROBLEMA: fn_conciliacao_rodar_lote auto-aplicava o MELHOR candidato sempre que
-- score >= corte, sem detectar EMPATE (2 títulos de mesmo valor/data) nem exigir que
-- o nome do cliente/fornecedor aparecesse no extrato. Foi assim que Toy Tintas × Fazenda
-- Umuarama (ambos R$2.500) casaram no escuro. O incerto NÃO pode se passar por certo.
--
-- REGRA NOVA — só é auto-conciliável ('exato') quando:
--   (1) valor bate (<=0.01) E data bate (<=1 dia)   [score do motor já cobre]
--   (2) É CANDIDATO ÚNICO (qtd_candidatos = 1 na janela exata)
--   (3) HÁ IDENTIFICAÇÃO: nome da contraparte aparece na descrição do banco
-- Falhou (2) -> 'ambiguo' (humano escolhe entre candidatos lado a lado).
-- Falhou (3) -> 'revisar' (humano confirma identidade).
-- Opção A (ESTRITO): empate SEMPRE vai pro humano, mesmo com nome batendo.

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER 1 — identificado: o nome da contraparte aparece na descrição do banco?
-- Normaliza (upper, sem acento, pontuação -> espaço) e casa por TOKEN >=4 chars.
-- Sufixos societários e nome do próprio banco NÃO identificam ("sicredi" nas taxas).
-- Descrição só-genérica (PIX RECEBIDO, TED, DEPÓSITO) nunca casa: não tem token de nome.
CREATE OR REPLACE FUNCTION public.fn_conciliacao_identificado(
  p_descricao_banco text,
  p_nome_pessoa text
) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_desc text;
  v_tok  text;
BEGIN
  IF p_nome_pessoa IS NULL OR btrim(p_nome_pessoa) = '' THEN
    RETURN false;
  END IF;
  -- descrição normalizada, delimitada por espaço nas pontas p/ casar '% TOKEN %'
  v_desc := ' ' || regexp_replace(fn_normalizar_texto_alerta(COALESCE(p_descricao_banco, '')),
                                  '[^A-Z0-9]+', ' ', 'g') || ' ';
  FOR v_tok IN
    SELECT t FROM regexp_split_to_table(
      regexp_replace(fn_normalizar_texto_alerta(p_nome_pessoa), '[^A-Z0-9]+', ' ', 'g'),
      ' '
    ) AS t
  LOOP
    IF length(v_tok) >= 4
       AND v_tok NOT IN (
         -- sufixos societários / banco / termos genéricos de extrato
         'LTDA','EPP','MEI','EIRELI','ME','SA','BANCO','SICREDI','SICOOB',
         'PIX','RECEBIDO','RECEBIDA','ENVIADO','ENVIADA','DEPOSITO','DEPOSITO',
         'TED','DOC','CRED','DEB','TRANSFERENCIA','OUTRA','PAGAMENTO'
       )
       AND v_desc LIKE ('% ' || v_tok || ' %')
    THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER 2 — qtd_candidatos na JANELA EXATA (valor<=0.01 E dias<=1).
-- Espelha os filtros do motor (fn_conciliacao_sugerir_match): mesma tabela por
-- natureza, mesmos status, e ignora títulos já conciliados por OUTRO movimento.
CREATE OR REPLACE FUNCTION public.fn_conciliacao_qtd_candidatos(
  p_movimento_id uuid
) RETURNS integer
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_mov RECORD;
  v_n   int := 0;
BEGIN
  SELECT * INTO v_mov FROM conciliacao_movimento WHERE id = p_movimento_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  IF v_mov.natureza = 'debito' THEN
    SELECT count(*) INTO v_n
    FROM erp_pagar p
    WHERE p.company_id = v_mov.company_id
      AND p.status IN ('aberto','vencido','pago')
      AND abs(p.valor - v_mov.valor) <= 0.01
      AND abs((p.data_vencimento - v_mov.data_transacao)) <= 1
      AND NOT EXISTS (
        SELECT 1 FROM conciliacao_movimento cm
        WHERE cm.lancamento_id = p.id AND cm.lancamento_tabela = 'erp_pagar'
          AND cm.status = 'conciliado' AND cm.id <> v_mov.id
      );
  ELSE
    SELECT count(*) INTO v_n
    FROM erp_receber r
    WHERE r.company_id = v_mov.company_id
      AND r.status IN ('aberto','vencido','pago')
      AND abs(r.valor - v_mov.valor) <= 0.01
      AND abs((r.data_vencimento - v_mov.data_transacao)) <= 1
      AND NOT EXISTS (
        SELECT 1 FROM conciliacao_movimento cm
        WHERE cm.lancamento_id = r.id AND cm.lancamento_tabela = 'erp_receber'
          AND cm.status = 'conciliado' AND cm.id <> v_mov.id
      );
  END IF;
  RETURN COALESCE(v_n, 0);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER 3 — qualidade: classifica a melhor sugestão de um movimento.
-- 'exato'=auto | 'ambiguo'=empate (humano escolhe) | 'revisar'=sem identificação
-- | 'quase_la'=dentro da tolerância | 'fraco'/NULL.
CREATE OR REPLACE FUNCTION public.fn_conciliacao_qualidade(
  p_score numeric,
  p_qtd_candidatos int,
  p_identificado boolean,
  p_corte int DEFAULT 90
) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_score IS NULL THEN NULL
    WHEN p_score >= p_corte AND COALESCE(p_qtd_candidatos,0) > 1 THEN 'ambiguo'
    WHEN p_score >= p_corte AND NOT COALESCE(p_identificado,false) THEN 'revisar'
    WHEN p_score >= p_corte THEN 'exato'
    WHEN p_score >= 60 THEN 'quase_la'
    ELSE 'fraco'
  END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- REWRITE — fn_conciliacao_rodar_lote: só auto-aplica quando 'exato'.
-- Mantém a blindagem anti-colisão existente. Ambiguo/revisar ficam PENDENTES com
-- motivo_status carimbado pra tela. Novos contadores no retorno.
DROP FUNCTION IF EXISTS public.fn_conciliacao_rodar_lote(uuid, uuid, boolean, integer, integer);
CREATE FUNCTION public.fn_conciliacao_rodar_lote(
  p_company_id uuid,
  p_lote_id uuid DEFAULT NULL::uuid,
  p_auto_aplicar boolean DEFAULT NULL::boolean,
  p_score_auto integer DEFAULT 90,
  p_limite integer DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_mov RECORD; v_best RECORD;
  v_processados int:=0; v_com_sugestao int:=0; v_perfeitos int:=0; v_quase int:=0;
  v_sem_match int:=0; v_auto_conc int:=0; v_colisao_pulada int:=0; v_auto_off int:=0;
  v_ambiguo int:=0; v_revisar int:=0;
  v_lancs_usados text[]:='{}'; v_chave text; v_deve_auto boolean; v_corte int;
  v_qtd int; v_ident boolean; v_qualidade text;
BEGIN
  FOR v_mov IN
    SELECT m.id, m.lote_id, m.descricao, m.natureza,
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

    v_corte := CASE WHEN p_auto_aplicar IS NOT NULL THEN p_score_auto ELSE v_mov.score_efetivo END;
    v_qtd   := fn_conciliacao_qtd_candidatos(v_mov.id);
    v_ident := fn_conciliacao_identificado(v_mov.descricao, v_best.contraparte);
    v_qualidade := fn_conciliacao_qualidade(v_best.match_score, v_qtd, v_ident, v_corte);

    -- carimba sugestão + qualidade pra tela (sem conciliar ainda)
    UPDATE conciliacao_movimento
       SET psgc_sugestao=v_best.lancamento_tabela||':'||v_best.lancamento_id,
           psgc_confianca=v_best.match_score,
           motivo_status=v_qualidade,
           updated_at=now()
     WHERE id=v_mov.id;
    v_com_sugestao:=v_com_sugestao+1;

    IF v_best.match_score>=90 THEN v_perfeitos:=v_perfeitos+1;
    ELSIF v_best.match_score>=60 THEN v_quase:=v_quase+1; END IF;

    v_deve_auto:=COALESCE(p_auto_aplicar, v_mov.auto_efetivo);

    -- DUPLA IDENTIFICAÇÃO: só auto-aplica 'exato' (score + único + identificado)
    IF v_qualidade='exato' THEN
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
    ELSIF v_qualidade='ambiguo' THEN v_ambiguo:=v_ambiguo+1;
    ELSIF v_qualidade='revisar' THEN v_revisar:=v_revisar+1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'company_id',p_company_id,
    'modo_auto',CASE WHEN p_auto_aplicar IS NULL THEN 'preferencia_usuario' ELSE 'override_manual' END,
    'processados',v_processados,'com_sugestao',v_com_sugestao,'perfeitos',v_perfeitos,
    'quase',v_quase,'sem_match',v_sem_match,'auto_conciliados',v_auto_conc,
    'colisao_pulada',v_colisao_pulada,'auto_desligado',v_auto_off,
    'ambiguo_revisao',v_ambiguo,'revisar_identificacao',v_revisar,
    'rodado_em',now());
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- REWRITE — fn_conciliacao_inbox: expõe qualidade + qtd_candidatos p/ a tela
-- mostrar 'ambiguo' com candidatos lado a lado. Signature muda -> DROP+CREATE.
DROP FUNCTION IF EXISTS public.fn_conciliacao_inbox(uuid, uuid, text, integer);
CREATE FUNCTION public.fn_conciliacao_inbox(
  p_lote_id uuid DEFAULT NULL::uuid,
  p_company_id uuid DEFAULT NULL::uuid,
  p_status text DEFAULT 'pendente'::text,
  p_limite integer DEFAULT 50
) RETURNS TABLE(
  movimento_id uuid, lote_nome text, tipo_lote text, data_transacao date, valor numeric,
  descricao text, natureza text, status text,
  sugestao_lancamento_tabela text, sugestao_lancamento_id uuid, sugestao_data date,
  sugestao_valor numeric, sugestao_contraparte text, sugestao_score numeric,
  sugestao_categoria text, sugestao_qualidade text, sugestao_qtd_candidatos integer
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id, cl.nome, cl.tipo, m.data_transacao, m.valor, m.descricao, m.natureza, m.status,
    s.lancamento_tabela, s.lancamento_id, s.data_lancamento, s.valor_lancamento,
    s.contraparte, s.match_score, s.match_categoria,
    fn_conciliacao_qualidade(
      s.match_score,
      qc.qtd,
      fn_conciliacao_identificado(m.descricao, s.contraparte),
      90
    ) AS sugestao_qualidade,
    qc.qtd AS sugestao_qtd_candidatos
  FROM conciliacao_movimento m
  JOIN conciliacao_lote cl ON cl.id = m.lote_id
  LEFT JOIN LATERAL (
    SELECT * FROM fn_conciliacao_sugerir_match(m.id, 1) LIMIT 1
  ) s ON TRUE
  LEFT JOIN LATERAL (
    SELECT fn_conciliacao_qtd_candidatos(m.id) AS qtd
  ) qc ON TRUE
  WHERE (p_lote_id IS NULL OR m.lote_id = p_lote_id)
    AND (p_company_id IS NULL OR m.company_id = p_company_id)
    AND (p_status IS NULL OR m.status = p_status)
  ORDER BY
    CASE WHEN s.match_score >= 90 THEN 1 ELSE 2 END,
    s.match_score DESC NULLS LAST,
    m.data_transacao DESC
  LIMIT p_limite;
END;
$$;
