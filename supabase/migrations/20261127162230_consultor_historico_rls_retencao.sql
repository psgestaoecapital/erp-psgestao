-- =====================================================================
-- sec(consultor): histórico só com chaves seguras + log por dono/gestor + retenção de sessão (auditoria #6221, Eng. Chefe 25/11)
-- Aplica DEPOIS de 20261127162010 (CREATE OR REPLACE dos objetos da camada consultor). consultor_ia_consulta e as
-- views da camada não são tabela de domínio (RD-97 ok). Separada do conserto #6221 para não editar o mesmo arquivo.
-- =====================================================================

-- (a) consultor.historico_titulo: valor_anterior/valor_novo só com as chaves seguras do título — NUNCA chave_pix,
--     linha digitável, código de barras, QR code ou dados bancários. Filtra por whitelist; não-objeto → NULL.
CREATE OR REPLACE VIEW consultor.historico_titulo WITH (security_barrier = true) AS
  SELECT a.id, a.company_id, a.tabela, a.registro_id AS titulo_id, a.created_at AS quando,
         split_part(COALESCE(a.user_email, ''), '@', 1) AS quem,
         CASE lower(a.acao) WHEN 'insert' THEN 'CRIOU' WHEN 'update' THEN 'ALTEROU' WHEN 'delete' THEN 'EXCLUIU'
              ELSE upper(a.acao) END AS acao,
         CASE WHEN jsonb_typeof(a.valor_anterior) = 'object'
              THEN (SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(a.valor_anterior) e
                     WHERE e.key = ANY (ARRAY['status','valor','valor_pago','juros','multa','desconto','data_vencimento',
                       'data_pagamento','conciliado','origem_baixa','movimento_banco_id','boleto_status','categoria']))
              ELSE NULL END AS valor_anterior,
         CASE WHEN jsonb_typeof(a.valor_novo) = 'object'
              THEN (SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(a.valor_novo) e
                     WHERE e.key = ANY (ARRAY['status','valor','valor_pago','juros','multa','desconto','data_vencimento',
                       'data_pagamento','conciliado','origem_baixa','movimento_banco_id','boleto_status','categoria']))
              ELSE NULL END AS valor_novo
    FROM public.audit_log_global a
   WHERE a.tabela IN ('erp_receber', 'erp_pagar')
     AND a.company_id = consultor.empresa_atual()
     AND a.created_at >= now() - interval '120 days';

-- (b) consultor_ia_consulta: leitura só is_admin() / próprio usuário / dono-gestor da empresa (igual #6213).
--     Usuário comum não lê a consulta de outro usuário.
DROP POLICY IF EXISTS consultor_ia_consulta_sel ON public.consultor_ia_consulta;
CREATE POLICY consultor_ia_consulta_sel ON public.consultor_ia_consulta FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR ( company_id IN (SELECT public.get_user_company_ids())
         AND coalesce(public.fn_acesso_efetivo(auth.uid(), company_id) ->> 'papel_gestao', '') IN ('CLIENT_OWNER', 'CLIENT_MANAGER') )
  );

-- (c) retenção: além do log de consultas > 180 dias, apaga consultor.sessao > 1 dia (vínculo empresa×txid é efêmero).
CREATE OR REPLACE FUNCTION public.fn_consultor_log_retencao()
 RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (DELETE FROM public.consultor_ia_consulta WHERE created_at < now() - interval '180 days' RETURNING 1),
       s AS (DELETE FROM consultor.sessao WHERE criado_em < now() - interval '1 day' RETURNING 1)
  SELECT (SELECT count(*) FROM d) + (SELECT count(*) FROM s)
$$;
REVOKE ALL ON FUNCTION public.fn_consultor_log_retencao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_consultor_log_retencao() TO service_role;
