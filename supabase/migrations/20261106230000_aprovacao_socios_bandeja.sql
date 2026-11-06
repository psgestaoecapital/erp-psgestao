-- Aprovação pelos SÓCIOS (CEO 06/11/2026): "nada deve ficar parado; deve fluir com OK de qualquer um de nós" —
-- Rodrigo e Jordana aprovam "como eu aprovo" (são sócios e desenvolvem o sistema junto com o CEO).
--
-- Antes: a PR que o revisor manda para a "BANDEJA DO CEO" só saía com a etiqueta `ceo-aprovado`, que só o CEO punha
-- no GitHub; o OK de núcleo da caixa (requer_ok_ceo) só o Eng. Chefe registrava; a Jordana não tinha escopo de
-- chamados (o "OK do sócio" não existia para ela).
-- Agora (aditivo):
--   1) erp_aprovador_pr: quem aprova (CEO, Rodrigo, Jordana). Mesmo poder para os três.
--   2) erp_pr_bandeja: espelho das PRs na bandeja (gravado pelo workflow bandeja-socios.yml, canal de serviço).
--   3) fn_pr_bandeja_aprovar: o aprovador LOGADO no ERP aprova ou recusa a PR, com justificativa, para o patch-id
--      que está na bandeja. O workflow põe a etiqueta `ceo-aprovado` no GitHub com o comentário "OK DE SÓCIO" (quem,
--      quando, patch-id) — o revisor e a fila já entendem essa etiqueta, nada muda para eles.
--   4) fn_aprovador_ok_mensagem: o aprovador logado dá o OK de núcleo de uma mensagem da caixa (requer_ok_ceo), igual
--      ao fn_agente_mensagem_ok_ceo do Eng. Chefe, com ok_ceo_origem = 'OK de <nome> no ERP'.
--   5) Jordana passa a ter escopo de chamados (como o Rodrigo): chamado dela vai para o jordana-code e ela aprova a
--      resposta ao cliente no próprio chamado (fn_agente_ok_socio).
-- Tudo fica gravado (quem, quando, o quê) e as telas mostram o histórico.

-- 1) aprovadores
CREATE TABLE IF NOT EXISTS public.erp_aprovador_pr (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_aprovador_pr ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_aprovador_pr FROM PUBLIC, anon;

INSERT INTO public.erp_aprovador_pr (user_id, nome)
SELECT u.id, v.nome FROM (VALUES
  ('gilberto.paravizi@gmail.com', 'Gilberto (CEO)'),
  ('gilberto.paravizi@yahoo.com.br', 'Gilberto (CEO)'),
  ('rodrigo.rjantsch@gmail.com', 'Rodrigo'),
  ('jordanacarolinar@gmail.com', 'Jordana')
) AS v(email, nome) JOIN auth.users u ON lower(u.email) = v.email
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn__aprovador_pr_assert()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_nome text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'login_obrigatorio' USING ERRCODE = '42501'; END IF;
  SELECT a.nome INTO v_nome FROM public.erp_aprovador_pr a WHERE a.user_id = auth.uid() AND a.ativo;
  IF v_nome IS NULL THEN RAISE EXCEPTION 'so_socios_aprovam' USING ERRCODE = '42501'; END IF;
  RETURN v_nome;
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn__aprovador_pr_assert() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__aprovador_pr_assert() TO authenticated;

CREATE OR REPLACE FUNCTION public.fn__eh_aprovador_pr()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$ SELECT EXISTS (SELECT 1 FROM public.erp_aprovador_pr a WHERE a.user_id = auth.uid() AND a.ativo) $fn$;
REVOKE ALL ON FUNCTION public.fn__eh_aprovador_pr() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn__eh_aprovador_pr() TO authenticated;

DROP POLICY IF EXISTS erp_aprovador_pr_ler ON public.erp_aprovador_pr;
CREATE POLICY erp_aprovador_pr_ler ON public.erp_aprovador_pr FOR SELECT TO authenticated
  USING (public.fn__eh_aprovador_pr());

-- 2) bandeja (espelho do GitHub) e decisões
CREATE TABLE IF NOT EXISTS public.erp_pr_bandeja (
  pr_numero integer PRIMARY KEY,
  titulo text NOT NULL,
  code text,
  url text,
  patch_id text,
  motivo text,
  situacao text NOT NULL DEFAULT 'aguardando' CHECK (situacao IN ('aguardando','aprovada','recusada','saiu')),
  entrou_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erp_pr_bandeja ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_pr_bandeja FROM PUBLIC, anon;
DROP POLICY IF EXISTS erp_pr_bandeja_ler ON public.erp_pr_bandeja;
CREATE POLICY erp_pr_bandeja_ler ON public.erp_pr_bandeja FOR SELECT TO authenticated
  USING (public.fn__eh_aprovador_pr());

CREATE TABLE IF NOT EXISTS public.erp_pr_aprovacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_numero integer NOT NULL,
  patch_id text,
  decisao text NOT NULL CHECK (decisao IN ('aprovada','recusada')),
  justificativa text NOT NULL,
  aprovado_por uuid NOT NULL REFERENCES auth.users(id),
  aprovado_nome text NOT NULL,
  aprovado_em timestamptz NOT NULL DEFAULT now(),
  sincronizado_em timestamptz,
  sincronizado_resultado text
);
CREATE INDEX IF NOT EXISTS erp_pr_aprovacao_pendente_idx ON public.erp_pr_aprovacao (aprovado_em) WHERE sincronizado_em IS NULL;
ALTER TABLE public.erp_pr_aprovacao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.erp_pr_aprovacao FROM PUBLIC, anon;
DROP POLICY IF EXISTS erp_pr_aprovacao_ler ON public.erp_pr_aprovacao;
CREATE POLICY erp_pr_aprovacao_ler ON public.erp_pr_aprovacao FOR SELECT TO authenticated
  USING (public.fn__eh_aprovador_pr());

-- 3) tela: listar e decidir
CREATE OR REPLACE FUNCTION public.fn_pr_bandeja_listar()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_nome text := public.fn__aprovador_pr_assert();
BEGIN
  RETURN jsonb_build_object(
    'ok', true, 'eu', v_nome,
    'aguardando', coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.entrou_em) FROM public.erp_pr_bandeja b WHERE b.situacao = 'aguardando'), '[]'::jsonb),
    'decididas', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.aprovado_em DESC) FROM (
        SELECT a.pr_numero, a.decisao, a.justificativa, a.aprovado_nome, a.aprovado_em, a.sincronizado_em, a.sincronizado_resultado,
               b.titulo, b.url, b.code
        FROM public.erp_pr_aprovacao a LEFT JOIN public.erp_pr_bandeja b ON b.pr_numero = a.pr_numero
        ORDER BY a.aprovado_em DESC LIMIT 20) x), '[]'::jsonb),
    'nucleo', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'para', m.para, 'de', m.de, 'assunto', m.assunto,
        'criado_em', m.criado_em, 'corpo', left(m.corpo, 600)) ORDER BY m.criado_em)
      FROM public.erp_agente_mensagem m
      WHERE m.requer_ok_ceo AND m.ok_ceo_em IS NULL AND NOT coalesce(m.arquivada, false)
        AND m.status NOT IN ('concluida','recusada')), '[]'::jsonb)
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_pr_bandeja_listar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pr_bandeja_listar() TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_pr_bandeja_aprovar(p_pr_numero integer, p_patch_id text, p_decisao text, p_justificativa text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_nome text := public.fn__aprovador_pr_assert();
  b record;
BEGIN
  IF p_decisao NOT IN ('aprovada','recusada') THEN RETURN jsonb_build_object('ok', false, 'erro', 'decisao_invalida'); END IF;
  IF length(btrim(coalesce(p_justificativa, ''))) < 10 THEN RETURN jsonb_build_object('ok', false, 'erro', 'justificativa_curta'); END IF;
  SELECT * INTO b FROM public.erp_pr_bandeja WHERE pr_numero = p_pr_numero FOR UPDATE;
  IF NOT FOUND OR b.situacao <> 'aguardando' THEN RETURN jsonb_build_object('ok', false, 'erro', 'pr_fora_da_bandeja'); END IF;
  -- a decisão vale para a versão que está na bandeja: se o código mudou depois, o revisor revisa de novo
  IF b.patch_id IS NOT NULL AND b.patch_id IS DISTINCT FROM p_patch_id THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'versao_mudou', 'patch_id_atual', b.patch_id);
  END IF;
  INSERT INTO public.erp_pr_aprovacao (pr_numero, patch_id, decisao, justificativa, aprovado_por, aprovado_nome)
  VALUES (p_pr_numero, b.patch_id, p_decisao, btrim(p_justificativa), auth.uid(), v_nome);
  UPDATE public.erp_pr_bandeja SET situacao = p_decisao, atualizado_em = now() WHERE pr_numero = p_pr_numero;
  RETURN jsonb_build_object('ok', true, 'pr', p_pr_numero, 'decisao', p_decisao, 'por', v_nome);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_pr_bandeja_aprovar(integer, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pr_bandeja_aprovar(integer, text, text, text) TO authenticated;

-- 4) OK de núcleo da caixa dado por um sócio logado (mesmo efeito do OK que o Eng. Chefe registra)
CREATE OR REPLACE FUNCTION public.fn_aprovador_ok_mensagem(p_mensagem_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_nome text := public.fn__aprovador_pr_assert();
  m record;
BEGIN
  SELECT * INTO m FROM public.erp_agente_mensagem WHERE id = p_mensagem_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_encontrada'); END IF;
  IF NOT m.requer_ok_ceo THEN RETURN jsonb_build_object('ok', false, 'erro', 'mensagem_nao_pede_ok'); END IF;
  IF m.ok_ceo_em IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'ja_registrado', m.ok_ceo_em); END IF;
  UPDATE public.erp_agente_mensagem
     SET ok_ceo_em = now(), ok_ceo_origem = 'OK de ' || v_nome || ' no ERP', atualizado_em = now()
   WHERE id = p_mensagem_id;
  RETURN jsonb_build_object('ok', true, 'por', v_nome);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_aprovador_ok_mensagem(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_aprovador_ok_mensagem(uuid) TO authenticated;

-- 5) canal de serviço do workflow (bandeja-socios.yml): espelhar a bandeja e entregar as decisões ao GitHub
CREATE OR REPLACE FUNCTION public.fn_pr_bandeja_sincronizar(p_itens jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE v_n integer := 0;
BEGIN
  PERFORM public.fn__agente_assert_servico();
  INSERT INTO public.erp_pr_bandeja AS b (pr_numero, titulo, code, url, patch_id, motivo)
  SELECT (i->>'pr')::int, coalesce(i->>'titulo', ''), i->>'code', i->>'url', i->>'patch_id', left(i->>'motivo', 4000)
  FROM jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) i
  ON CONFLICT (pr_numero) DO UPDATE SET
    titulo = EXCLUDED.titulo, code = EXCLUDED.code, url = EXCLUDED.url, motivo = EXCLUDED.motivo, atualizado_em = now(),
    -- versão nova na bandeja (o código mudou e o revisor mandou de novo) → volta a esperar decisão
    situacao = CASE WHEN b.patch_id IS DISTINCT FROM EXCLUDED.patch_id THEN 'aguardando' ELSE b.situacao END,
    patch_id = EXCLUDED.patch_id,
    entrou_em = CASE WHEN b.patch_id IS DISTINCT FROM EXCLUDED.patch_id OR b.situacao = 'saiu' THEN now() ELSE b.entrou_em END;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- o que não está mais na bandeja do GitHub (publicada, fechada, autorizada) sai da lista
  UPDATE public.erp_pr_bandeja b SET situacao = 'saiu', atualizado_em = now()
   WHERE b.situacao = 'aguardando'
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) i WHERE (i->>'pr')::int = b.pr_numero);
  RETURN jsonb_build_object('ok', true, 'na_bandeja', v_n);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_pr_bandeja_sincronizar(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_pr_aprovacao_pendentes()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.fn__agente_assert_servico();
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'pr', a.pr_numero, 'patch_id', a.patch_id, 'decisao', a.decisao,
      'justificativa', a.justificativa, 'por', a.aprovado_nome, 'em', a.aprovado_em) ORDER BY a.aprovado_em)
    FROM public.erp_pr_aprovacao a WHERE a.sincronizado_em IS NULL), '[]'::jsonb);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_pr_aprovacao_pendentes() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_pr_aprovacao_marcar(p_id uuid, p_resultado text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  PERFORM public.fn__agente_assert_servico();
  UPDATE public.erp_pr_aprovacao SET sincronizado_em = now(), sincronizado_resultado = left(p_resultado, 300)
   WHERE id = p_id AND sincronizado_em IS NULL;
  RETURN jsonb_build_object('ok', true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.fn_pr_aprovacao_marcar(uuid, text) FROM PUBLIC, anon, authenticated;

-- 6) Jordana com escopo de chamados (igual ao Rodrigo): chamado aberto por ela ou com ela de responsável → jordana-code,
--    e ela aprova a resposta ao cliente no próprio chamado
INSERT INTO public.erp_agente_escopo (agente, socio_user_id, equipe_agente, ativo)
SELECT 'jordana-code', u.id, 'code-jordana', true FROM auth.users u WHERE lower(u.email) = 'jordanacarolinar@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM public.erp_agente_escopo e WHERE e.agente = 'jordana-code');

-- 7) "?" da tela (RD-95)
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Aprovações dos sócios', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, '/dashboard/dev/codes', 'dev', 'publicado'
FROM (VALUES
 ('dev.aprovar.bandeja', 'Aprovações pendentes', 'Nada a preencher: é a lista do que espera o OK de um sócio.', 'PRs que o revisor não publica sozinho (documento fiscal, financeiro de cliente, permissão etc.) e pedidos de núcleo da caixa. Qualquer sócio aprova.', 'PR #3951 — nome do comprador PF na NF-e de veículo.', 'Achar que só o CEO aprova: Gilberto, Rodrigo e Jordana aprovam igual.', 1),
 ('dev.aprovar.justificativa', 'Justificativa', 'Escreva em uma ou duas frases por que aprova ou recusa (mínimo 10 letras).', 'Fica gravada com o seu nome e vai no comentário da PR, para o revisor e os outros sócios verem.', '"Regra confirmada com a Alliance: PF sem razão social usa o nome do cadastro."', 'Escrever só "ok": não explica a decisão para quem ler depois.', 2),
 ('dev.aprovar.botao', 'Aprovar / Recusar', 'Toque depois de ler o resumo do revisor e escrever a justificativa.', 'Aprovar: em até 15 minutos a PR ganha a etiqueta ceo-aprovado e o revisor publica. Recusar: a PR fica parada e o Code recebe o motivo.', 'Aprovar a #3951 → publica na próxima rodada da fila.', 'Aprovar uma versão antiga: se o código mudou, a tela avisa e pede para atualizar.', 3),
 ('dev.aprovar.nucleo', 'OK de núcleo', 'Toque em "Dar OK" no pedido da caixa que você leu.', 'Libera o Code para executar uma tarefa de núcleo (permissão, fiscal, financeiro de cliente) ou responder o cliente.', 'Pedido da Jordana para mudar o cadastro de empresa (UF e endereço).', 'Dar OK sem ler o pedido: o Code executa na hora.', 4)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo a WHERE a.chave = v.chave);
