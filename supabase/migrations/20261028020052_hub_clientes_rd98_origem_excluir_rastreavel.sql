-- Hub · /dashboard/projetos/clientes — delta até 95 (aud8/Max 27/10, caixa b5327a25 · Code: desenvolvedor_4_g)
-- Foto DEMO 0006 13:41Z: visual 92 (KPIs reais com "?", CRUD à vista, cadeia cliente->obra->resultado). Deltas:
--   (1) "Margem por obra" — PROVADO no dado (RD-38) que é REAL e distinta por obra: v_obra_resultado DEMO 0006 dá
--       margem absoluta diferente por obra (R$ 13.344,90 / 10.296,45 / 11.204,90 / 148.999,40 / 15.927,30). O % ~26%
--       repetido em 4 obras é característica da SEMENTE (mesma razão custo/receita), não hardcode — o selo já mostra o
--       valor absoluto distinto + o %. Nenhuma mudança de código.
--   RD-98 pilar 3 (ORIGEM): a rota estava sem system_screens.views_consumidas/rpcs_chamadas (vazios).
--   RD-98 pilar 4 (EXCLUSÃO RASTREÁVEL): "Excluir" arquivava com update direto (ativo=false) SEM autor/quando/audit.
--       Vira exclusão rastreável: colunas excluido_em/excluido_por (aditivas) + RPC guardada fn_cliente_arquivar que
--       grava quem/quando e um registro em audit_log_global; nunca DELETE físico; a listagem segue filtrando ativo=true
--       (contrato preservado para as outras verticais que usam erp_clientes — não muda a semântica compartilhada).
--
-- Migration: colunas/funções NOVAS (aditivas) em cadastro compartilhado erp_clientes, sem tocar RLS/policies nem a
-- coluna ativo usada pelas outras telas. O front desta tela passa a chamar a RPC em vez do update direto.

ALTER TABLE public.erp_clientes
  ADD COLUMN IF NOT EXISTS excluido_em  timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por uuid;

-- Exclusão rastreável do cliente (arquiva: ativo=false + autor/quando + audit_log). Guarda por empresa como no CRM.
CREATE OR REPLACE FUNCTION public.fn_cliente_arquivar(p_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Entre no sistema para excluir'); END IF;
  SELECT company_id, COALESCE(NULLIF(nome_fantasia,''), razao_social)
    INTO v_company, v_nome
    FROM public.erp_clientes WHERE id = p_id AND ativo = true FOR UPDATE;
  IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Cliente não encontrado ou já arquivado'); END IF;
  IF v_company NOT IN (SELECT get_user_company_ids()) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  UPDATE public.erp_clientes
     SET ativo = false, excluido_em = now(), excluido_por = auth.uid(), updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.audit_log_global (company_id, user_id, tabela, registro_id, acao, valor_anterior, valor_novo)
    VALUES (v_company, auth.uid(), 'erp_clientes', p_id, 'arquivar',
            jsonb_build_object('ativo', true),
            jsonb_build_object('ativo', false, 'nome', v_nome, 'excluido_em', now()));
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.fn_cliente_arquivar(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fn_cliente_arquivar(uuid) TO authenticated;

-- RD-98 p3: origem do dado de src/app/dashboard/projetos/clientes/page.tsx (grep: .from + .rpc)
UPDATE public.system_screens
   SET views_consumidas = ARRAY[
        'erp_clientes',          -- cadastro de clientes da obra (lista filtra ativo=true)
        'projetos_obras',        -- obras de cada cliente (contagem + obra recente)
        'v_obra_resultado',      -- margem prevista por obra (receita - custo), cadeia com o Resultado
        'erp_crm_oportunidade',  -- elo comercial: oportunidades do cliente (filtra deleted_at)
        'erp_orcamentos',        -- propostas do cliente
        'erp_crm_visita',        -- visitas técnicas do funil
        'companies'              -- selo de empresa DEMO
       ]::text[],
       rpcs_chamadas = ARRAY[
        'fn_hub_criar_obra_rapida',  -- criar obra a partir do cliente/oportunidade
        'fn_cliente_arquivar'        -- exclusão rastreável do cliente (RD-98 p4)
       ]::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/projetos/clientes';
