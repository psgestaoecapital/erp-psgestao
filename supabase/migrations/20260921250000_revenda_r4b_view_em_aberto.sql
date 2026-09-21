-- Revenda R4b · v_veic_venda: "em aberto" e "recebido" por devedor (fonte única p/ a tela — RD-65)
--
-- A tela de vendas e fn_veic_venda_acerto precisam mostrar o MESMO "cliente deve / banco deve".
-- total_cliente/total_banco somavam o VALOR contratado do recebimento (12.000 do cliente na HB20),
-- ignorando o que já foi pago. O acerto (R4/seed) já lê erp_receber e mostra em aberto por devedor
-- (6.000 do cliente, pois a entrada foi recebida). Para a tela ler a MESMA fonte sem calcular nada,
-- a view ganha (aditivo, RD-55) colunas novas ao FINAL: em_aberto por devedor, recebido e o estado da
-- entrega (checklist/termo). CREATE OR REPLACE VIEW exige preservar a ordem das colunas existentes e
-- só acrescentar novas ao final — por isso as colunas antigas ficam idênticas e as novas vêm depois.

CREATE OR REPLACE VIEW public.v_veic_venda AS
 SELECT vd.id,
    vd.company_id,
    vd.veiculo_id,
    v.chassi,
    v.modelo,
    v.placa,
    vd.cliente_nome,
    vd.data_venda,
    vd.valor_venda,
    vd.desconto_embutido_troca,
    vd.valor_entrada,
    vd.valor_financiado,
    vd.banco_nome,
    vd.retorno_banco,
    vd.situacao,
    ( SELECT COALESCE(sum(r.valor), 0::numeric)
        FROM veic_venda_recebimento r
       WHERE r.venda_id = vd.id AND r.devedor = 'cliente'::text) AS total_cliente,
    ( SELECT COALESCE(sum(r.valor), 0::numeric)
        FROM veic_venda_recebimento r
       WHERE r.venda_id = vd.id AND r.devedor = 'banco'::text) AS total_banco,
    vd.vendedor_nome,
    vd.created_at,
    (EXISTS ( SELECT 1 FROM erp_nfe_emitidas n WHERE n.id = vd.nfe_id AND n.status = 'autorizada'::text)) AS nfe_autorizada,
    COALESCE(c.is_demo, false) AS is_demo,
    -- ── novas colunas (R4b), sempre ao final ──────────────────────────────────────────────────
    -- EM ABERTO por devedor (fonte única erp_receber; título sem vínculo conta pelo valor do recebimento).
    ( SELECT COALESCE(sum(COALESCE(er.valor, r.valor) - COALESCE(er.valor_pago, 0)), 0::numeric)
        FROM veic_venda_recebimento r LEFT JOIN erp_receber er ON er.id = r.receber_id
       WHERE r.venda_id = vd.id AND r.devedor = 'cliente'::text
         AND (er.status = ANY (ARRAY['aberto','vencido','parcial']) OR er.id IS NULL)) AS em_aberto_cliente,
    ( SELECT COALESCE(sum(COALESCE(er.valor, r.valor) - COALESCE(er.valor_pago, 0)), 0::numeric)
        FROM veic_venda_recebimento r LEFT JOIN erp_receber er ON er.id = r.receber_id
       WHERE r.venda_id = vd.id AND r.devedor = 'banco'::text
         AND (er.status = ANY (ARRAY['aberto','vencido','parcial']) OR er.id IS NULL)) AS em_aberto_banco,
    ( SELECT COALESCE(sum(COALESCE(er.valor_pago, 0)), 0::numeric)
        FROM veic_venda_recebimento r JOIN erp_receber er ON er.id = r.receber_id
       WHERE r.venda_id = vd.id AND er.status = ANY (ARRAY['pago','parcial'])) AS recebido,
    (EXISTS (SELECT 1 FROM veic_venda_checklist ck WHERE ck.venda_id = vd.id)) AS tem_checklist,
    (NOT EXISTS (SELECT 1 FROM veic_venda_checklist ck WHERE ck.venda_id = vd.id AND ck.obrigatorio AND NOT ck.feito)) AS checklist_ok,
    (vd.termo_gerado_em IS NOT NULL) AS tem_termo,
    (vd.assinado_em IS NOT NULL) AS termo_assinado,
    vd.km_entrega,
    vd.devolvido_em,
    vd.devolucao_motivo
   FROM veic_venda vd
     JOIN veic_veiculo v ON v.id = vd.veiculo_id
     JOIN companies c ON c.id = vd.company_id
  WHERE vd.deleted_at IS NULL;
