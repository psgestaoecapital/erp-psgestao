-- Comercial › Meu painel de vendas — versão completa (CEO 29/10/2026 10:34: "ficou pobre, totalmente diferente do que
-- foi apresentado"). A tela passa a ter o mesmo conteúdo do BI apresentado à diretoria: leituras para a decisão, mix por
-- linha, ranking da equipe com preço/ticket/notas, desconto e preço por vendedor, produtos, clientes, cidades e logística.
--
-- Recria SÓ a fn_bi_comercial_painel (criada na #3459, ainda sem uso fora desta tela), com a MESMA assinatura e a MESMA
-- guarda e escopo (usuário logado + empresa; vínculo prende na subárvore; p_no fora do permitido volta para a raiz).
-- O que muda é só o que ela devolve: blocos novos (divisoes, cidades, cargas, logistica, conc_top10) e colunas novas em
-- equipe/produtos. Nenhuma tabela, nenhum dado alterado.

CREATE OR REPLACE FUNCTION public.fn_bi_comercial_painel(p_company_id uuid, p_no text DEFAULT NULL, p_de date DEFAULT NULL, p_ate date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_raiz text; v_vinculo text; v_role text; v_ate date; v_de date;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Entre com o seu usuário' USING ERRCODE = '42501'; END IF;
  IF NOT (public.is_admin() OR p_company_id IN (SELECT public.get_user_company_ids())) THEN
    RAISE EXCEPTION 'Sem acesso a esta empresa' USING ERRCODE = '42501';
  END IF;

  SELECT a.codigo INTO v_vinculo FROM com_vendedor_acesso a WHERE a.company_id = p_company_id AND a.user_id = v_uid AND a.ativo;
  IF v_vinculo IS NOT NULL THEN
    v_raiz := v_vinculo;
  ELSE
    SELECT uc.role INTO v_role FROM user_companies uc WHERE uc.company_id = p_company_id AND uc.user_id = v_uid LIMIT 1;
    IF public.is_admin() OR public.fn_owner_pode_gerir_escopo(p_company_id)
       OR v_role IN ('owner','socio','acesso_total','adm','admin','diretor','diretor_area','gerente') THEN
      v_raiz := 'empresa';
    ELSE
      RETURN jsonb_build_object('ok', false, 'erro', 'sem_vinculo_vendedor',
        'mensagem', 'Seu usuário ainda não está ligado a um código de vendedor. Peça ao administrador em Administração › Vendedores.');
    END IF;
  END IF;

  v_ate := coalesce(p_ate, current_date);
  v_de := coalesce(p_de, v_ate - 29);

  WITH RECURSIVE eq AS (SELECT * FROM fn_com_equipe(p_company_id)),
  sub(no, cod) AS (SELECT codigo, codigo FROM eq UNION SELECT s.no, e.codigo FROM sub s JOIN eq e ON e.superior = s.cod),
  v AS (SELECT * FROM fn_com_venda_item(p_company_id, v_de, v_ate)),
  nv AS (SELECT 'empresa'::text AS no, vendedor AS ven FROM (SELECT DISTINCT vendedor FROM v) x UNION SELECT no, cod FROM sub),
  perm AS (SELECT 'empresa'::text AS no WHERE v_raiz = 'empresa'
           UNION SELECT e.codigo FROM eq e WHERE v_raiz = 'empresa'
           UNION SELECT s.cod FROM sub s WHERE s.no = v_raiz),
  alvo AS (SELECT CASE WHEN p_no IS NOT NULL AND p_no IN (SELECT no FROM perm) THEN p_no ELSE v_raiz END AS no),
  va AS (SELECT v.* FROM v JOIN nv ON nv.ven = v.vendedor WHERE nv.no = (SELECT no FROM alvo)),
  tot AS (SELECT sum(valor) AS val, sum(valor_tabela) AS lista, count(*) AS itens, sum(abaixo_tabela::int) AS ab,
                 sum(valor) FILTER (WHERE carne AND kg > 0) / nullif(sum(kg) FILTER (WHERE carne), 0) AS preco FROM v),
  porven AS (SELECT vendedor, sum(valor) AS val FROM v WHERE vendedor <> 's/v' GROUP BY vendedor),
  cli AS (SELECT cliente_cod, max(cliente) AS cliente, max(cidade) AS cidade, sum(valor) AS val, sum(kg) AS kg, count(DISTINCT nota) AS notas,
                 sum(valor) FILTER (WHERE carne AND kg > 0) / nullif(sum(kg) FILTER (WHERE carne), 0) AS preco FROM va GROUP BY cliente_cod),
  cg AS (SELECT carga, min(dia) AS dia, min(transportador) AS transp, count(DISTINCT nota) AS notas, count(DISTINCT cliente_cod) AS clientes,
                count(DISTINCT cidade) AS cidades, sum(kg) AS kg, sum(valor) AS val FROM va WHERE carga IS NOT NULL GROUP BY carga)
  SELECT jsonb_build_object(
    'ok', true,
    'periodo', jsonb_build_object('de', v_de, 'ate', v_ate),
    'escopo', jsonb_build_object('raiz', v_raiz, 'no', (SELECT no FROM alvo), 'restrito', v_vinculo IS NOT NULL),
    'nos', (SELECT coalesce(jsonb_agg(jsonb_build_object('no', x.no, 'nome', x.nome, 'cargo', x.cargo, 'pai', x.pai, 'ordem', x.ordem) ORDER BY x.ordem), '[]'::jsonb) FROM (
              SELECT 'empresa' AS no, 'Toda a empresa' AS nome, 'Empresa' AS cargo, NULL AS pai, '0' AS ordem WHERE v_raiz = 'empresa'
              UNION ALL SELECT e.codigo, e.nome, e.cargo, coalesce(e.superior, 'empresa'), e.ordem FROM eq e WHERE e.codigo IN (SELECT no FROM perm)) x),
    'resumo', (SELECT jsonb_build_object(
        'val', round(coalesce(sum(valor), 0), 2), 'kg', round(coalesce(sum(kg), 0), 1),
        'preco_kg', round(sum(valor) FILTER (WHERE carne AND kg > 0) / nullif(sum(kg) FILTER (WHERE carne), 0), 2),
        'desc_pct', round(100 * (sum(valor_tabela) - sum(valor)) / nullif(sum(valor_tabela), 0), 2),
        'desconto', round(coalesce(sum(valor_tabela) - sum(valor), 0), 2),
        'pct_abaixo', round(100.0 * sum(abaixo_tabela::int) / nullif(count(*), 0), 1),
        'clientes', count(DISTINCT cliente_cod), 'notas', count(DISTINCT nota),
        'ticket', round(sum(valor) / nullif(count(DISTINCT nota), 0), 0), 'produtos', count(DISTINCT produto_cod),
        'vendedores', count(DISTINCT vendedor)) FROM va),
    'conc_top10', (SELECT round(100 * sum(val) FILTER (WHERE r <= 10) / nullif(sum(val), 0), 1)
                   FROM (SELECT val, row_number() OVER (ORDER BY val DESC) AS r FROM cli) c),
    'referencia', (SELECT jsonb_build_object('desc_pct', round(100 * (lista - val) / nullif(lista, 0), 2),
        'pct_abaixo', round(100.0 * ab / nullif(itens, 0), 1), 'preco_kg', round(preco, 2)) FROM tot),
    'posicao', (SELECT CASE WHEN (SELECT no FROM alvo) IN (SELECT vendedor FROM porven)
        THEN jsonb_build_object('lugar', (SELECT count(*) + 1 FROM porven p2 WHERE p2.val > (SELECT val FROM porven p1 WHERE p1.vendedor = (SELECT no FROM alvo))),
                                'de', (SELECT count(*) FROM porven)) END),
    'dia', (SELECT coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'val', round(val, 2), 'kg', round(kg, 1), 'notas', notas) ORDER BY dia), '[]'::jsonb)
            FROM (SELECT dia, sum(valor) AS val, sum(kg) AS kg, count(DISTINCT nota) AS notas FROM va GROUP BY dia) d),
    'divisoes', (SELECT coalesce(jsonb_agg(jsonb_build_object('linha', linha, 'val', round(val, 2), 'kg', round(kg, 1)) ORDER BY val DESC), '[]'::jsonb)
            FROM (SELECT linha, sum(valor) AS val, sum(kg) AS kg FROM va GROUP BY linha) d),
    'clientes', (SELECT coalesce(jsonb_agg(jsonb_build_object('cod', cliente_cod, 'cliente', cliente, 'cidade', cidade, 'val', round(val, 2),
                 'kg', round(kg, 1), 'notas', notas, 'preco_kg', round(preco, 2)) ORDER BY val DESC), '[]'::jsonb)
            FROM (SELECT * FROM cli ORDER BY val DESC LIMIT 15) c),
    'cidades', (SELECT coalesce(jsonb_agg(jsonb_build_object('cidade', cidade, 'val', round(val, 2), 'kg', round(kg, 1), 'clientes', cl) ORDER BY val DESC), '[]'::jsonb)
            FROM (SELECT cidade, sum(valor) AS val, sum(kg) AS kg, count(DISTINCT cliente_cod) AS cl FROM va GROUP BY cidade ORDER BY sum(valor) DESC LIMIT 10) c),
    'produtos', (SELECT coalesce(jsonb_agg(jsonb_build_object('cod', produto_cod, 'produto', produto, 'val', round(val, 2), 'kg', round(kg, 1),
                 'preco_kg', round(preco, 2), 'desc_pct', round(dp, 2), 'pct_abaixo', round(pa, 1), 'clientes', cl) ORDER BY val DESC), '[]'::jsonb)
            FROM (SELECT produto_cod, max(produto) AS produto, sum(valor) AS val, sum(kg) AS kg,
                         sum(valor) FILTER (WHERE kg > 0) / nullif(sum(kg), 0) AS preco,
                         100 * (sum(valor_tabela) - sum(valor)) / nullif(sum(valor_tabela), 0) AS dp,
                         100.0 * sum(abaixo_tabela::int) / count(*) AS pa, count(DISTINCT cliente_cod) AS cl
                  FROM va GROUP BY produto_cod ORDER BY sum(valor) DESC LIMIT 15) p),
    'cede_mais', (SELECT coalesce(jsonb_agg(produto ORDER BY n DESC), '[]'::jsonb) FROM (
            SELECT max(produto) AS produto, count(*) AS n FROM va GROUP BY produto_cod
            HAVING count(*) >= 3 AND sum(abaixo_tabela::int) = count(*) ORDER BY count(*) DESC LIMIT 4) c),
    'equipe', (SELECT coalesce(jsonb_agg(jsonb_build_object('ven', ven, 'nome', nome, 'val', round(val, 2), 'kg', round(kg, 1),
                 'preco_kg', round(preco, 2), 'desc_pct', round(dp, 2), 'pct_abaixo', round(pa, 1), 'clientes', cl, 'notas', nt,
                 'ticket', round(val / nullif(nt, 0), 0)) ORDER BY val DESC), '[]'::jsonb)
            FROM (SELECT va.vendedor AS ven, coalesce(max(e.nome), 'Vendedor ' || va.vendedor) AS nome, sum(valor) AS val, sum(kg) AS kg,
                         sum(valor) FILTER (WHERE carne AND kg > 0) / nullif(sum(kg) FILTER (WHERE carne), 0) AS preco,
                         100 * (sum(valor_tabela) - sum(valor)) / nullif(sum(valor_tabela), 0) AS dp,
                         100.0 * sum(abaixo_tabela::int) / count(*) AS pa, count(DISTINCT cliente_cod) AS cl, count(DISTINCT nota) AS nt
                  FROM va LEFT JOIN eq e ON e.codigo = va.vendedor
                  WHERE (SELECT no FROM alvo) NOT IN (SELECT vendedor FROM porven) OR va.vendedor = (SELECT no FROM alvo)
                  GROUP BY va.vendedor) q),
    'logistica', (SELECT jsonb_build_object('cargas', count(*), 'kg_carga', round(avg(kg), 0), 'clientes_carga', round(avg(clientes), 1),
                 'notas_sem_carga', (SELECT count(DISTINCT nota) FROM va WHERE carga IS NULL),
                 'kg_sem_carga', (SELECT round(coalesce(sum(kg), 0), 0) FROM va WHERE carga IS NULL)) FROM cg),
    'cargas', (SELECT coalesce(jsonb_agg(jsonb_build_object('carga', carga, 'dia', dia, 'transportador', transp, 'notas', notas, 'clientes', clientes,
                 'cidades', cidades, 'kg', round(kg, 0), 'val', round(val, 2)) ORDER BY dia DESC, carga DESC), '[]'::jsonb)
            FROM (SELECT * FROM cg ORDER BY dia DESC, carga DESC LIMIT 60) c)
  ) INTO v_out;
  RETURN v_out;
END $fn$;

REVOKE ALL ON FUNCTION public.fn_bi_comercial_painel(uuid, text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bi_comercial_painel(uuid, text, date, date) TO authenticated;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Meu painel de vendas', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/comercial/meu-painel', 'comercial', 'publicado'
FROM (VALUES
 ('com.painel.clientes', 'Clientes atendidos', 'Indicador calculado.', 'Quantos clientes compraram no período e quanto os 10 maiores representam do faturamento (concentração).', '323 clientes; 10 maiores = 20,7%.', 'Concentração alta = risco de depender de poucos clientes.', 9),
 ('com.painel.leituras', 'Leituras para a decisão', 'Nada a preencher.', 'Frases calculadas a partir dos números da visão escolhida: onde está o desconto, quem concede mais, o que mais fatura.', '"57,5% dos itens abaixo da tabela".', 'Ler como regra fixa: as frases mudam com a visão e o período.', 10),
 ('com.painel.equipe', 'Ranking da equipe', 'Toque num vendedor para abrir a visão dele.', 'Compara faturamento, volume, preço, desconto e itens abaixo da tabela de cada vendedor da visão.', 'Vendedor 80006: 1,92% de desconto, 85,7% dos itens abaixo.', 'Olhar só o faturamento: preço e desconto mostram a qualidade da venda.', 11),
 ('com.painel.logistica', 'Logística de saída', 'Indicador calculado.', 'Cargas montadas, peso e clientes por carga e notas que saíram sem carga (retiradas ou sem romaneio).', '38 cargas, 3,5 t por carga.', 'Nota sem carga não é erro: pode ser retirada pelo cliente.', 12)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO NOTHING;
