-- P&M · Social mínimo (CEO 03/10, spec aprovada com as correções do Eng. Chefe): planejamento mensal por cliente,
-- posts com briefing estruturado, calendário e "post aprovado vira job" sozinho.
--
-- RD-26 (reusa o que existe): cliente = erp_clientes (o cadastro único da empresa — NÃO agency_clientes); o job é o
-- agency_jobs de sempre (número pelo gatilho do Bloco 1, perfil P&M do cliente por fn_pm_cliente_garantir); as redes
-- sociais são uma lista configurável da empresa em agency_config_opcao (lista 'rede_social'), sem lista fixa em CHECK.
--
--   1) agency_servico.antecedencia_dias (padrão 2): quantos dias antes da publicação a peça tem de ficar pronta.
--   2) Redes sociais: padrões Instagram, Facebook, LinkedIn, TikTok, YouTube e Google em fn_agency_config_defaults —
--      semeadas por empresa no primeiro uso (fn_agency_config_listar ou o primeiro post); a empresa renomeia, oculta e
--      cria as suas em P&M › Configurações › Listas. Rede em uso por post não pode ser removida.
--   3) agency_planejamentos: empresa, cliente, mês, campanha, título, situação (rascunho / em aprovação / aprovado),
--      responsável, observações, autoria, lixeira. Mais de um planejamento por cliente e mês é permitido; único por
--      empresa + cliente + mês + campanha (sem campanha conta como campanha vazia), entre os que não estão na lixeira.
--   4) agency_posts: planejamento, cliente (do planejamento), assunto, publicar_em, redes (chaves da lista da empresa,
--      conferidas), peça (agency_servico), briefing estruturado (arte, texto da arte, legenda, hashtags), responsável,
--      situação, job gerado, ordem, lixeira.
--   5) Post aprovado (com peça e data de publicação) vira job: cliente, peça, responsável (o do post ou o padrão da peça),
--      briefing montado e prazo = data de publicação − antecedência da peça. Se a publicação muda, o prazo do job
--      acompanha (e o feed do job registra); prazo do job depois da publicação é recusado.
--   6) RLS por empresa, nada para anônimo, sem DELETE (lixeira); "?" de cada campo; menu "Planejamento" e "Calendário";
--      demonstração: planejamento do mês para 2 clientes da demo da P&M, encadeado no fn_demo_reset (RD-69).

-- ── 1) antecedência da peça ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.agency_servico
  ADD COLUMN IF NOT EXISTS antecedencia_dias integer NOT NULL DEFAULT 2 CHECK (antecedencia_dias BETWEEN 0 AND 60);
COMMENT ON COLUMN public.agency_servico.antecedencia_dias IS
  'Dias antes da publicação em que a peça precisa estar pronta (prazo do job gerado pelo post = publicação − antecedência).';

-- ── 2) redes sociais: padrões da lista configurável (corpo vigente preservado + lista rede_social) ─────────────────
CREATE OR REPLACE FUNCTION public.fn_agency_config_defaults(p_lista text)
RETURNS TABLE(valor text, rotulo text, ordem int)
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT v, r, o FROM (VALUES
    ('area_equipe','social','Social',10),('area_equipe','trafego','Tráfego',20),('area_equipe','criacao','Criação',30),
    ('area_equipe','audiovisual','Audiovisual',40),('area_equipe','estrategia','Estratégia',50),
    ('unidade','mes','mês',10),('unidade','projeto','projeto',20),('unidade','hora','hora',30),
    ('unidade','post','post',40),('unidade','campanha','campanha',50),('unidade','unidade','unidade',60),
    ('periodicidade','mensal','mensal',10),('periodicidade','quinzenal','quinzenal',20),('periodicidade','semanal','semanal',30),
    ('periodicidade','unico','único',40),('periodicidade','sob_demanda','sob demanda',50),
    ('rede_social','instagram','Instagram',10),('rede_social','facebook','Facebook',20),('rede_social','linkedin','LinkedIn',30),
    ('rede_social','tiktok','TikTok',40),('rede_social','youtube','YouTube',50),('rede_social','google','Google',60)
  ) AS d(l,v,r,o) WHERE d.l = p_lista;
$function$;

-- excluir opção: além das listas do catálogo, rede social em uso por post (fora da lixeira) não sai (RD-54)
CREATE OR REPLACE FUNCTION public.fn_agency_config_excluir(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_row agency_config_opcao%ROWTYPE; v_qtd int := 0; v_col text;
BEGIN
  SELECT * INTO v_row FROM agency_config_opcao WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'opcao não encontrada'); END IF;
  IF NOT is_admin() AND v_row.company_id NOT IN (SELECT get_user_company_ids()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem acesso'); END IF;

  v_col := CASE v_row.lista WHEN 'area_equipe' THEN 'area' WHEN 'unidade' THEN 'unidade' WHEN 'periodicidade' THEN 'periodicidade' ELSE NULL END;
  IF v_col IS NOT NULL THEN
    EXECUTE format('SELECT count(*) FROM agency_servico WHERE company_id = $1 AND %I = $2', v_col)
      INTO v_qtd USING v_row.company_id, v_row.valor;
    IF v_qtd > 0 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'opcao_em_uso', 'qtd', v_qtd); END IF;
  END IF;
  IF v_row.lista = 'rede_social' THEN
    SELECT count(*) INTO v_qtd FROM agency_posts
     WHERE company_id = v_row.company_id AND v_row.valor = ANY (redes) AND excluido_em IS NULL;
    IF v_qtd > 0 THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'opcao_em_uso', 'qtd', v_qtd,
        'mensagem', 'Rede usada em posts. Oculte a rede em vez de remover.'); END IF;
  END IF;

  DELETE FROM agency_config_opcao WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_agency_config_excluir(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_agency_config_excluir(uuid) TO authenticated, service_role;

-- ── 3) planejamento ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agency_planejamentos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cliente_id     uuid NOT NULL REFERENCES public.erp_clientes(id),
  mes            date NOT NULL,
  campanha       text,
  titulo         text NOT NULL CHECK (length(btrim(titulo)) > 0),
  status         text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'em_aprovacao', 'aprovado')),
  responsavel_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  observacoes    text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  excluido_em    timestamptz,
  excluido_por   uuid,
  CHECK (mes = date_trunc('month', mes)::date)
);
COMMENT ON TABLE public.agency_planejamentos IS 'P&M · Social: planejamento mensal de posts de um cliente (erp_clientes). Lixeira por excluido_em.';
COMMENT ON COLUMN public.agency_planejamentos.cliente_id IS 'Cliente do cadastro único da empresa (erp_clientes).';
-- único por empresa + cliente + mês + campanha (campanha vazia conta como ''), só entre os que não estão na lixeira
CREATE UNIQUE INDEX IF NOT EXISTS agency_planejamentos_uk
  ON public.agency_planejamentos (company_id, cliente_id, mes, lower(COALESCE(campanha, '')))
  WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS agency_planejamentos_mes_idx ON public.agency_planejamentos (company_id, mes) WHERE excluido_em IS NULL;

-- ── 4) posts ────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agency_posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  planejamento_id uuid NOT NULL REFERENCES public.agency_planejamentos(id) ON DELETE CASCADE,
  cliente_id      uuid NOT NULL REFERENCES public.erp_clientes(id),
  assunto         text NOT NULL CHECK (length(btrim(assunto)) > 0),
  publicar_em     timestamptz,
  redes           text[] NOT NULL DEFAULT '{}',
  servico_id      uuid REFERENCES public.agency_servico(id) ON DELETE SET NULL,
  arte            text,
  texto_arte      text,
  legenda         text,
  hashtags        text,
  responsavel_id  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'em_aprovacao', 'aprovado', 'publicado')),
  job_id          uuid REFERENCES public.agency_jobs(id) ON DELETE SET NULL,
  ordem           integer NOT NULL DEFAULT 0,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  excluido_em     timestamptz,
  excluido_por    uuid
);
COMMENT ON TABLE public.agency_posts IS 'P&M · Social: post do planejamento. Aprovado (com peça e publicação) vira job (job_id) com prazo = publicação − antecedência da peça.';
COMMENT ON COLUMN public.agency_posts.redes IS 'Chaves (valor) da lista rede_social da empresa em agency_config_opcao — conferidas pelo gatilho.';
CREATE INDEX IF NOT EXISTS agency_posts_planejamento_idx ON public.agency_posts (planejamento_id, ordem) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS agency_posts_publicar_idx ON public.agency_posts (company_id, publicar_em) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS agency_posts_job_idx ON public.agency_posts (job_id) WHERE job_id IS NOT NULL;

-- ── 5) regras (gatilhos) ────────────────────────────────────────────────────────────────────────────────────────
-- Planejamento: mês = 1º dia, campanha aparada, cliente da mesma empresa, duplicata com mensagem clara, autoria pelo
-- login (não pelo que o cliente manda), empresa não muda, cliente não muda depois que algum post virou job.
CREATE OR REPLACE FUNCTION public.trg_agency_planejamento_validar() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
-- Guarda de empresa logo no início: o gatilho roda ANTES da RLS (WITH CHECK) — sem ela, quem não é da empresa
-- saberia pela mensagem de duplicata que existe um planejamento daquele cliente/mês/campanha.
DECLARE v_meses text[] := ARRAY['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
BEGIN
  PERFORM public.fn__guarda_empresa(NEW.company_id);
  NEW.mes := date_trunc('month', NEW.mes)::date;
  NEW.campanha := NULLIF(btrim(COALESCE(NEW.campanha, '')), '');
  NEW.titulo := btrim(COALESCE(NEW.titulo, ''));
  IF NOT EXISTS (SELECT 1 FROM erp_clientes c WHERE c.id = NEW.cliente_id AND c.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'O cliente escolhido não é do cadastro desta empresa.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'A empresa do planejamento não pode mudar.' USING ERRCODE = '23514';
    END IF;
    IF NEW.cliente_id IS DISTINCT FROM OLD.cliente_id
       AND EXISTS (SELECT 1 FROM agency_posts p WHERE p.planejamento_id = NEW.id AND p.job_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Este planejamento já tem posts que viraram job: o cliente não pode mudar.' USING ERRCODE = '23514';
    END IF;
    NEW.created_by := OLD.created_by; NEW.created_at := OLD.created_at; NEW.updated_at := now();
    IF NEW.excluido_em IS NOT NULL AND OLD.excluido_em IS NULL THEN NEW.excluido_por := auth.uid(); END IF;
    IF NEW.excluido_em IS NULL THEN NEW.excluido_por := NULL; END IF;
  ELSE
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
    NEW.excluido_por := NULL;
  END IF;
  IF NEW.excluido_em IS NULL AND EXISTS (
       SELECT 1 FROM agency_planejamentos p
        WHERE p.company_id = NEW.company_id AND p.cliente_id = NEW.cliente_id AND p.mes = NEW.mes
          AND lower(COALESCE(p.campanha, '')) = lower(COALESCE(NEW.campanha, ''))
          AND p.excluido_em IS NULL AND p.id <> NEW.id) THEN
    RAISE EXCEPTION 'Já existe um planejamento deste cliente em % de % %. Use outra campanha ou abra o que já existe.',
      v_meses[extract(month FROM NEW.mes)::int], extract(year FROM NEW.mes)::int,
      CASE WHEN NEW.campanha IS NULL THEN 'sem campanha' ELSE format('com a campanha "%s"', NEW.campanha) END
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trg_agency_planejamento_validar() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_agency_planejamento_validar ON public.agency_planejamentos;
CREATE TRIGGER trg_agency_planejamento_validar BEFORE INSERT OR UPDATE ON public.agency_planejamentos
  FOR EACH ROW EXECUTE FUNCTION public.trg_agency_planejamento_validar();

-- Planejamento → posts: o cliente acompanha; ir para a lixeira leva os posts junto (e voltar traz os mesmos). Jobs ficam.
CREATE OR REPLACE FUNCTION public.trg_agency_planejamento_posts() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
-- ci-sem-guarda: trg_agency_planejamento_posts — gatilho do próprio planejamento gravado; só mexe nos posts dele
BEGIN
  IF NEW.cliente_id IS DISTINCT FROM OLD.cliente_id THEN
    UPDATE agency_posts SET cliente_id = NEW.cliente_id WHERE planejamento_id = NEW.id;
  END IF;
  IF NEW.excluido_em IS NOT NULL AND OLD.excluido_em IS NULL THEN
    UPDATE agency_posts SET excluido_em = NEW.excluido_em WHERE planejamento_id = NEW.id AND excluido_em IS NULL;
  ELSIF NEW.excluido_em IS NULL AND OLD.excluido_em IS NOT NULL THEN
    UPDATE agency_posts SET excluido_em = NULL WHERE planejamento_id = NEW.id AND excluido_em = OLD.excluido_em;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.trg_agency_planejamento_posts() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_agency_planejamento_posts ON public.agency_planejamentos;
CREATE TRIGGER trg_agency_planejamento_posts AFTER UPDATE ON public.agency_planejamentos
  FOR EACH ROW EXECUTE FUNCTION public.trg_agency_planejamento_posts();

-- Post: planejamento e peça da mesma empresa; cliente = o do planejamento; redes conferidas na lista da empresa
-- (semeada no primeiro uso); aprovar exige peça e publicação; ao virar "aprovado" cria o job (uma vez só).
CREATE OR REPLACE FUNCTION public.trg_agency_post_validar() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
-- Guarda de empresa logo no início (o gatilho roda antes da RLS); o perfil P&M do cliente passa por fn_pm_cliente_garantir,
-- que confere a empresa de novo.
DECLARE
  p agency_planejamentos%ROWTYPE; s agency_servico%ROWTYPE;
  v_old_redes text[] := '{}'; v_old_status text; v_invalidas text[]; v_redes_txt text;
  v_prazo date; v_resp uuid; v_resp_nome text; v_cli uuid; v_desc text;
BEGIN
  PERFORM public.fn__guarda_empresa(NEW.company_id);
  SELECT * INTO p FROM agency_planejamentos WHERE id = NEW.planejamento_id;
  IF NOT FOUND OR p.company_id <> NEW.company_id THEN
    RAISE EXCEPTION 'Planejamento não encontrado nesta empresa.' USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF p.excluido_em IS NOT NULL THEN RAISE EXCEPTION 'O planejamento está na lixeira.' USING ERRCODE = '23514'; END IF;
    NEW.job_id := NULL;                                   -- só o gatilho liga o post ao job
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
    NEW.excluido_por := NULL;
  ELSE
    IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
      RAISE EXCEPTION 'A empresa do post não pode mudar.' USING ERRCODE = '23514';
    END IF;
    v_old_redes := COALESCE(OLD.redes, '{}'); v_old_status := OLD.status;
    IF NEW.job_id IS NOT NULL AND NEW.job_id IS DISTINCT FROM OLD.job_id THEN NEW.job_id := OLD.job_id; END IF;
    NEW.created_by := OLD.created_by; NEW.created_at := OLD.created_at; NEW.updated_at := now();
    IF NEW.excluido_em IS NOT NULL AND OLD.excluido_em IS NULL THEN NEW.excluido_por := auth.uid(); END IF;
    IF NEW.excluido_em IS NULL THEN NEW.excluido_por := NULL; END IF;
  END IF;
  NEW.cliente_id := p.cliente_id;
  NEW.assunto := btrim(COALESCE(NEW.assunto, ''));

  -- redes: sem repetidas, na ordem escolhida; as novas têm de estar ativas na lista da empresa
  NEW.redes := COALESCE(ARRAY(SELECT x FROM unnest(COALESCE(NEW.redes, '{}')) WITH ORDINALITY u(x, n)
                               WHERE btrim(x) <> '' GROUP BY x ORDER BY min(n)), '{}');
  IF NOT EXISTS (SELECT 1 FROM agency_config_opcao o WHERE o.company_id = NEW.company_id AND o.lista = 'rede_social') THEN
    INSERT INTO agency_config_opcao (company_id, lista, valor, rotulo, ordem)
    SELECT NEW.company_id, 'rede_social', d.valor, d.rotulo, d.ordem FROM fn_agency_config_defaults('rede_social') d
    ON CONFLICT (company_id, lista, valor) DO NOTHING;
  END IF;
  SELECT array_agg(r) INTO v_invalidas FROM unnest(NEW.redes) r
   WHERE NOT (r = ANY (v_old_redes))
     AND NOT EXISTS (SELECT 1 FROM agency_config_opcao o
                      WHERE o.company_id = NEW.company_id AND o.lista = 'rede_social' AND o.valor = r AND o.ativo);
  IF v_invalidas IS NOT NULL THEN
    RAISE EXCEPTION 'Rede social que não está na lista da empresa (ou está oculta): %. Cadastre em P&M › Configurações › Listas › Redes sociais.',
      array_to_string(v_invalidas, ', ') USING ERRCODE = '23514';
  END IF;

  IF NEW.servico_id IS NOT NULL THEN
    SELECT * INTO s FROM agency_servico WHERE id = NEW.servico_id;
    IF NOT FOUND OR s.company_id <> NEW.company_id THEN
      RAISE EXCEPTION 'Peça não encontrada no catálogo desta empresa.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status IN ('aprovado', 'publicado') AND (NEW.servico_id IS NULL OR NEW.publicar_em IS NULL) THEN
    RAISE EXCEPTION 'Para aprovar o post, informe a peça e a data de publicação.' USING ERRCODE = '23514';
  END IF;
  IF NEW.job_id IS NOT NULL AND NEW.publicar_em IS NULL THEN
    RAISE EXCEPTION 'Este post já virou job: a data de publicação não pode ficar vazia.' USING ERRCODE = '23514';
  END IF;

  -- aprovado → job (só na passagem para aprovado; o job nunca é apagado por aqui)
  IF NEW.status IN ('aprovado', 'publicado') AND NEW.job_id IS NULL AND NEW.excluido_em IS NULL
     AND (TG_OP = 'INSERT' OR v_old_status NOT IN ('aprovado', 'publicado')) THEN
    v_prazo := (NEW.publicar_em AT TIME ZONE 'America/Sao_Paulo')::date - COALESCE(s.antecedencia_dias, 2);
    v_cli := public.fn_pm_cliente_garantir(NEW.company_id, NEW.cliente_id);
    v_resp := NEW.responsavel_id;
    IF v_resp IS NULL AND s.responsavel_padrao_id IS NOT NULL THEN
      SELECT e.user_id, e.nome INTO v_resp, v_resp_nome FROM agency_equipe e
       WHERE e.id = s.responsavel_padrao_id AND e.company_id = NEW.company_id;
    END IF;
    IF v_resp IS NOT NULL THEN
      SELECT COALESCE(NULLIF(btrim(u.full_name), ''), v_resp_nome, u.email) INTO v_resp_nome FROM users u WHERE u.id = v_resp;
    END IF;
    SELECT string_agg(COALESCE(o.rotulo, u.r), ', ' ORDER BY u.n) INTO v_redes_txt
      FROM unnest(NEW.redes) WITH ORDINALITY u(r, n)
      LEFT JOIN agency_config_opcao o ON o.company_id = NEW.company_id AND o.lista = 'rede_social' AND o.valor = u.r;
    v_desc := concat_ws(E'\n\n',
      '**Planejamento:** ' || p.titulo || COALESCE(' · campanha ' || p.campanha, ''),
      '**Publicação:** ' || to_char(NEW.publicar_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI')
        || COALESCE(' · **Redes:** ' || v_redes_txt, ''),
      '**Arte:** ' || NULLIF(btrim(COALESCE(NEW.arte, '')), ''),
      '**Texto da arte:** ' || NULLIF(btrim(COALESCE(NEW.texto_arte, '')), ''),
      '**Legenda:** ' || NULLIF(btrim(COALESCE(NEW.legenda, '')), ''),
      '**Hashtags:** ' || NULLIF(btrim(COALESCE(NEW.hashtags, '')), ''));
    INSERT INTO agency_jobs (company_id, cliente_id, servico_id, titulo, descricao, tipo, status, prioridade,
                             responsavel_id, responsavel_nome, data_prazo, horas_estimadas, tags)
    VALUES (NEW.company_id, v_cli, NEW.servico_id, NEW.assunto, v_desc, 'social', 'nao_iniciada', 'normal',
            v_resp, v_resp_nome, v_prazo, COALESCE(s.horas_estimadas, 0), ARRAY['social'])
    RETURNING id INTO NEW.job_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trg_agency_post_validar() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_agency_post_validar ON public.agency_posts;
CREATE TRIGGER trg_agency_post_validar BEFORE INSERT OR UPDATE ON public.agency_posts
  FOR EACH ROW EXECUTE FUNCTION public.trg_agency_post_validar();

-- Publicação (ou peça) mudou depois do job → o prazo do job acompanha (publicação − antecedência) e o feed registra.
CREATE OR REPLACE FUNCTION public.trg_agency_post_sincronizar_job() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
-- ci-sem-guarda: trg_agency_post_sincronizar_job — gatilho do próprio post gravado; só mexe no job ligado a ele
DECLARE v_prazo date; v_antes date;
BEGIN
  IF NEW.job_id IS NULL OR NEW.publicar_em IS NULL OR NEW.job_id IS DISTINCT FROM OLD.job_id
     OR (NEW.publicar_em IS NOT DISTINCT FROM OLD.publicar_em AND NEW.servico_id IS NOT DISTINCT FROM OLD.servico_id) THEN
    RETURN NULL;
  END IF;
  v_prazo := (NEW.publicar_em AT TIME ZONE 'America/Sao_Paulo')::date
           - COALESCE((SELECT s.antecedencia_dias FROM agency_servico s WHERE s.id = NEW.servico_id), 2);
  SELECT data_prazo INTO v_antes FROM agency_jobs WHERE id = NEW.job_id AND excluido_em IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE agency_jobs SET data_prazo = v_prazo, servico_id = COALESCE(NEW.servico_id, servico_id), updated_at = now()
   WHERE id = NEW.job_id;
  IF v_antes IS DISTINCT FROM v_prazo THEN
    PERFORM public.fn__pm_job_registrar(NEW.company_id, NEW.job_id,
      format('Publicação do post mudou para %s: prazo do job passou de %s para %s.',
        to_char(NEW.publicar_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI'),
        COALESCE(to_char(v_antes, 'DD/MM/YYYY'), 'sem prazo'), to_char(v_prazo, 'DD/MM/YYYY')));
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.trg_agency_post_sincronizar_job() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_agency_post_sincronizar_job ON public.agency_posts;
CREATE TRIGGER trg_agency_post_sincronizar_job AFTER UPDATE ON public.agency_posts
  FOR EACH ROW EXECUTE FUNCTION public.trg_agency_post_sincronizar_job();

-- Job de post: prazo depois da data de publicação é recusado (vale para a Pauta, a edição em massa e qualquer tela).
CREATE OR REPLACE FUNCTION public.trg_agency_job_prazo_post() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
-- ci-sem-guarda: trg_agency_job_prazo_post — gatilho do próprio job gravado (a RLS de agency_jobs decide quem grava); só lê o post ligado
DECLARE v_pub date;
BEGIN
  IF NEW.data_prazo IS NULL OR NEW.data_prazo IS NOT DISTINCT FROM OLD.data_prazo THEN RETURN NEW; END IF;
  SELECT min((p.publicar_em AT TIME ZONE 'America/Sao_Paulo')::date) INTO v_pub
    FROM agency_posts p WHERE p.job_id = NEW.id AND p.excluido_em IS NULL AND p.publicar_em IS NOT NULL;
  IF v_pub IS NOT NULL AND NEW.data_prazo > v_pub THEN
    RAISE EXCEPTION 'O prazo do job (%) não pode ser depois da publicação do post (%). Mude a data de publicação no planejamento.',
      to_char(NEW.data_prazo, 'DD/MM/YYYY'), to_char(v_pub, 'DD/MM/YYYY') USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trg_agency_job_prazo_post() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_agency_job_prazo_post ON public.agency_jobs;
CREATE TRIGGER trg_agency_job_prazo_post BEFORE UPDATE OF data_prazo ON public.agency_jobs
  FOR EACH ROW EXECUTE FUNCTION public.trg_agency_job_prazo_post();

-- ── 6) RLS: por empresa; nada para anônimo; sem DELETE (lixeira) ─────────────────────────────────────────────────
ALTER TABLE public.agency_planejamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agency_planejamentos, public.agency_posts FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS agency_planejamentos_empresa ON public.agency_planejamentos;
CREATE POLICY agency_planejamentos_empresa ON public.agency_planejamentos FOR ALL TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
DROP POLICY IF EXISTS agency_posts_empresa ON public.agency_posts;
CREATE POLICY agency_posts_empresa ON public.agency_posts FOR ALL TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin())
  WITH CHECK (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
GRANT SELECT, INSERT, UPDATE ON public.agency_planejamentos, public.agency_posts TO authenticated;
GRANT ALL ON public.agency_planejamentos, public.agency_posts TO service_role;

-- ── 7) "?" de cada campo (textos no banco, editáveis sem deploy) ────────────────────────────────────────────────
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'pm', 'publicado'
FROM (VALUES
 ('pm.planejamento.filtro_mes', 'Filtro', 'Mês', 'Escolha o mês dos planejamentos que quer ver.', 'A lista mostra só os planejamentos daquele mês.', 'Outubro de 2026.', 'Procurar o planejamento de novembro com outubro selecionado.', 1, '/dashboard/pm/planejamento'),
 ('pm.planejamento.filtro_status', 'Filtro', 'Situação', 'Todas, rascunho, em aprovação ou aprovado.', 'Separa o que ainda está sendo montado do que o cliente já aprovou.', 'Em aprovação — para cobrar o retorno do cliente.', 'Achar que o planejamento sumiu quando está em outra situação.', 2, '/dashboard/pm/planejamento'),
 ('pm.planejamento.cliente', 'Planejamento', 'Cliente', 'Digite parte do nome, da razão social ou do CNPJ e escolha da lista.', 'A lista vem do cadastro de clientes da empresa — o mesmo do financeiro e das notas. O job gerado vai para este cliente.', '"serra" acha Café Serra Azul.', 'Cadastrar o cliente de novo com outro nome: procure antes pelo CNPJ.', 3, '/dashboard/pm/planejamento'),
 ('pm.planejamento.mes', 'Planejamento', 'Mês', 'O mês em que os posts serão publicados.', 'Organiza os planejamentos por mês e define o calendário.', 'Outubro de 2026.', 'Usar o mês em que o planejamento foi feito em vez do mês das publicações.', 4, '/dashboard/pm/planejamento'),
 ('pm.planejamento.campanha', 'Planejamento', 'Campanha', 'Nome da campanha, quando o cliente tem mais de um planejamento no mesmo mês. Pode ficar vazio.', 'Permite dois planejamentos do mesmo cliente no mesmo mês (um por campanha). Não pode repetir a mesma campanha no mesmo mês.', 'Outubro Rosa; Dia das Crianças.', 'Criar um segundo planejamento sem campanha no mesmo mês — o sistema recusa; dê um nome à campanha.', 5, '/dashboard/pm/planejamento'),
 ('pm.planejamento.titulo', 'Planejamento', 'Título', 'Um nome curto para o planejamento.', 'É o que aparece na lista e no briefing de cada job gerado.', 'Café Serra Azul · redes sociais de outubro.', 'Título genérico como "Planejamento" — ninguém acha depois.', 6, '/dashboard/pm/planejamento'),
 ('pm.planejamento.status', 'Planejamento', 'Situação', 'Rascunho enquanto monta; em aprovação quando enviou ao cliente; aprovado quando o cliente deu o ok.', 'Mostra em que pé está o mês do cliente. Os jobs nascem da aprovação de cada post.', 'Em aprovação desde segunda.', 'Marcar o planejamento como aprovado e esquecer de aprovar os posts — sem post aprovado não há job.', 7, '/dashboard/pm/planejamento'),
 ('pm.planejamento.responsavel', 'Planejamento', 'Responsável', 'Quem cuida do planejamento deste cliente (lista dos usuários ativos da empresa).', 'É quem responde pelo planejamento e cobra a aprovação.', 'Ana (social media).', 'Deixar sem responsável: ninguém cobra o cliente.', 8, '/dashboard/pm/planejamento'),
 ('pm.planejamento.observacoes', 'Planejamento', 'Observações', 'Combinados com o cliente, datas importantes, o que evitar no mês.', 'Contexto para quem cria os posts.', 'Loja fechada no feriado de 12/10; evitar foto de produto com preço.', 'Colocar aqui o briefing de um post: ele vai no post, não no planejamento.', 9, '/dashboard/pm/planejamento'),
 ('pm.post.assunto', 'Post', 'Assunto', 'Sobre o que é o post, em poucas palavras.', 'Vira o título do job quando o post é aprovado.', 'Lançamento do blend de outono.', 'Escrever o formato ("carrossel") no lugar do assunto — o formato é a peça.', 10, '/dashboard/pm/planejamento'),
 ('pm.post.publicar_em', 'Post', 'Publicar em', 'Dia e hora em que o post vai ao ar.', 'Define o calendário e o prazo do job: publicação menos a antecedência da peça. Se mudar a data, o prazo do job acompanha.', '10/10 às 18:00.', 'Pôr a data em que o post fica pronto: aqui é a data da publicação.', 11, '/dashboard/pm/planejamento'),
 ('pm.post.redes', 'Post', 'Redes', 'Marque onde o post será publicado. A lista é da empresa (P&M › Configurações › Listas › Redes sociais).', 'Aparece no calendário e no briefing do job.', 'Instagram e Facebook.', 'Procurar uma rede que a empresa ainda não cadastrou — cadastre antes nas Listas.', 12, '/dashboard/pm/planejamento'),
 ('pm.post.peca', 'Post', 'Peça', 'O formato do catálogo de serviços (post, carrossel, reels, stories…).', 'O job nasce com esta peça, o tempo estimado dela e a antecedência dela para o prazo.', 'Carrossel (antecedência de 2 dias).', 'Aprovar sem peça: o sistema pede a peça antes de gerar o job.', 13, '/dashboard/pm/planejamento'),
 ('pm.post.responsavel', 'Post', 'Responsável', 'Quem vai produzir. Vazio = o responsável padrão da peça no catálogo.', 'O job aparece na pauta e no "Meus" dessa pessoa.', 'Bruno (designer).', 'Deixar vazio numa peça sem responsável padrão: o job nasce sem dono.', 14, '/dashboard/pm/planejamento'),
 ('pm.post.status', 'Post', 'Situação', 'Rascunho → em aprovação → aprovado → publicado.', 'Ao aprovar, o post vira job sozinho, com prazo = publicação − antecedência da peça.', 'Aprovado (job 24150 criado).', 'Aprovar antes do cliente dar o ok: o job já entra na pauta da equipe.', 15, '/dashboard/pm/planejamento'),
 ('pm.post.arte', 'Briefing do post', 'Arte', 'O que a imagem ou o vídeo deve mostrar: cena, foto, cores, elementos.', 'Vai para o briefing do job — é o que o designer lê primeiro.', 'Foto do grão sendo moído, luz quente, logo no canto inferior.', '"Fazer uma arte bonita" — descreva o que aparece.', 16, '/dashboard/pm/planejamento'),
 ('pm.post.texto_arte', 'Briefing do post', 'Texto da arte', 'O texto que vai escrito na imagem (título, chamada, preço).', 'O designer copia daqui — evita erro de digitação na peça.', 'Novo blend de outono · disponível a partir de sexta.', 'Mandar o texto da arte por mensagem: some do histórico.', 17, '/dashboard/pm/planejamento'),
 ('pm.post.legenda', 'Briefing do post', 'Legenda', 'O texto que acompanha o post na rede.', 'Fica junto do briefing para a aprovação do cliente e para quem publica.', 'O outono chegou e trouxe um café novo… Vem provar!', 'Deixar a legenda para a hora de publicar — o cliente aprova sem ver.', 18, '/dashboard/pm/planejamento'),
 ('pm.post.hashtags', 'Briefing do post', 'Hashtags', 'As hashtags do post, separadas por espaço.', 'Vão para o briefing do job e para quem publica.', '#cafeespecial #outono #serraazul', 'Repetir as mesmas 30 hashtags em todo post.', 19, '/dashboard/pm/planejamento'),
 ('pm.calendario.visao', 'Calendário', 'Visão', 'Semana ou mês.', 'A semana mostra cada dia com os posts em ordem de horário; o mês mostra o mês inteiro de uma vez.', 'Semana, para a reunião de segunda.', 'Procurar um post de outro mês na visão de semana — use as setas ou "Ir para".', 1, '/dashboard/pm/calendario'),
 ('pm.calendario.data', 'Calendário', 'Ir para', 'Escolha um dia para abrir a semana ou o mês dele.', 'Pula direto para a data, sem passar semana por semana.', '15/10.', 'Achar que o calendário está vazio quando está em outro mês.', 2, '/dashboard/pm/calendario'),
 ('pm.calendario.cliente', 'Calendário', 'Cliente', 'Todos ou um cliente que tem planejamento.', 'Mostra só os posts desse cliente.', 'Clínica Sorriso Vale.', 'Esquecer o filtro de cliente ligado e achar que os outros posts sumiram.', 3, '/dashboard/pm/calendario'),
 ('pm.calendario.status', 'Calendário', 'Situação do post', 'Todas ou uma situação.', 'Separa o que ainda depende do cliente do que já virou job.', 'Em aprovação.', 'Filtrar "aprovado" e não ver os publicados — são situações diferentes.', 4, '/dashboard/pm/calendario'),
 ('pm.servico.antecedencia', 'Serviço', 'Antecedência (dias)', 'Quantos dias antes da publicação a peça precisa estar pronta.', 'O prazo do job gerado por um post é a data de publicação menos esta antecedência.', '2 para post; 5 para reels.', 'Deixar 0: o job vence no dia da publicação e não sobra tempo para aprovar.', 30, '/dashboard/pm/servicos')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;

-- ── 8) menu: "Planejamento" e "Calendário" no P&M (depois de Briefings), nos mesmos planos de "Jobs" ────────────
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, layer, vertical_specific, is_shared)
VALUES
  ('pm_planejamento', 'Planejamento', 'pm', 'pm_producao', 'CalendarRange', '/dashboard/pm/planejamento', 44, true,
   'Planejamento mensal de posts por cliente e campanha: briefing estruturado (arte, texto, legenda, hashtags), aprovação e post aprovado virando job com prazo antes da publicação.',
   '3_specific', ARRAY['pm'], false),
  ('pm_calendario', 'Calendário', 'pm', 'pm_producao', 'CalendarDays', '/dashboard/pm/calendario', 46, true,
   'Calendário de publicações (semana e mês) com cliente, redes, situação e o job de cada post.',
   '3_specific', ARRAY['pm'], false)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, m.id FROM public.plan_modules pm CROSS JOIN (VALUES ('pm_planejamento'), ('pm_calendario')) m(id)
 WHERE pm.module_id = 'pm_jobs'
   AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = m.id);
-- catálogo de telas (RD-35): a tela nasce já ligada à sua funcionalidade — entra sem estado, liga a feature e só então
-- vira "pronto" (o alerta de "tela órfã" do gatilho de system_screens não dispara à toa)
INSERT INTO public.feature_catalog (id, module_id, area, titulo, descricao_executiva, status, percentual_pronto, prioridade, cobre_planos)
VALUES
  ('F.pm_planejamento.posts_viram_job', 'pm_planejamento', 'operacional', 'Planejamento de posts que viram job',
   'Planejamento mensal por cliente e campanha; post aprovado vira job com prazo = publicação − antecedência da peça.', 'pronto', 100, 'alta',
   ARRAY['v15_pm_pequena','v15_pm_media','v15_pm_grande']),
  ('F.pm_calendario.calendario_publicacoes', 'pm_calendario', 'operacional', 'Calendário de publicações',
   'Semana e mês com os posts de todos os clientes, redes, situação e job.', 'pronto', 100, 'media',
   ARRAY['v15_pm_pequena','v15_pm_media','v15_pm_grande'])
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.system_screens (id, rota, area, titulo, descricao_funcional, estado_real, auditavel_robo, auditabilidade_em, criado_em, atualizado_em)
SELECT v.id, v.rota, 'pm', v.titulo, v.descr, NULL, true, now(), now(), now()
FROM (VALUES
  ('dashboard.pm.planejamento', '/dashboard/pm/planejamento', 'P&M · Planejamento', 'Planejamentos do mês por cliente e campanha, com os posts e o job de cada post aprovado.'),
  ('dashboard.pm.calendario',   '/dashboard/pm/calendario',   'P&M · Calendário',   'Calendário de publicações dos posts (semana e mês).')
) AS v(id, rota, titulo, descr)
WHERE NOT EXISTS (SELECT 1 FROM public.system_screens s WHERE s.rota = v.rota);
INSERT INTO public.screen_route_features (screen_id, feature_id)
SELECT s.id, v.feature FROM (VALUES ('/dashboard/pm/planejamento', 'F.pm_planejamento.posts_viram_job'),
                                    ('/dashboard/pm/calendario', 'F.pm_calendario.calendario_publicacoes')) v(rota, feature)
  JOIN public.system_screens s ON s.rota = v.rota
ON CONFLICT (screen_id, feature_id) DO NOTHING;
UPDATE public.system_screens SET estado_real = 'pronto', atualizado_em = now()
 WHERE rota IN ('/dashboard/pm/planejamento', '/dashboard/pm/calendario') AND estado_real IS NULL;

-- ── 9) demonstração: planejamento do mês para 2 clientes da demo da P&M ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_demo_seed_pm_social(p_company_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
-- ci-sem-guarda: fn_demo_seed_pm_social — só a empresa de demonstração fixa da P&M (is_demo); sem GRANT a usuário, roda pelo fn_demo_reset (service_role)
DECLARE
  v_demo uuid := 'b0700000-0000-4000-a000-000000000002';
  v_ceo  uuid := '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb';
  v_robo uuid := '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa';
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_mes  date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date;
  v_nome_mes text;
  v_pl uuid[] := ARRAY[]::uuid[]; v_cli uuid; v_plan uuid; v_srv uuid; v_post uuid; v_job uuid; v_resp uuid; v_pub timestamptz;
  r record; s record; v_novos int := 0; v_rearmados int := 0; v_jobs int;
BEGIN
  IF p_company_id IS DISTINCT FROM v_demo
     OR NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id AND is_demo IS TRUE) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_demo_pm');
  END IF;
  v_nome_mes := (ARRAY['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'])[extract(month FROM v_mes)::int];

  FOR r IN SELECT * FROM (VALUES
      (1, 'Café Serra Azul', 'Conteúdo do mês', 'Alimentação', 'aprovado', 'Foco no blend de outono. Evitar foto com preço.'),
      (2, 'Clínica Sorriso Vale', 'Sorriso em dia', 'Saúde', 'em_aprovacao', 'Toda foto de paciente só com autorização assinada.')
    ) c(i, nome, campanha, seg, st, obs) ORDER BY i LOOP
    SELECT id INTO v_cli FROM erp_clientes WHERE company_id = v_demo AND nome_fantasia = r.nome ORDER BY created_at NULLS LAST, id LIMIT 1;
    IF v_cli IS NULL THEN
      INSERT INTO erp_clientes (company_id, nome_fantasia, segmento, origem) VALUES (v_demo, r.nome, r.seg, 'demo_pauta') RETURNING id INTO v_cli;
    END IF;
    SELECT id INTO v_plan FROM agency_planejamentos
     WHERE company_id = v_demo AND cliente_id = v_cli AND mes = v_mes AND lower(COALESCE(campanha, '')) = lower(r.campanha) AND excluido_em IS NULL
     LIMIT 1;
    IF v_plan IS NULL THEN
      INSERT INTO agency_planejamentos (company_id, cliente_id, mes, campanha, titulo)
      VALUES (v_demo, v_cli, v_mes, r.campanha, r.nome || ' · redes sociais de ' || v_nome_mes) RETURNING id INTO v_plan;
    END IF;
    UPDATE agency_planejamentos SET titulo = r.nome || ' · redes sociais de ' || v_nome_mes, status = r.st, observacoes = r.obs,
           responsavel_id = CASE WHEN EXISTS (SELECT 1 FROM users WHERE id = v_ceo) THEN v_ceo END
     WHERE id = v_plan;
    v_pl := v_pl || v_plan;
  END LOOP;

  -- posts: cliente, ordem, dia do mês, hora, assunto, peça, redes, situação, responsável (G = CEO, R = robô), arte,
  -- texto da arte, legenda, hashtags. Aprovados viram job pelo gatilho (prazo = publicação − antecedência da peça).
  FOR s IN SELECT * FROM (VALUES
    (1, 1,  2, '10:00', 'Bom dia com café coado', 'Post feed', ARRAY['instagram','facebook'], 'publicado', 'R',
       'Xícara fumegante na janela, luz da manhã.', 'Bom dia começa aqui', 'Nada como o primeiro gole do dia. ☕', '#cafeespecial #bomdia'),
    (1, 2,  6, '18:00', 'Lançamento do blend de outono', 'Carrossel', ARRAY['instagram','facebook'], 'aprovado', 'G',
       '4 cards: grão, torra, xícara e embalagem nova.', 'Novo blend de outono', 'O outono chegou e trouxe um café novo. Vem provar!', '#outono #cafeespecial #serraazul'),
    (1, 3,  9, '12:00', 'Barista prepara o coado', 'Reels', ARRAY['instagram','tiktok'], 'aprovado', 'R',
       'Vídeo de 30 s do preparo, close nas mãos.', 'Do grão à xícara', 'Você sabe preparar um coado perfeito? Salva esse vídeo!', '#barista #coado'),
    (1, 4, 13, '10:00', 'Horário especial do feriado', 'Stories', ARRAY['instagram'], 'aprovado', 'R',
       'Fundo da marca com o relógio.', 'Feriado: abrimos das 9h às 14h', NULL, NULL),
    (1, 5, 17, '18:00', 'Enquete: sabor da semana', 'Stories', ARRAY['instagram'], 'em_aprovacao', NULL,
       'Duas xícaras lado a lado.', 'Qual vai ser o da semana?', NULL, NULL),
    (1, 6, 22, '18:00', 'Origem do café na fazenda', 'Carrossel', ARRAY['instagram','facebook','linkedin'], 'em_aprovacao', 'G',
       'Fotos da fazenda e do produtor.', 'De onde vem o seu café', 'Conheça quem planta o café que chega na sua xícara.', '#origem #cafeespecial'),
    (1, 7, 27, '10:00', 'Depoimento de cliente', 'Post feed', ARRAY['instagram'], 'rascunho', NULL,
       NULL, NULL, NULL, NULL),
    (2, 1,  3, '09:00', 'Outubro Rosa: prevenção também é sorriso', 'Post feed', ARRAY['instagram','facebook'], 'aprovado', 'G',
       'Laço rosa com a fachada da clínica.', 'Cuide-se por inteiro', 'Outubro Rosa: a prevenção também passa pelo dentista.', '#outubrorosa #saude'),
    (2, 2,  8, '19:00', '5 mitos sobre clareamento', 'Carrossel', ARRAY['instagram','facebook'], 'aprovado', 'R',
       '5 cards com mito × verdade, ícones simples.', 'Mito ou verdade?', 'Clareamento estraga o dente? Arrasta pro lado!', '#clareamento #odontologia'),
    (2, 3, 14, '12:00', 'Tour pela nova unidade', 'Reels', ARRAY['instagram','tiktok','youtube'], 'em_aprovacao', 'R',
       'Vídeo da recepção às salas, 40 s.', 'Nova unidade', 'Vem conhecer a nossa casa nova!', '#novaunidade'),
    (2, 4, 20, '18:00', 'Dentista responde', 'Reels', ARRAY['instagram'], 'em_aprovacao', NULL,
       'Dentista falando para a câmera, legenda na tela.', NULL, 'Mande sua dúvida nos comentários!', '#dentistaresponde'),
    (2, 5, 24, '10:00', 'Agendamento online no Google', 'Post feed', ARRAY['google','facebook'], 'rascunho', NULL,
       NULL, 'Agende pelo Google', NULL, NULL),
    (2, 6, 28, '10:00', 'Antes e depois (com autorização)', 'Stories', ARRAY['instagram'], 'rascunho', NULL,
       NULL, NULL, NULL, NULL)
  ) p(ci, ordem, dia, hora, assunto, peca, redes, st, resp, arte, texto, legenda, tags) LOOP
    SELECT id INTO v_srv FROM agency_servico WHERE company_id = v_demo AND nome = s.peca ORDER BY ordem, id LIMIT 1;
    v_resp := CASE s.resp WHEN 'G' THEN v_ceo WHEN 'R' THEN v_robo END;
    IF v_resp IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = v_resp) THEN v_resp := NULL; END IF;
    v_pub := ((v_mes + (s.dia - 1)) + s.hora::time) AT TIME ZONE 'America/Sao_Paulo';
    SELECT id, job_id INTO v_post, v_job FROM agency_posts WHERE planejamento_id = v_pl[s.ci] AND assunto = s.assunto LIMIT 1;
    IF v_post IS NULL THEN
      INSERT INTO agency_posts (company_id, planejamento_id, cliente_id, assunto, publicar_em, redes, servico_id, arte, texto_arte,
                                legenda, hashtags, responsavel_id, status, ordem)
      SELECT v_demo, v_pl[s.ci], pl.cliente_id, s.assunto, v_pub, s.redes, v_srv, s.arte, s.texto, s.legenda, s.tags, v_resp,
             CASE WHEN v_srv IS NULL THEN 'rascunho' ELSE s.st END, s.ordem
        FROM agency_planejamentos pl WHERE pl.id = v_pl[s.ci];
      v_novos := v_novos + 1;
    ELSE
      -- re-arma: datas relativas ao mês corrente, textos e situação do roteiro (o job, se existe, acompanha a data)
      UPDATE agency_posts SET publicar_em = v_pub, redes = s.redes, servico_id = v_srv, arte = s.arte, texto_arte = s.texto,
             legenda = s.legenda, hashtags = s.tags, responsavel_id = v_resp, ordem = s.ordem, excluido_em = NULL,
             status = CASE WHEN v_srv IS NULL THEN 'rascunho' WHEN s.st IN ('aprovado', 'publicado') AND v_job IS NULL THEN 'rascunho' ELSE s.st END
       WHERE id = v_post;
      IF v_srv IS NOT NULL AND s.st IN ('aprovado', 'publicado') AND v_job IS NULL THEN
        UPDATE agency_posts SET status = s.st WHERE id = v_post;      -- passa por aprovado de novo: o gatilho cria o job
      END IF;
      v_rearmados := v_rearmados + 1;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_jobs FROM agency_posts WHERE planejamento_id = ANY (v_pl) AND job_id IS NOT NULL AND excluido_em IS NULL;
  RETURN jsonb_build_object('ok', true, 'mes', v_mes, 'planejamentos', array_length(v_pl, 1), 'posts_novos', v_novos,
                            'posts_rearmados', v_rearmados, 'posts_com_job', v_jobs, 'hoje', v_hoje);
END $$;
REVOKE ALL ON FUNCTION public.fn_demo_seed_pm_social(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_demo_seed_pm_social(uuid) TO service_role;

-- o reset da demo da P&M re-arma o planejamento do mês (patch por âncora, corpo vigente preservado — RD-69)
DO $do$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef('public.fn_demo_reset(uuid)'::regprocedure) INTO v_def;
  IF v_def !~ 'fn_demo_seed_pm_social' THEN
    v_new := replace(v_def, E'  -- 28/09: a demo nunca fica sem plano',
      E'  -- 03/10 (Social): planejamento do mês de 2 clientes, posts e os jobs dos aprovados\n'
      || E'  IF p_company_id = ''b0700000-0000-4000-a000-000000000002''::uuid THEN\n'
      || E'    v_res := COALESCE(v_res, ''{}''::jsonb) || jsonb_build_object(''social'', public.fn_demo_seed_pm_social(p_company_id));\n'
      || E'  END IF;\n\n'
      || E'  -- 28/09: a demo nunca fica sem plano');
    IF v_new = v_def THEN RAISE EXCEPTION 'fn_demo_reset: ancora 28/09 nao encontrada'; END IF;
    EXECUTE v_new;
  END IF;
END $do$;

-- aplica agora (só se a demo existir neste banco)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM companies WHERE id = 'b0700000-0000-4000-a000-000000000002' AND is_demo IS TRUE) THEN
    RAISE NOTICE 'demo social → %', public.fn_demo_seed_pm_social('b0700000-0000-4000-a000-000000000002');
  END IF;
END $$;
