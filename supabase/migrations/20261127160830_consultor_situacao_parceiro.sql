-- =====================================================================
-- feat(consultor-ia): situação de UM cliente/fornecedor com explicação (por quê) + recálculo dos títulos
-- parciais já quitados.  CEO + Eng. Chefe 25/11 (empresa piloto P&M ao vivo).  label hub.
--
-- Contexto (RD-38, auditado no banco): a pergunta "por que o saldo do IGP está negativo se ele pagou o boleto
-- com juros" caía em {"tool":"nenhuma"} → "Não entendi". Duas causas:
--   (1) o Consultor IA não tinha ferramenta "situação de um cliente/fornecedor" nem explicava "por quê";
--   (2) 2 títulos (2 empresas) ficaram status='parcial' com valor_pago >= valor - desconto porque a baixa foi
--       gravada ANTES da correção #10136 (migration 20261121130120) e a conciliação de 24/11 mexeu só em
--       conciliado/movimento_banco_id (que não disparam o trg_status). Sobra um saldo de juros "em aberto".
--
-- Esta migration é ADITIVA (RD-97) — só cria função, tabela de log e chave de ajuda:
--   (b) fn_consultor_situacao_parceiro: títulos + totais + DIAGNÓSTICOS determinísticos (por quê) + links.
--   (c) consultor_ia_pergunta_log: registro das perguntas (entendeu/tool) para o Eng. Chefe ampliar o catálogo.
--       LGPD: guarda SÓ a pergunta e a ferramenta — nunca o dado do resultado. Retenção 180 dias.
--   (d) chave de ajuda RD-95 do atalho novo "Situação de um cliente".
--
-- (a) RECÁLCULO DOS TÍTULOS PARCIAIS JÁ QUITADOS — correção de DADO, não de schema, aplicada DIRETO na produção
--     (2 títulos, autorizada pelo CEO), fora desta migration para mantê-la aditiva (RD-97). O comando foi
--     `UPDATE public.erp_receber SET valor_pago = valor_pago WHERE deleted_at IS NULL AND status='parcial'
--      AND valor_pago>0 AND round(valor_pago,2) >= round(valor - COALESCE(desconto,0),2);` (idem erp_pagar),
--     que re-dispara o trg_status (UPDATE OF valor_pago) e recalcula o status pela regra #10136 (valor original
--     pago ⇒ 'pago'). Prova RD-38 (antes 2→depois 0) no corpo da PR. Títulos novos já nascem certos (o trigger
--     corrige na própria baixa), então não há o que reproduzir em banco limpo.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- (c) LOG DE PERGUNTAS NÃO ENTENDIDAS / ENTENDIDAS (LGPD: só a pergunta e a ferramenta, nunca o resultado)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.consultor_ia_pergunta_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id     uuid,
  pergunta    text NOT NULL,
  tool_escolhida text,
  entendeu    boolean NOT NULL DEFAULT false,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.consultor_ia_pergunta_log IS
  'Consultor IA: perguntas e a ferramenta escolhida (entendeu=true/false). LGPD: só a pergunta, nunca o dado do resultado. Retenção 180 dias (purga pela rotina de retenção).';
CREATE INDEX IF NOT EXISTS ix_consultor_pergunta_log_empresa ON public.consultor_ia_pergunta_log (company_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS ix_consultor_pergunta_log_retencao ON public.consultor_ia_pergunta_log (criado_em);

ALTER TABLE public.consultor_ia_pergunta_log ENABLE ROW LEVEL SECURITY;
-- MV/LGPD: fora do service_role, só LEITURA e só das empresas do próprio usuário (o Eng. Chefe/PS lê por is_admin()).
REVOKE ALL ON public.consultor_ia_pergunta_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.consultor_ia_pergunta_log TO authenticated;
GRANT ALL ON public.consultor_ia_pergunta_log TO service_role;

DROP POLICY IF EXISTS consultor_pergunta_log_sel ON public.consultor_ia_pergunta_log;
CREATE POLICY consultor_pergunta_log_sel ON public.consultor_ia_pergunta_log
  FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
-- Escrita só pela conexão de serviço (a rota valida usuário + empresa antes de gravar); sem policy de INSERT/UPDATE/DELETE
-- para usuário logado → RLS barra qualquer escrita por chave pública.

-- ─────────────────────────────────────────────────────────────────────
-- (b) SITUAÇÃO DE UM PARCEIRO (cliente OU fornecedor): títulos, totais, diagnósticos e links.
--     SECURITY DEFINER + STABLE + guarda de empresa (mesmo padrão de fn_consultor_lancamentos_detalhe).
--     Leitura pura (não grava) → fora da regra 4 do check:fn-guards; mesmo assim confere a empresa.
--     CPF/CNPJ só aparece sem máscara para interno/service_role ou papel gerencial (OWNER/MANAGER).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_consultor_situacao_parceiro(
  p_company_id uuid, p_termo text, p_tipo text DEFAULT 'auto'
) RETURNS jsonb
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $fn$
DECLARE
  v_interno boolean := coalesce(current_setting('request.jwt.claims', true), '') = '';
  v_tipo  text := lower(btrim(coalesce(p_tipo, 'auto')));
  v_termo text := NULLIF(btrim(coalesce(p_termo, '')), '');
  v_dig   text;
  v_hoje  date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_de    date;
  v_pode_doc boolean;
  v_papel text;
  v_n     int;
  v_parceiros jsonb;
  v_pnat  text; v_pid uuid; v_pnome text; v_pdoc text; v_pcidade text;
  v_titulos jsonb; v_diag jsonb; v_tot jsonb;
BEGIN
  IF p_company_id IS NULL OR NOT (v_interno OR auth.role() = 'service_role' OR p_company_id IN (SELECT get_user_company_ids())) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso');
  END IF;
  IF v_tipo NOT IN ('cliente', 'fornecedor', 'auto') THEN v_tipo := 'auto'; END IF;
  IF v_termo IS NULL OR length(v_termo) < 2 THEN
    RETURN jsonb_build_object('ok', true, 'encontrou', false, 'motivo', 'termo_curto');
  END IF;
  v_dig := NULLIF(regexp_replace(v_termo, '\D', '', 'g'), '');
  v_de  := v_hoje - 365;

  -- quem pode ver o documento sem máscara
  v_papel := (SELECT fn_acesso_efetivo(auth.uid(), p_company_id) ->> 'papel_gestao');
  v_pode_doc := v_interno OR auth.role() = 'service_role' OR coalesce(v_papel, '') IN ('CLIENT_OWNER', 'CLIENT_MANAGER');

  -- ── localizar o parceiro (cliente e/ou fornecedor) ──────────────────────────────
  WITH cand AS (
    SELECT 'cliente'::text AS natureza, c.id,
           COALESCE(NULLIF(btrim(c.nome_fantasia), ''), NULLIF(btrim(c.razao_social), ''), '—') AS nome,
           COALESCE(NULLIF(btrim(c.cnpj_cpf), ''), NULLIF(btrim(c.cpf_cnpj), '')) AS doc, c.cidade
      FROM erp_clientes c
     WHERE v_tipo IN ('cliente', 'auto') AND c.company_id = p_company_id AND COALESCE(c.ativo, true)
       AND ( c.nome_fantasia ILIKE '%' || v_termo || '%' OR c.razao_social ILIKE '%' || v_termo || '%'
          OR (v_dig IS NOT NULL AND regexp_replace(COALESCE(c.cnpj_cpf, c.cpf_cnpj, ''), '\D', '', 'g') LIKE '%' || v_dig || '%') )
    UNION ALL
    SELECT 'fornecedor', f.id,
           COALESCE(NULLIF(btrim(f.nome_fantasia), ''), NULLIF(btrim(f.razao_social), ''), '—'),
           COALESCE(NULLIF(btrim(f.cnpj_cpf), ''), NULLIF(btrim(f.cpf_cnpj), '')), f.cidade
      FROM erp_fornecedores f
     WHERE v_tipo IN ('fornecedor', 'auto') AND f.company_id = p_company_id AND COALESCE(f.ativo, true)
       AND ( f.nome_fantasia ILIKE '%' || v_termo || '%' OR f.razao_social ILIKE '%' || v_termo || '%'
          OR (v_dig IS NOT NULL AND regexp_replace(COALESCE(f.cnpj_cpf, f.cpf_cnpj, ''), '\D', '', 'g') LIKE '%' || v_dig || '%') )
  ),
  cand_fmt AS (
    SELECT natureza, id, nome, cidade, doc,
           CASE WHEN doc IS NULL THEN NULL
                WHEN length(regexp_replace(doc, '\D', '', 'g')) <= 4 THEN repeat('•', length(regexp_replace(doc, '\D', '', 'g')))
                ELSE repeat('•', length(regexp_replace(doc, '\D', '', 'g')) - 4) || right(regexp_replace(doc, '\D', '', 'g'), 4)
           END AS doc_masc
      FROM cand
  )
  SELECT count(*),
         jsonb_agg(jsonb_build_object('tipo', natureza, 'id', id, 'nome', nome, 'cidade', cidade,
            'documento', CASE WHEN v_pode_doc THEN doc ELSE NULL END,
            'documento_mascarado', doc_masc) ORDER BY nome)
    INTO v_n, v_parceiros
  FROM cand_fmt;

  IF coalesce(v_n, 0) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'encontrou', false, 'motivo', 'nao_encontrado', 'termo', v_termo);
  END IF;
  IF v_n > 1 THEN
    RETURN jsonb_build_object('ok', true, 'encontrou', false, 'motivo', 'varios', 'termo', v_termo, 'opcoes', v_parceiros);
  END IF;

  SELECT (p ->> 'tipo'), (p ->> 'id')::uuid, (p ->> 'nome'), (p ->> 'documento'), (p ->> 'cidade')
    INTO v_pnat, v_pid, v_pnome, v_pdoc, v_pcidade
  FROM jsonb_array_elements(v_parceiros) p LIMIT 1;

  -- ── títulos do parceiro (últimos 12 meses + futuros) com diagnósticos determinísticos ──────────
  WITH base AS (
    SELECT r.id, 'receber'::text AS natureza, r.data_vencimento, r.valor,
           COALESCE(r.juros, 0) AS juros, COALESCE(r.multa, 0) AS multa, COALESCE(r.desconto, 0) AS desconto,
           COALESCE(r.valor_pago, 0) AS valor_pago, lower(coalesce(r.status, '')) AS status,
           COALESCE(r.conciliado, false) AS conciliado, r.origem_baixa, r.numero_documento, r.numero_nf, r.descricao,
           '/dashboard/financeiro/nova-receita?editar=' || r.id::text AS link
      FROM erp_receber r
     WHERE v_pnat = 'cliente' AND r.company_id = p_company_id AND r.cliente_id = v_pid AND r.deleted_at IS NULL
       AND lower(coalesce(r.status, '')) NOT IN ('cancelado', 'orcamento', 'renegociado')
       AND (r.data_vencimento >= v_de OR lower(coalesce(r.status, '')) NOT IN ('pago', 'recebido'))
    UNION ALL
    SELECT p.id, 'pagar'::text, p.data_vencimento, p.valor,
           COALESCE(p.juros, 0), COALESCE(p.multa, 0), COALESCE(p.desconto, 0),
           COALESCE(p.valor_pago, 0), lower(coalesce(p.status, '')),
           COALESCE(p.conciliado, false), p.origem_baixa, p.numero_documento, p.numero_nf, p.descricao,
           '/dashboard/financeiro/nova-despesa?editar=' || p.id::text
      FROM erp_pagar p
     WHERE v_pnat = 'fornecedor' AND p.company_id = p_company_id AND p.fornecedor_id = v_pid AND p.deleted_at IS NULL
       AND lower(coalesce(p.status, '')) NOT IN ('cancelado')
       AND (p.data_vencimento >= v_de OR lower(coalesce(p.status, '')) NOT IN ('pago'))
  ),
  calc AS (
    SELECT b.*,
           round(b.valor + b.juros + b.multa - b.desconto - b.valor_pago, 2) AS saldo,
           round(b.valor - b.desconto, 2) AS valor_original,
           -- crédito do banco conciliado > valor_pago do título, sem taxa de adquirente e com movimento ligado SÓ a este título
           (SELECT jb.mov_valor FROM (
              SELECT m.valor AS mov_valor, COALESCE(m.adq_taxa_valor, 0) AS taxa,
                     (SELECT count(*) FROM conciliacao_vinculo v2 WHERE v2.movimento_id = cv.movimento_id) AS n
                FROM conciliacao_vinculo cv JOIN conciliacao_movimento m ON m.id = cv.movimento_id
               WHERE cv.lancamento_tabela = ('erp_' || b.natureza) AND cv.lancamento_id = b.id
                 AND m.status = 'conciliado'
               LIMIT 1) jb
             WHERE jb.taxa = 0 AND jb.n = 1 AND jb.mov_valor > round(b.valor_pago, 2) + 0.01) AS mov_credito
      FROM base b
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', c.id, 'natureza', c.natureza, 'vencimento', c.data_vencimento, 'valor', c.valor,
      'juros', c.juros, 'multa', c.multa, 'desconto', c.desconto, 'valor_pago', c.valor_pago,
      'saldo', c.saldo, 'status', c.status, 'conciliado', c.conciliado, 'origem_baixa', c.origem_baixa,
      'numero_documento', c.numero_documento, 'numero_nf', c.numero_nf, 'descricao', c.descricao, 'link', c.link
    ) ORDER BY c.data_vencimento DESC NULLS LAST, c.valor DESC), '[]'::jsonb),
    -- diagnósticos (um por título que se enquadra), com o número bruto; a frase em PT é montada no servidor (rota).
    COALESCE((SELECT jsonb_agg(d ORDER BY (d ->> 'prioridade')::int) FROM (
      SELECT jsonb_build_object('codigo', 'pago_com_juros_parcial', 'prioridade', 1, 'titulo_id', c.id, 'natureza', c.natureza,
               'link', c.link, 'numero', COALESCE(c.numero_documento, c.numero_nf), 'vencimento', c.data_vencimento,
               'valor_pago', c.valor_pago, 'juros_multa', round(c.juros + c.multa, 2), 'saldo', c.saldo, 'status', c.status) AS d
        FROM calc c
       WHERE c.valor_pago > 0 AND round(c.valor_pago, 2) >= c.valor_original
         AND c.status NOT IN ('pago', 'recebido', 'cancelado', 'orcamento', 'renegociado', 'estornado', 'previsto')
      UNION ALL
      SELECT jsonb_build_object('codigo', 'saldo_negativo', 'prioridade', 2, 'titulo_id', c.id, 'natureza', c.natureza,
               'link', c.link, 'numero', COALESCE(c.numero_documento, c.numero_nf), 'vencimento', c.data_vencimento,
               'saldo', c.saldo, 'a_mais', round(-c.saldo, 2))
        FROM calc c WHERE c.saldo < -0.005
      UNION ALL
      SELECT jsonb_build_object('codigo', 'juros_nao_lancados', 'prioridade', 3, 'titulo_id', c.id, 'natureza', c.natureza,
               'link', c.link, 'numero', COALESCE(c.numero_documento, c.numero_nf), 'vencimento', c.data_vencimento,
               'credito_banco', c.mov_credito, 'valor_pago', c.valor_pago, 'diferenca', round(c.mov_credito - c.valor_pago, 2))
        FROM calc c WHERE c.mov_credito IS NOT NULL AND round(c.juros + c.multa, 2) = 0
      UNION ALL
      SELECT jsonb_build_object('codigo', 'pago_sem_conciliar', 'prioridade', 4, 'titulo_id', c.id, 'natureza', c.natureza,
               'link', c.link, 'numero', COALESCE(c.numero_documento, c.numero_nf), 'vencimento', c.data_vencimento,
               'valor_pago', c.valor_pago)
        FROM calc c WHERE c.status IN ('pago', 'recebido') AND NOT c.conciliado
      UNION ALL
      SELECT jsonb_build_object('codigo', 'vencido_em_aberto', 'prioridade', 5, 'titulo_id', c.id, 'natureza', c.natureza,
               'link', c.link, 'numero', COALESCE(c.numero_documento, c.numero_nf), 'vencimento', c.data_vencimento,
               'saldo', c.saldo, 'dias', (v_hoje - c.data_vencimento))
        FROM calc c WHERE c.saldo > 0.005 AND c.data_vencimento < v_hoje
         AND c.status NOT IN ('pago', 'recebido', 'cancelado', 'orcamento', 'renegociado')
    ) d), '[]'::jsonb),
    jsonb_build_object(
      'em_aberto',   COALESCE(sum(c.saldo) FILTER (WHERE c.saldo > 0.005 AND c.status NOT IN ('pago', 'recebido', 'cancelado', 'orcamento', 'renegociado')), 0),
      'vencido',     COALESCE(sum(c.saldo) FILTER (WHERE c.saldo > 0.005 AND c.data_vencimento < v_hoje AND c.status NOT IN ('pago', 'recebido', 'cancelado', 'orcamento', 'renegociado')), 0),
      'pago_periodo',COALESCE(sum(c.valor_pago) FILTER (WHERE c.status IN ('pago', 'recebido')), 0),
      'juros_receber', COALESCE(sum(c.juros) FILTER (WHERE c.natureza = 'receber'), 0),
      'juros_pagar',   COALESCE(sum(c.juros) FILTER (WHERE c.natureza = 'pagar'), 0)
    )
    INTO v_titulos, v_diag, v_tot
  FROM calc c;

  RETURN jsonb_build_object(
    'ok', true, 'encontrou', true, 'pode_ver_documento', v_pode_doc,
    'parceiro', jsonb_build_object('tipo', v_pnat, 'id', v_pid, 'nome', v_pnome, 'cidade', v_pcidade,
       'documento', CASE WHEN v_pode_doc THEN v_pdoc ELSE NULL END,
       'documento_mascarado', (v_parceiros -> 0 ->> 'documento_mascarado')),
    'titulos', v_titulos, 'totais', v_tot, 'diagnosticos', v_diag
  );
END $fn$;

REVOKE ALL ON FUNCTION public.fn_consultor_situacao_parceiro(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_consultor_situacao_parceiro(uuid, text, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- (d) RD-95 — "?" do atalho novo "Situação de um cliente"
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES (
  'inteligencia.consultor.situacao_parceiro', '/dashboard/consultor-ia', 'Consultor', 'Situação de um cliente ou fornecedor',
  'Digite o nome ou o CNPJ/CPF de UM cliente ou fornecedor.',
  'Mostra os títulos dele (a receber ou a pagar), quanto está em aberto, vencido e pago, e explica POR QUE o saldo está assim: pago com juros, pago a mais, pago sem conciliar ou vencido — com link para abrir e corrigir.',
  'Situação do cliente IGP  ·  por que o saldo da Transportadora X está negativo?',
  'Escrever a pergunta inteira sem citar o nome: diga o nome (ou CNPJ) do cliente/fornecedor para eu localizar a pessoa certa.',
  'nucleo', 30, 'publicado'
)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo, o_que_preencher = EXCLUDED.o_que_preencher,
  para_que_serve = EXCLUDED.para_que_serve, exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  vertical = EXCLUDED.vertical, ordem = EXCLUDED.ordem, status = 'publicado', atualizado_em = now();
