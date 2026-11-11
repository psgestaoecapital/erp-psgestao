-- PDCA GE · /dashboard/gestao-empresarial/bens (aud8 58/95)
-- Gap RD-98 #2: editar um bem ZERAVA o valor_residual em silêncio, porque
-- fn_bem_listar não devolvia o campo (a tela carregava '' → salvava 0).
-- Correção: fn_bem_listar passa a devolver valor_residual (aditivo à projeção).
-- + RD-95: chaves de ajuda ("?") dos campos do novo modal de baixa/venda/sinistro.
-- Aditiva e idempotente. Não altera dado de cliente. RLS/guarda de empresa intactas.
-- Code: code-desenvolvedor-3

-- 1) fn_bem_listar: adiciona valor_residual à TABLE de retorno (núcleo).
-- Mudar o tipo de retorno exige DROP antes do CREATE (Postgres não permite trocar
-- as colunas OUT com CREATE OR REPLACE). A assinatura (uuid) e o corpo são preservados.
DROP FUNCTION IF EXISTS public.fn_bem_listar(uuid);
CREATE OR REPLACE FUNCTION public.fn_bem_listar(p_company_id uuid)
 RETURNS TABLE(id uuid, codigo text, descricao text, natureza text, data_aquisicao date, valor_aquisicao numeric, deprecia boolean, vida_util_meses integer, metodo_depreciacao text, business_line_id uuid, business_line_nome text, centro_custo text, status text, dep_acumulada numeric, valor_contabil numeric, falta_parametro boolean, valor_residual numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- guarda de empresa (fail-closed): sem vínculo com a empresa, lista vazia
  IF p_company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT b.id, b.codigo, b.descricao, b.natureza, b.data_aquisicao, b.valor_aquisicao,
    b.deprecia, b.vida_util_meses, b.metodo_depreciacao, b.business_line_id, bl.name,
    b.centro_custo, b.status,
    COALESCE(d.acumulado, 0) AS dep_acumulada,
    ROUND(b.valor_aquisicao - COALESCE(d.acumulado,0), 2) AS valor_contabil,
    (b.deprecia AND b.vida_util_meses IS NULL) AS falta_parametro,
    COALESCE(b.valor_residual, 0) AS valor_residual
  FROM erp_bem b
  LEFT JOIN business_lines bl ON bl.id = b.business_line_id
  LEFT JOIN LATERAL (
    SELECT acumulado FROM erp_bem_depreciacao dd
    WHERE dd.bem_id = b.id ORDER BY dd.competencia DESC LIMIT 1
  ) d ON TRUE
  WHERE b.company_id = p_company_id AND b.status <> 'excluido'
  ORDER BY b.status, b.natureza, b.descricao;
END $function$;

-- Grants (tira o EXECUTE default de PUBLIC/anon; mantém o acesso do app). Padrão das
-- funções irmãs do módulo (ex.: fn_bem_indicadores).
REVOKE ALL ON FUNCTION public.fn_bem_listar(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_bem_listar(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_bem_listar(uuid) TO authenticated, service_role;

-- 2) Ajuda "?" (RD-95) dos campos do modal de baixa/venda/sinistro — idempotente
INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('ge.bens.baixa_tipo', '/dashboard/gestao-empresarial/bens', 'Baixar / vender',
   'Tipo da operação',
   'Escolha o que está acontecendo com o bem: Venda (saiu com recebimento), Baixa (descarte/sucata, sem venda) ou Sinistro (perda/dano, ex.: acidente, roubo).',
   'Define como o resultado é apurado: na venda compara-se o valor recebido com o valor contábil; na baixa/sinistro o bem sai pelo valor contábil.',
   'Venda de um veículo antigo; Baixa de uma máquina sucateada; Sinistro de equipamento danificado.',
   'Marcar "Venda" sem informar o valor recebido: o resultado da operação sai errado.',
   'gestao_empresarial', 30),
  ('ge.bens.baixa_valor', '/dashboard/gestao-empresarial/bens', 'Baixar / vender',
   'Valor da venda (R$)',
   'Só na Venda: o valor efetivamente recebido pelo bem.',
   'É comparado com o valor contábil (aquisição menos depreciação) para apurar o ganho ou a perda na venda.',
   'Vendeu por R$ 50.000 um bem com valor contábil de R$ 45.000: resultado de R$ 5.000 de ganho.',
   'Deixar zerado numa venda: o sistema entende saída sem recebimento e apura perda indevida.',
   'gestao_empresarial', 31),
  ('ge.bens.baixa_data', '/dashboard/gestao-empresarial/bens', 'Baixar / vender',
   'Data da operação',
   'A data em que a venda, baixa ou sinistro aconteceu.',
   'Marca o momento em que o bem sai do imobilizado ativo e entra no resultado do período.',
   '15/03/2026.',
   'Usar uma data futura ou de outro exercício: o resultado cai no período errado.',
   'gestao_empresarial', 32),
  ('ge.bens.baixa_justificativa', '/dashboard/gestao-empresarial/bens', 'Baixar / vender',
   'Justificativa',
   'Opcional: uma observação sobre o motivo da baixa/venda (comprador, nº da nota, laudo do sinistro).',
   'Fica no histórico da operação para auditoria e consulta futura.',
   '"Vendido para a Transportes XYZ — NF 1234".',
   'Deixar sem contexto numa baixa relevante dificulta a auditoria depois.',
   'gestao_empresarial', 33)
ON CONFLICT (chave) DO NOTHING;
