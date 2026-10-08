-- #2078 Pdois (jordana-code): "Geração de proposta em duplicidade" — uma com o valor e outra zerada.
-- Causa provada no dado: a proposta feita no lead (agency_propostas.lead_id, cliente_id vazio) não era vista ao
-- GANHAR o lead; fn_agency_lead_ganhar só procurava rascunho pelo cliente e criava outra "Proposta — <empresa>" com
-- valor 0 (Magnífica: lead ganho 08/10 12:14:43.257515 = created_at da PROP-2026-0011; DECO: 01/10 18:08:24.394143
-- = PROP-2026-0008). Agora: se o lead já tem proposta viva (não excluída, não recusada), ela é A proposta do negócio —
-- ganha o cliente (se não tiver) e é devolvida; só sem nenhuma proposta o comportamento antigo cria uma.
-- Mesma assinatura, mesma guarda de empresa e search_path; CREATE OR REPLACE mantém os grants (authenticated).
-- Dado existente (as 2 zeradas da Pdois) NÃO é tocado aqui: a Jordana decide se exclui pela tela.
CREATE OR REPLACE FUNCTION public.fn_agency_lead_ganhar(p_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead agency_leads%ROWTYPE; v_cli uuid; v_prop uuid; v_num text; v_seq int;
  v_pref text := 'PROP-' || to_char(current_date,'YYYY') || '-';
BEGIN
  SELECT * INTO v_lead FROM agency_leads WHERE id = p_lead_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'lead não encontrado'); END IF;
  IF NOT (v_lead.company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;

  v_cli := v_lead.cliente_id;
  IF v_cli IS NULL THEN
    INSERT INTO agency_clientes (company_id, nome, nome_fantasia, status, tipo_contrato)
    VALUES (v_lead.company_id, COALESCE(NULLIF(btrim(v_lead.empresa),''), v_lead.nome),
            COALESCE(NULLIF(btrim(v_lead.empresa),''), v_lead.nome), 'ativo', 'recorrente')
    RETURNING id INTO v_cli;
  END IF;

  UPDATE agency_leads SET etapa='ganho', cliente_id=v_cli, atualizado_em=now() WHERE id=p_lead_id;

  -- #2078: a proposta feita no próprio lead é a deste negócio (não cria outra zerada)
  SELECT id INTO v_prop FROM agency_propostas
   WHERE company_id=v_lead.company_id AND lead_id=p_lead_id AND deleted_at IS NULL
     AND status IS DISTINCT FROM 'recusada'
   ORDER BY created_at DESC LIMIT 1;
  IF v_prop IS NOT NULL THEN
    UPDATE agency_propostas SET cliente_id=v_cli, updated_at=now() WHERE id=v_prop AND cliente_id IS NULL;
  END IF;

  IF v_prop IS NULL THEN
    SELECT id INTO v_prop FROM agency_propostas
     WHERE company_id=v_lead.company_id AND cliente_id=v_cli AND status='rascunho' AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1;
  END IF;

  IF v_prop IS NULL THEN
    SELECT COALESCE(MAX((substring(numero from '\d+$'))::int),0)+1 INTO v_seq
      FROM agency_propostas WHERE company_id=v_lead.company_id AND numero LIKE v_pref||'%';
    v_num := v_pref || lpad(v_seq::text, 4, '0');
    INSERT INTO agency_propostas (company_id, cliente_id, lead_id, numero, titulo, itens,
        valor_total, valor_final, condicao_pagamento, status, responsavel_id, observacoes)
    VALUES (v_lead.company_id, v_cli, p_lead_id, v_num,
        'Proposta — ' || COALESCE(NULLIF(btrim(v_lead.empresa),''), v_lead.nome),
        '[]'::jsonb, COALESCE(v_lead.valor_estimado,0), COALESCE(v_lead.valor_estimado,0),
        'Mensal', 'rascunho', v_lead.responsavel_id, 'Gerada do lead ' || v_lead.nome)
    RETURNING id INTO v_prop;
  END IF;

  RETURN jsonb_build_object('ok', true, 'cliente_id', v_cli, 'proposta_id', v_prop);
END $function$;
