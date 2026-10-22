-- Produtividade ONDA 2 (tela) · caixa 6570c1c9 (Eng. Chefe 07/10): complementos de banco para a tela do produto acabado + árvore.
-- DEPENDE da #2136 (prod_produto, prod_estrutura, fn_prod_assert_planta e as RPCs de cadastro/estrutura). Aqui só entra o que a #2136 não tem:
--   · fn_prod_produto_buscar — busca do "Produto acabado": cadastro da planta + fonte de produção ligada (adaptador por fonte; hoje ATAK).
--     Genérica: sem fonte ligada só devolve o cadastro. Timeout de 8 s na busca da fonte (aviso em vez de erro; RD: prova nunca varre tabela grande).
--   · fn_prod_fluxo_prontidao — "Pronto para medir" POR FLUXO (RD-58): produto de origem, saídas, postos com turno, fontes de produção/ponto.
--   · textos do "?" (erp_ajuda_campo, prod.produto.* / prod.estrutura.* / prod.fluxo.produto_origem).
-- Aditiva: 2 funções novas (SECURITY DEFINER, search_path fixo, guarda de empresa/planta, REVOKE anon) + INSERT de textos. Sem dado de cliente.

CREATE OR REPLACE FUNCTION public.fn_prod_produto_buscar(p_company_id uuid, p_plant_id uuid, p_q text, p_limit int DEFAULT 15)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '8s'
AS $f$
DECLARE v_q text := btrim(coalesce(p_q,'')); v_fonte record;
  v_cad jsonb; v_ext jsonb := '[]'::jsonb; v_aviso text; v_lim int := least(greatest(coalesce(p_limit,15),1),30);
BEGIN
  PERFORM public.fn_prod_assert_planta(p_company_id, p_plant_id);
  IF length(v_q) < 1 THEN RETURN jsonb_build_object('ok', true, 'cadastro', '[]'::jsonb, 'fonte', '[]'::jsonb); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'codigo', codigo, 'nome', nome, 'papel', papel) ORDER BY (codigo = v_q) DESC, codigo), '[]'::jsonb) INTO v_cad FROM (
    SELECT id, codigo, nome, papel FROM prod_produto
     WHERE company_id = p_company_id AND plant_id = p_plant_id AND ativo
       AND (codigo ILIKE v_q || '%' OR fn_prod_norm(nome) LIKE '%' || fn_prod_norm(v_q) || '%')
     ORDER BY (codigo = v_q) DESC, codigo LIMIT v_lim) x;

  SELECT id, nome INTO v_fonte FROM prod_fonte_dados
   WHERE company_id = p_company_id AND plant_id = p_plant_id AND tipo = 'producao' AND ativo ORDER BY created_at LIMIT 1;
  IF v_fonte.id IS NOT NULL THEN
    BEGIN
      -- Adaptador por fonte. Hoje: ATAK (ind_atak_fato). Cada conector novo acrescenta um WHEN aqui; o resto do sistema não muda.
      IF lower(v_fonte.nome) = 'atak' THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('fonte_id', v_fonte.id, 'codigo', codigo, 'nome', nome) ORDER BY (codigo = v_q) DESC, codigo), '[]'::jsonb) INTO v_ext FROM (
          SELECT raw->>'COD_PRODUTO' AS codigo, max(raw->>'DESC_PRODUTO_EST') AS nome
            FROM ind_atak_fato
           WHERE company_id = p_company_id AND coalesce(raw->>'COD_PRODUTO','') <> ''
             AND (raw->>'COD_PRODUTO' = v_q OR raw->>'DESC_PRODUTO_EST' ILIKE '%' || v_q || '%')
           GROUP BY raw->>'COD_PRODUTO' ORDER BY (raw->>'COD_PRODUTO' = v_q) DESC, raw->>'COD_PRODUTO' LIMIT v_lim) y
         WHERE NOT EXISTS (SELECT 1 FROM prod_produto pp WHERE pp.company_id = p_company_id AND pp.plant_id = p_plant_id AND pp.codigo = y.codigo);
      ELSE
        v_aviso := 'A fonte "' || v_fonte.nome || '" ainda não tem busca de produtos — cadastre manualmente.';
      END IF;
    EXCEPTION WHEN query_canceled THEN
      v_ext := '[]'::jsonb; v_aviso := 'A busca na fonte demorou demais — digite o código completo ou cadastre manualmente.';
    END;
  END IF;
  RETURN jsonb_build_object('ok', true, 'cadastro', v_cad, 'fonte', v_ext, 'fonte_nome', v_fonte.nome, 'aviso', v_aviso);
END $f$;

CREATE OR REPLACE FUNCTION public.fn_prod_fluxo_prontidao(p_fluxo_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE fx record; v_falta jsonb := '[]'::jsonb; v_postos int; v_quadros int; v_saidas int; v_prod int; v_ponto int;
BEGIN
  SELECT * INTO fx FROM prod_fluxo WHERE id = p_fluxo_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'fluxo_nao_encontrado'); END IF;
  PERFORM public.fn_compliance_assert(fx.company_id);
  IF fx.produto_origem_id IS NULL THEN
    v_falta := v_falta || jsonb_build_object('chave', 'origem', 'texto', 'o fluxo não tem produto de origem (entrada da etapa)', 'destino', 'origem'); END IF;
  SELECT count(*) INTO v_saidas FROM prod_estrutura WHERE fluxo_id = fx.id AND ativo;
  IF v_saidas = 0 THEN v_falta := v_falta || jsonb_build_object('chave', 'saidas', 'texto', 'o fluxo não tem saídas cadastradas na árvore', 'destino', 'saidas'); END IF;
  SELECT count(*) INTO v_postos FROM prod_posto WHERE setor_id = fx.setor_id AND plant_id = fx.plant_id AND ativo;
  SELECT count(DISTINCT pt.posto_id) INTO v_quadros FROM prod_posto_turno pt JOIN prod_posto p ON p.id = pt.posto_id
   WHERE p.setor_id = fx.setor_id AND p.plant_id = fx.plant_id AND p.ativo AND pt.vigencia_fim IS NULL;
  IF v_postos = 0 THEN v_falta := v_falta || jsonb_build_object('chave', 'postos', 'texto', 'o fluxo não tem postos', 'destino', 'novo');
  ELSIF v_quadros = 0 THEN v_falta := v_falta || jsonb_build_object('chave', 'turno', 'texto', 'nenhum posto do fluxo tem turno e horário', 'destino', 'turno'); END IF;
  SELECT count(*) INTO v_prod FROM prod_fonte_dados WHERE company_id = fx.company_id AND plant_id = fx.plant_id AND tipo = 'producao' AND ativo;
  SELECT count(*) INTO v_ponto FROM prod_fonte_dados WHERE company_id = fx.company_id AND plant_id = fx.plant_id AND tipo = 'ponto' AND ativo;
  IF v_prod = 0 THEN v_falta := v_falta || jsonb_build_object('chave', 'fonte_producao', 'texto', 'nenhuma fonte de produção ligada (conector, módulo ou apontamento)', 'destino', NULL); END IF;
  IF v_ponto = 0 THEN v_falta := v_falta || jsonb_build_object('chave', 'fonte_ponto', 'texto', 'nenhuma fonte de ponto/horas ligada', 'destino', NULL); END IF;
  RETURN jsonb_build_object('ok', true, 'pronto', jsonb_array_length(v_falta) = 0, 'falta', v_falta,
    'tem', jsonb_build_object('saidas', v_saidas, 'postos', v_postos, 'quadros', v_quadros, 'fontes_producao', v_prod, 'fontes_ponto', v_ponto));
END $f$;

REVOKE ALL ON FUNCTION public.fn_prod_produto_buscar(uuid, uuid, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_produto_buscar(uuid, uuid, text, int) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_prod_fluxo_prontidao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_prod_fluxo_prontidao(uuid) TO authenticated, service_role;

-- ── "?" de ajuda (erp_ajuda_campo) — textos a partir do que as funções acima fazem ──
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Produto e estrutura', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/produtividade', 'industria', 'publicado'
FROM (VALUES
 ('prod.produto.acabado', 'Produto acabado', 'O produto final que gera faturamento. Digite o código ou parte do nome e escolha na lista: aparecem os já cadastrados e, se a empresa tem fonte de produção ligada, os da fonte.', 'Define a raiz da árvore. Ao escolher um da fonte, o sistema cria o cadastro dele na planta (prod_produto) com o código da fonte. Ainda não entra em nenhuma conta de indicador: a árvore é o cadastro que as próximas ondas usam para rendimento e balanço de massa.', '47', 'Esperar que escolher o produto apague algo na fonte: nada é gravado na fonte, só no cadastro da planta.', 50),
 ('prod.produto.codigo', 'Código do produto', 'O código que a empresa usa para o produto (da fonte ou seu). Único dentro da planta.', 'É a chave para colar a estrutura em lista e para ligar o produto à fonte. Não entra em conta de indicador.', '47', 'Repetir um código já cadastrado: o sistema recusa (código ativo repetido) ou reativa o produto arquivado de mesmo código.', 51),
 ('prod.produto.nome', 'Nome do produto', 'Como o produto é chamado no chão de fábrica.', 'Identifica o produto na árvore e na busca. Não entra em conta de indicador.', 'Coxão mole resfriado', 'Trocar o nome achando que muda o produto na fonte: muda só aqui.', 52),
 ('prod.produto.papel', 'Papel do produto', 'Acabado (vendido), intermediário (sai de uma etapa e entra em outra), origem (a matéria-prima) ou subproduto.', 'Só classifica o produto no cadastro e na busca. Não entra em conta de indicador.', 'intermediário', 'Marcar como acabado um produto que não é vendido.', 53),
 ('prod.estrutura.origem', 'Origem (entra)', 'O produto que é desmontado para gerar este. Busque pelo código ou nome entre os produtos cadastrados.', 'Cada ligação diz "da origem X sai o produto Y". A árvore sobe do acabado até a origem seguindo estas ligações. O sistema recusa a ligação que formaria ciclo (X gera Y e Y gera X, direta ou indiretamente).', 'Bola com osso (11)', 'Ligar um produto a ele mesmo ou a um que já saiu dele: recusado como ciclo.', 54),
 ('prod.estrutura.saida', 'Saída (produto gerado)', 'O produto que sai da origem nesta etapa. Pode ser um cadastrado ou um novo da fonte.', 'É o nó da árvore. Entra no cálculo de rendimento nas próximas ondas.', 'Coxão mole (47)', 'Cadastrar a mesma saída duas vezes para a mesma origem e etapa: o sistema avisa que já existe.', 55),
 ('prod.estrutura.tipo_saida', 'Tipo de saída', 'Principal (o que se quer), coproduto (sai junto e tem valor) ou subproduto (osso, gordura, serragem).', 'Só classifica a ligação. No balanço de massa (entrada − saídas = perda) servirá para separar a perda do que tem destino.', 'subproduto', 'Marcar tudo como principal: perde-se a diferença entre o que vende e o que é resíduo.', 56),
 ('prod.estrutura.rendimento', 'Rendimento padrão (%)', 'Quanto da origem vira esta saída, em %. Em branco = "a definir" — nunca zero.', 'É o padrão para comparar com o rendimento real nas próximas ondas. O sistema avisa (não bloqueia) quando a soma dos rendimentos de uma origem passa de 100%. Hoje não entra em conta de indicador.', '12,5', 'Digitar 0 para "não sei": o sistema recusa. Deixe em branco.', 57),
 ('prod.estrutura.etapa', 'Etapa (fluxo)', 'O fluxo cadastrado onde essa saída acontece. Opcional.', 'Liga a ligação da árvore aos postos do fluxo e conta no aviso "Pronto para medir" daquele fluxo (que exige saídas cadastradas).', 'Desossa de Bola', 'Escolher a etapa errada: o fluxo certo continuará acusando "sem saídas".', 58),
 ('prod.estrutura.status', 'Status da ligação', 'Rascunho (a validar) ou validado. Lista colada entra sempre como rascunho.', 'Mostra o que já foi conferido pela empresa. Não bloqueia nenhum cálculo hoje.', 'validado', 'Validar sem conferir o rendimento com o chão de fábrica.', 59),
 ('prod.estrutura.fonte_padrao', 'Fonte do padrão', 'De onde veio o rendimento padrão (manual do fornecedor, medição, histórico…). Texto livre.', 'Registra a confiança do número. Não entra em conta.', 'medição de 06/10', 'Deixar vazio: depois ninguém sabe se o padrão é chute.', 60),
 ('prod.estrutura.arquivar', 'Arquivar ligação', 'Tira a ligação da árvore sem apagar (fica arquivada e pode voltar).', 'Preserva o histórico. A ligação arquivada deixa de contar para a árvore, a soma de rendimentos e a prontidão do fluxo.', 'Ligação que saiu da operação', 'Arquivar para "corrigir": edite a ligação.', 61),
 ('prod.estrutura.colar', 'Colar lista', 'Uma ligação por linha: origem;produto;tipo_saida;rendimento_pct;etapa. Origem e produto são os códigos já cadastrados. Tipo, rendimento e etapa são opcionais (rendimento em branco = a definir).', 'Mostra a prévia, avisa o que não casou e grava só as linhas válidas, como rascunho. Nenhum dado é inventado: código que não existe fica de fora.', '11;47;principal;12,5;Desossa de Bola', 'Usar nome em vez de código na origem/produto: não casa e a linha é recusada.', 62),
 ('prod.fluxo.produto_origem', 'Produto de origem do fluxo', 'O produto que ENTRA nesta etapa (um dos cadastrados da planta).', 'Sem ele o aviso "Pronto para medir" do fluxo fica pendente. Será a base do balanço de massa da etapa.', 'Bola com osso', 'Confundir com o acabado: aqui é o que entra, não o que sai.', 63)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
