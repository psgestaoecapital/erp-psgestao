-- Chamado #3281 (Gean, piloto; vale para todas as empresas) — relatórios longos em SEGUNDO PLANO. ETAPA 2: o gerador.
-- A etapa 1 (20261017024020) criou a fila erp_relatorio_pedido e a tela "Meus relatórios". Esta etapa faz o arquivo
-- existir: a rota /api/relatorios/fila (Vercel, Node) pega o pedido da fila, monta o Excel da "Movimentação financeira"
-- e grava no bucket privado "relatorios" (validade de 7 dias, já controlada pela fila). Migration ADITIVA:
--   1) bucket privado "relatorios" + policy de LEITURA só do próprio arquivo (pasta {empresa}/{solicitante}/...);
--   2) fn_relatorio_movimentacao_linhas — as linhas do relatório, com a MESMA regra do saldo por conta (RD-65/RD-71:
--      cada baixa ativa é um lançamento; título quitado legado sem baixa entra pelo valor_pago na data_pagamento;
--      título e baixa excluídos ficam fora) + as transferências entre contas. Só service_role (o gerador);
--   3) fn_relatorio_fila_dispatch + pg_cron a cada 2 min: só chama a rota quando HÁ pedido na fila (sem pedido,
--      nenhuma chamada sai — custo zero parado, RD-42).
-- Nada existente é alterado.

-- ───────────────────────────── 1) Bucket privado ─────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('relatorios', 'relatorios', false, 52428800, NULL)
ON CONFLICT (id) DO NOTHING;

-- Caminho: {company_id}/{solicitante}/{pedido_id}.xlsx. Quem está logado só LÊ (gera o link de download) o arquivo
-- da própria pasta, de empresa a que tem acesso. Gravar e apagar é só do gerador (service_role ignora a RLS).
DROP POLICY IF EXISTS relatorios_ler_proprio ON storage.objects;
CREATE POLICY relatorios_ler_proprio ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'relatorios'
         AND (storage.foldername(name))[2] = auth.uid()::text
         AND (storage.foldername(name))[1] IN (SELECT public.get_user_company_ids()::text));

-- ───────────────────────────── 2) Linhas da Movimentação financeira ─────────────────────────────
-- ci-sem-guarda: fn_relatorio_movimentacao_linhas — só service_role (gerador da fila, sem usuário logado); a empresa vem do pedido, conferido na entrada (fn_relatorio_pedir). Não grava nada.
CREATE OR REPLACE FUNCTION public.fn_relatorio_movimentacao_linhas(p_company_id uuid, p_data_inicio date, p_data_fim date)
RETURNS TABLE(chave text, data date, tipo text, pessoa text, descricao text, categoria text, documento text,
              conta text, forma text, entrada numeric, saida numeric, transferido numeric, origem text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH rbx AS (
    SELECT b.id, b.receber_id AS tid, b.valor, b.data, b.forma, b.origem
      FROM erp_receber_baixa b
     WHERE b.company_id = p_company_id AND b.deleted_at IS NULL
  ),
  pbx AS (
    SELECT b.id, b.pagar_id AS tid, b.valor, b.data, b.forma, b.origem
      FROM erp_pagar_baixa b
     WHERE b.company_id = p_company_id AND b.deleted_at IS NULL
  ),
  rtit AS (
    SELECT er.*, EXISTS (SELECT 1 FROM rbx WHERE rbx.tid = er.id) AS tem_baixa
      FROM erp_receber er
     WHERE er.company_id = p_company_id AND er.deleted_at IS NULL
  ),
  ptit AS (
    SELECT ep.*, EXISTS (SELECT 1 FROM pbx WHERE pbx.tid = ep.id) AS tem_baixa
      FROM erp_pagar ep
     WHERE ep.company_id = p_company_id AND ep.deleted_at IS NULL
  )
  -- recebimentos: cada baixa ativa de título recebido/pago/parcial
  SELECT 'rb:' || b.id, b.data, 'Recebimento', t.cliente_nome::text, t.descricao::text, t.categoria::text,
         coalesce(nullif(t.numero_nf::text,''), t.numero_documento::text), bc.nome::text,
         coalesce(b.forma, t.forma_pagamento::text), b.valor, NULL::numeric, NULL::numeric, coalesce(b.origem, 'baixa')
    FROM rtit t JOIN rbx b ON b.tid = t.id
    LEFT JOIN erp_banco_contas bc ON bc.id = t.conta_bancaria_id
   WHERE t.tem_baixa AND t.status IN ('recebido','pago','parcial') AND b.data BETWEEN p_data_inicio AND p_data_fim
  UNION ALL
  -- recebimentos legados: quitado sem baixa → valor pago na data do pagamento
  SELECT 'r:' || t.id, t.data_pagamento, 'Recebimento', t.cliente_nome::text, t.descricao::text, t.categoria::text,
         coalesce(nullif(t.numero_nf::text,''), t.numero_documento::text), bc.nome::text,
         t.forma_pagamento::text, coalesce(t.valor_pago, t.valor), NULL::numeric, NULL::numeric, 'título quitado'
    FROM rtit t LEFT JOIN erp_banco_contas bc ON bc.id = t.conta_bancaria_id
   WHERE NOT t.tem_baixa AND t.status IN ('recebido','pago') AND t.data_pagamento BETWEEN p_data_inicio AND p_data_fim
  UNION ALL
  -- pagamentos: cada baixa ativa de título pago/parcial
  SELECT 'pb:' || b.id, b.data, 'Pagamento', t.fornecedor_nome::text, t.descricao::text, t.categoria::text,
         coalesce(nullif(t.numero_nf::text,''), t.numero_documento::text), t.conta_bancaria::text,
         coalesce(b.forma, t.forma_pagamento::text), NULL::numeric, b.valor, NULL::numeric, coalesce(b.origem, 'baixa')
    FROM ptit t JOIN pbx b ON b.tid = t.id
   WHERE t.tem_baixa AND t.status IN ('pago','parcial') AND b.data BETWEEN p_data_inicio AND p_data_fim
  UNION ALL
  -- pagamentos legados: quitado sem baixa
  SELECT 'p:' || t.id, t.data_pagamento, 'Pagamento', t.fornecedor_nome::text, t.descricao::text, t.categoria::text,
         coalesce(nullif(t.numero_nf::text,''), t.numero_documento::text), t.conta_bancaria::text,
         t.forma_pagamento::text, NULL::numeric, coalesce(t.valor_pago, t.valor), NULL::numeric, 'título quitado'
    FROM ptit t
   WHERE NOT t.tem_baixa AND t.status = 'pago' AND t.data_pagamento BETWEEN p_data_inicio AND p_data_fim
  UNION ALL
  -- transferências entre contas: não são receita nem despesa (ficam fora de entrada/saída), mas aparecem na lista
  SELECT 'tr:' || tr.id, tr.data, 'Transferência', NULL::text, coalesce(tr.descricao, 'Transferência entre contas'),
         NULL::text, NULL::text, coalesce(o.nome, '?')::text || ' → ' || coalesce(d.nome, '?')::text,
         NULL::text, NULL::numeric, NULL::numeric, tr.valor, 'transferência'
    FROM erp_transferencia tr
    LEFT JOIN erp_banco_contas o ON o.id = tr.conta_origem_id
    LEFT JOIN erp_banco_contas d ON d.id = tr.conta_destino_id
   WHERE tr.company_id = p_company_id AND tr.data BETWEEN p_data_inicio AND p_data_fim
$$;
REVOKE ALL ON FUNCTION public.fn_relatorio_movimentacao_linhas(uuid,date,date) FROM anon, PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_relatorio_movimentacao_linhas(uuid,date,date) TO service_role;

-- ───────────────────────────── 3) Acionador (pg_cron → rota do gerador) ─────────────────────────────
-- Mesmo esquema do fn_ponto_sync_dispatch: autentica na rota com a service key do Vault. Só chama quando há pedido
-- na fila (ou "gerando" vencido, que a fila devolve) — sem pedido, retorna sem sair nenhuma chamada.
CREATE OR REPLACE FUNCTION public.fn_relatorio_fila_dispatch()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_service_role text;
  v_url text := 'https://erp-psgestao.vercel.app/api/relatorios/fila';
  v_request_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM erp_relatorio_pedido
                  WHERE status = 'na_fila'
                     OR (status = 'gerando' AND iniciado_em < now() - interval '30 minutes')) THEN
    RETURN jsonb_build_object('ok', true, 'acionado', false);
  END IF;
  SELECT decrypted_secret INTO v_service_role FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER';
  IF v_service_role IS NULL THEN
    RAISE WARNING 'fn_relatorio_fila_dispatch: vault secret SUPABASE_SERVICE_ROLE_KEY_FOR_WORKER ausente';
    RETURN jsonb_build_object('ok', false, 'erro', 'service_role ausente no vault');
  END IF;
  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_role),
    body := jsonb_build_object('origem', 'pg_cron'),
    timeout_milliseconds := 300000
  ) INTO v_request_id;
  RETURN jsonb_build_object('ok', true, 'acionado', true, 'request_id', v_request_id);
END $$;
REVOKE ALL ON FUNCTION public.fn_relatorio_fila_dispatch() FROM anon, PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_relatorio_fila_dispatch() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'relatorio-fila-gerador') THEN
    PERFORM cron.unschedule('relatorio-fila-gerador');
  END IF;
END $$;
SELECT cron.schedule('relatorio-fila-gerador', '*/2 * * * *', $cron$ SELECT public.fn_relatorio_fila_dispatch(); $cron$);
