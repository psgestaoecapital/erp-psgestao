-- Chamado #5579 (Gean): a lista de notas de entrada cortava nas N mais recentes (LIMIT) e a busca só olhava as notas
-- já carregadas — a NF-e 3742 da IMPARTS (a 310ª mais recente de 835) nunca aparecia. Agora a busca, o período e a fila
-- "a concluir" rodam no servidor, com paginação (offset) e total REAL (antes "total" era o tamanho da página).
-- CREATE OR REPLACE da função comum (mesmo corpo de situação/itens); assinatura nova → troca a antiga.
DROP FUNCTION IF EXISTS public.fn_nfe_recebidas_listar(uuid, text, integer, text);

CREATE OR REPLACE FUNCTION public.fn_nfe_recebidas_listar(
  p_company_id uuid,
  p_status     text    DEFAULT NULL,
  p_limit      integer DEFAULT 100,
  p_situacao   text    DEFAULT NULL,   -- a_concluir | concluida | precisa_xml | sem_xml | falta_estoque | falta_financeiro
  p_busca      text    DEFAULT NULL,   -- número, fornecedor, CNPJ ou chave (parte)
  p_data_ini   date    DEFAULT NULL,
  p_data_fim   date    DEFAULT NULL,
  p_offset     integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
  c_teto constant int := 20;   -- teto de tentativas · vide 20260909200000_nfe_xml_teto_tentativas
  v_busca  text := NULLIF(btrim(COALESCE(p_busca, '')), '');
  v_digits text;
  v_limit  int  := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_offset int  := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF NOT (p_company_id IN (SELECT get_user_company_ids()) OR is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso a empresa');
  END IF;

  v_digits := regexp_replace(COALESCE(v_busca, ''), '\D', '', 'g');

  WITH base AS (
    SELECT n.* FROM erp_nfe_recebidas n
    WHERE n.company_id = p_company_id
      AND (p_status IS NULL OR n.status = p_status)
      AND (p_data_ini IS NULL OR n.data_emissao >= p_data_ini::timestamptz)
      AND (p_data_fim IS NULL OR n.data_emissao <  (p_data_fim + 1)::timestamptz)
      AND (v_busca IS NULL
        OR n.emitente_razao ILIKE '%' || v_busca || '%'
        OR ltrim(COALESCE(n.numero, ''), '0') = ltrim(v_digits, '0') AND v_digits <> ''
        OR (v_digits <> '' AND (n.emitente_cnpj LIKE '%' || v_digits || '%' OR n.chave_acesso LIKE '%' || v_digits || '%')))
      AND (p_situacao IS NULL
        OR (p_situacao = 'a_concluir'       AND n.concluida_em IS NULL AND n.status <> 'ignorada')
        OR (p_situacao = 'concluida'        AND n.concluida_em IS NOT NULL)
        OR (p_situacao = 'precisa_xml'      AND n.status = 'aguardando_xml' AND n.xml_tentativas >= c_teto)
        OR (p_situacao = 'sem_xml'          AND n.status = 'aguardando_xml' AND n.xml_tentativas <  c_teto)
        OR (p_situacao = 'falta_estoque'    AND n.concluida_em IS NULL AND n.estoque_status = 'pendente')
        OR (p_situacao = 'falta_financeiro' AND n.concluida_em IS NULL AND n.lancado_pagar = false))
  ), pagina AS (
    SELECT * FROM base ORDER BY data_emissao DESC NULLS LAST, id LIMIT v_limit OFFSET v_offset
  )
  SELECT jsonb_build_object(
    'ok', true,
    'total', (SELECT count(*) FROM base),
    'offset', v_offset,
    'itens', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id,
        'chave_acesso', n.chave_acesso,
        'numero', n.numero,
        'serie', n.serie,
        'fornecedor', n.emitente_razao,
        'cnpj', n.emitente_cnpj,
        'data_emissao', n.data_emissao,
        'valor_total', n.valor_total,
        'status', n.status,
        'manifestacao', n.status_manifestacao,
        'lancado_pagar', n.lancado_pagar,
        'xml_tentativas', n.xml_tentativas,
        'concluida_em', n.concluida_em,
        'situacao', CASE
          WHEN n.concluida_em IS NOT NULL                                 THEN 'concluida'
          WHEN n.status = 'aguardando_xml' AND n.xml_tentativas >= c_teto THEN 'precisa_xml'
          WHEN n.status = 'aguardando_xml'                                THEN 'sem_xml'
          WHEN n.estoque_status = 'pendente'                              THEN 'falta_estoque'
          WHEN n.lancado_pagar = false                                    THEN 'falta_financeiro'
          ELSE 'outro' END,
        'qtd_itens', (SELECT count(*) FROM erp_nfe_recebidas_itens i WHERE i.nfe_recebida_id = n.id),
        'qtd_duplicatas', (SELECT count(*) FROM erp_nfe_recebidas_duplicatas d WHERE d.nfe_recebida_id = n.id)
      ) ORDER BY n.data_emissao DESC NULLS LAST, n.id)
      FROM pagina n), '[]'::jsonb)
  ) INTO v;

  RETURN v;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_nfe_recebidas_listar(uuid, text, integer, text, text, date, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_nfe_recebidas_listar(uuid, text, integer, text, text, date, date, integer) TO authenticated, service_role;

-- RD-95: "?" da busca atualizado + período
UPDATE public.erp_ajuda_campo SET
  o_que_preencher = 'Digite o número da nota, parte do nome do fornecedor, do CNPJ ou da chave de acesso.',
  para_que_serve  = 'A busca é feita em TODAS as notas da empresa (não só nas que aparecem na tela), então a nota sempre é encontrada.',
  exemplo         = '3742, ou IMPARTS, ou 12.345.678, ou os últimos números da chave',
  erro_comum      = 'Achar que a nota sumiu: ela pode estar em "Concluídas" ou fora do período escolhido — limpe o período.'
WHERE chave = 'compras.docs_recebidos.busca';

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
VALUES
 ('compras.docs_recebidos.periodo', 'Documentos recebidos', 'Período de emissão',
  'Escolha a data inicial e/ou final de emissão das notas.',
  'Limita a lista às notas emitidas nesse intervalo; vazio mostra todas.',
  '01/09/2026 a 30/09/2026 para ver só as notas de setembro',
  'Deixar um período antigo preenchido e estranhar que as notas novas não aparecem.', 14,
  '/dashboard/compras/documentos-recebidos', 'gestao_empresarial', 'publicado'),
 ('compras.docs_recebidos.carregar_mais', 'Documentos recebidos', 'Carregar mais notas',
  'Clique para trazer as próximas notas da lista.',
  'A tela carrega 100 notas por vez; este botão traz mais sem perder a busca e os filtros.',
  'Mostrando 100 de 618 → clique e passa a mostrar 200 de 618',
  'Não precisa clicar para buscar uma nota: a busca já procura em todas.', 15,
  '/dashboard/compras/documentos-recebidos', 'gestao_empresarial', 'publicado')
ON CONFLICT (chave) DO NOTHING;
