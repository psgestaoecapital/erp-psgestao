-- =============================================================
-- FEAT-FORNECEDOR-VENDEDORES-WHATSAPP-v1
-- =============================================================
-- Multiplos vendedores por fornecedor (com WhatsApp) +
-- RPC que monta mensagem de cotacao pronta pra wa.me deep-link.
-- Custo zero (sem API).
--
-- Tabela erp_fornecedor_contatos · RLS pattern de erp_fornecedores
-- (company_id IN user_companies + admin role).
--
-- fn_cotacao_whatsapp_links(cotacao_id) read-only · normaliza fone
-- (so digitos + prefixa 55 se ausente) · monta mensagem com itens
-- e prazo · front faz encodeURIComponent + window.open(wa.me/...).
--
-- Migration aplicada via MCP em 2026-06-12.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.erp_fornecedor_contatos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  fornecedor_id uuid NOT NULL REFERENCES erp_fornecedores(id) ON DELETE CASCADE,
  nome          varchar NOT NULL,
  telefone      varchar,
  cargo         varchar,
  principal     boolean NOT NULL DEFAULT false,
  ativo         boolean NOT NULL DEFAULT true,
  observacoes   text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_forn_contatos_forn
  ON public.erp_fornecedor_contatos(company_id, fornecedor_id);

ALTER TABLE public.erp_fornecedor_contatos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS forn_contatos_all ON public.erp_fornecedor_contatos;
CREATE POLICY forn_contatos_all ON public.erp_fornecedor_contatos
  FOR ALL
  USING (
    (company_id IN (SELECT user_companies.company_id FROM user_companies WHERE user_companies.user_id = auth.uid()))
    OR (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = ANY (ARRAY['adm'::text,'acesso_total'::text,'adm_investimentos'::text])))
  );

CREATE OR REPLACE FUNCTION public.fn_cotacao_whatsapp_links(p_cotacao_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_cot record; v_itens text; v_prazo text; v_msg text;
  v_result jsonb := '[]'::jsonb; v_forn record; v_contato record; v_fone text; v_contatos jsonb;
BEGIN
  SELECT * INTO v_cot FROM erp_cotacoes WHERE id = p_cotacao_id;
  IF v_cot IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Cotacao nao encontrada'); END IF;

  SELECT string_agg('• '||COALESCE(NULLIF(btrim(produto_nome),''), NULLIF(btrim(produto_descricao),''), 'item')
                    ||' — '||COALESCE(quantidade,0)::text||' '||COALESCE(unidade,'UN'),
                    E'\n' ORDER BY ordem NULLS LAST, id)
    INTO v_itens FROM erp_cotacoes_itens WHERE cotacao_id = p_cotacao_id;
  v_itens := COALESCE(v_itens, '(sem itens)');

  v_prazo := CASE WHEN v_cot.data_limite IS NOT NULL
                  THEN E'\nPrazo para resposta: '||to_char(v_cot.data_limite,'DD/MM/YYYY') ELSE '' END;

  FOR v_forn IN
    SELECT fornecedor_id, fornecedor_nome FROM erp_cotacoes_fornecedores WHERE cotacao_id = p_cotacao_id
  LOOP
    v_contatos := '[]'::jsonb;
    FOR v_contato IN
      SELECT nome, telefone, principal FROM erp_fornecedor_contatos
      WHERE fornecedor_id = v_forn.fornecedor_id AND COALESCE(ativo,true)=true
        AND NULLIF(btrim(telefone),'') IS NOT NULL
      ORDER BY principal DESC, nome
    LOOP
      v_fone := regexp_replace(COALESCE(v_contato.telefone,''), '\D', '', 'g');
      IF v_fone <> '' AND left(v_fone,2) <> '55' AND length(v_fone) <= 11 THEN v_fone := '55'||v_fone; END IF;

      v_msg := 'Olá '||COALESCE(v_contato.nome,'')||'! Solicitação de cotação '||COALESCE(v_cot.numero,'')
               ||E'.\n\nItens:\n'||v_itens||v_prazo
               ||E'\n\nPode nos enviar preço unitário, prazo de entrega e condições de pagamento? Obrigado!';

      v_contatos := v_contatos || jsonb_build_object(
        'nome', v_contato.nome, 'telefone', v_fone, 'principal', v_contato.principal, 'mensagem', v_msg);
    END LOOP;

    v_result := v_result || jsonb_build_object(
      'fornecedor_id', v_forn.fornecedor_id, 'fornecedor_nome', v_forn.fornecedor_nome,
      'tem_contato', (jsonb_array_length(v_contatos) > 0), 'contatos', v_contatos);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'cotacao_id', p_cotacao_id, 'numero', v_cot.numero, 'fornecedores', v_result);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_cotacao_whatsapp_links(uuid) TO authenticated;
