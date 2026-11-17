-- Centro de custo: criação INLINE a partir da tela de Nova despesa (contas a pagar).
-- Modela fn_fornecedor_criar_inline / fn_plano_contas_criar_inline: o usuário digita um centro
-- que ainda não existe no próprio lançamento, sem sair para o cadastro. Dedup por nome
-- normalizado (reusa e reativa se já existir de mesmo nome), insere senão. Devolve o id para
-- a tela já selecionar. Aditiva: função NOVA + REVOKE anon + 1 linha de ajuda (RD-95).
--
-- Segurança: SECURITY DEFINER com guarda auth.uid() + empresa do usuário (igual ao fornecedor
-- inline). Não altera nem apaga dado existente além de reativar um centro de mesmo nome.

CREATE OR REPLACE FUNCTION public.fn_centro_custo_criar_inline(
  p_company_id uuid,
  p_nome       text
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id   uuid;
  v_norm text := unaccent(lower(btrim(regexp_replace(COALESCE(p_nome, ''), '\s+', ' ', 'g'))));
BEGIN
  IF auth.uid() IS NULL OR NOT (p_company_id IN (SELECT get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa';
  END IF;
  IF v_norm = '' THEN
    RAISE EXCEPTION 'Nome do centro de custo obrigatório';
  END IF;

  -- DEDUP por nome normalizado: achou → reusa (e reativa se estava inativo).
  SELECT id INTO v_id
    FROM erp_centros_custo
   WHERE company_id = p_company_id
     AND unaccent(lower(btrim(regexp_replace(COALESCE(nome, ''), '\s+', ' ', 'g')))) = v_norm
   ORDER BY ativo DESC NULLS LAST, created_at
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    UPDATE erp_centros_custo SET ativo = true WHERE id = v_id AND ativo IS DISTINCT FROM true;
    RETURN v_id;
  END IF;

  INSERT INTO erp_centros_custo (company_id, nome, ativo)
  VALUES (p_company_id, btrim(p_nome), true)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_centro_custo_criar_inline(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_centro_custo_criar_inline(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_centro_custo_criar_inline(uuid, text) TO authenticated, service_role;

-- RD-95: "?" do novo campo (nome do centro criado na hora). Idempotente.
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
SELECT
  'financeiro.despesa.centro_custo_novo',
  '/dashboard/financeiro/nova-despesa',
  'Financeiro · Nova despesa',
  'Novo centro de custo',
  'Digite o nome de um centro de custo que ainda não existe (setor, filial ou obra). Ele é criado na hora e já fica selecionado neste lançamento.',
  'Cria o centro de custo sem sair do lançamento; o gasto já nasce ligado a ele e aparece no DRE por centro e na ficha da obra no Hub.',
  'Obra Residencial Ipê',
  'Criar um centro repetido com grafia diferente: o sistema reusa um já existente de mesmo nome para evitar duplicata.',
  'gestao_empresarial',
  17,
  'publicado'
WHERE NOT EXISTS (
  SELECT 1 FROM erp_ajuda_campo WHERE chave = 'financeiro.despesa.centro_custo_novo'
);
