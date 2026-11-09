-- Revenda › Vendas (/dashboard/revenda/vendas) — fecha os 2 gaps que seguram o selo (aud8 09/11, score 90).
--
-- Gaps apontados pelo auditor:
--   1. RD-98 p3 (origem do dado): system_screens.views_consumidas e rpcs_chamadas VAZIOS.
--   2. RD-95 (cobertura parcial): os indicadores de FINANCIAMENTO ("retorno banco" e "desconto
--      embutido na troca") ainda sem "?" — a ajuda existente (revenda.vendas.em_aberto) cobre só
--      "cliente deve / banco deve / recebido".
--
-- Esta migration é ADITIVA e IDEMPOTENTE — só metadado de catálogo (system_screens) e de ajuda
-- (erp_ajuda_campo). Nenhum dado de cliente, schema, RLS ou permissão.
-- Valores extraídos do código vivo de src/app/dashboard/revenda/vendas/page.tsx (RD-38):
--   .from()  -> v_veic_venda, veic_venda_recebimento, erp_receber
--   .rpc()   -> fn_veic_venda_acerto, fn_veic_venda_checklist_materializar, fn_veic_checklist_marcar,
--               fn_veic_venda_entregar, fn_veic_termo_entrega, fn_veic_termo_assinar,
--               fn_veic_venda_devolver, fn_veic_venda_cancelar, fn_receber_cancelar
--   AjudaCampo -> fn_ajuda_campo_listar, fn_ajuda_campo_uso
-- Code: dev7claudeps

-- 1) Origem do dado (RD-98 p3)
UPDATE public.system_screens SET
  views_consumidas = ARRAY['v_veic_venda','veic_venda_recebimento','erp_receber']::text[],
  rpcs_chamadas = ARRAY[
    'fn_veic_venda_acerto','fn_veic_venda_checklist_materializar','fn_veic_checklist_marcar',
    'fn_veic_venda_entregar','fn_veic_termo_entrega','fn_veic_termo_assinar',
    'fn_veic_venda_devolver','fn_veic_venda_cancelar','fn_receber_cancelar',
    'fn_ajuda_campo_listar','fn_ajuda_campo_uso'
  ]::text[]
WHERE rota = '/dashboard/revenda/vendas';

-- 2) Ajuda "?" dos indicadores de financiamento (RD-95)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
('revenda.vendas.financiamento','Vendas e entrega','Retorno do banco e troca',
 'Nada a preencher — são indicadores calculados da venda financiada ou com troca. "Retorno banco" é o valor que o banco repassa à loja pela intermediação do financiamento; "desconto embutido na troca" é quanto o carro recebido na troca foi aceito acima do valor de avaliação (valor de troca − valor de avaliação).',
 'Mostra o ganho extra do financiamento e o custo escondido na negociação da troca, para você enxergar o resultado real da venda além do preço de tabela.',
 'Ver "retorno banco R$ 1.200" numa venda financiada e "desconto embutido na troca R$ 3.000" quando o usado foi aceito por mais do que vale.',
 'Confundir "retorno banco" (entra para a loja) com "banco deve" (o que o banco ainda não repassou): o primeiro é resultado, o segundo é saldo em aberto.',
 8,'/dashboard/revenda/vendas','revenda','publicado')
ON CONFLICT (chave) DO NOTHING;
