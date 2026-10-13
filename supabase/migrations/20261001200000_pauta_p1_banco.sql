-- SPEC P&M · Pauta — fase P1 (banco). CEO 01/10: "P1 logo após a #1965"; decisões: aprovação 2 dias úteis, ajustes sem
-- limite quando o contrato não diz (só contar), migração com janela de 60 dias (fora desta PR).
-- RD-26: reusa agency_jobs / agency_clientes / agency_contrato_itens / agency_config_opcao / agency_timesheet.
-- Cria, cada um com company_id, RLS por empresa e nada aberto a quem não está logado:
--   · rodada de ajuste (agency_jobs.rodada_ajuste + agency_job_rodadas) e limite de ajustes no contrato (ajustes_limite);
--   · situação "Aguardando" com motivo (agency_jobs.aguardando_*) e listas configuráveis (situação do job, motivo de espera);
--   · aprovação do cliente com prazo (agency_aprovacoes);
--   · feed de comentários (agency_job_comentarios), anotações privadas (agency_anotacoes);
--   · grupos de clientes, campanhas, visões salvas da pauta, nota (estrela) e lixeira (excluido_em, RD-30);
--   · fn_pauta_contadores: o contador de cada aba numa só chamada (respeita o filtro; roda com a RLS de quem chama).
-- Regras de negócio que GRAVAM rodada/aprovação ficam na P3 (funções com guarda). Nada aqui altera job existente além dos
-- campos novos com valor padrão.

-- ── 1) agency_jobs: campos novos ────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.agency_jobs
  ADD COLUMN IF NOT EXISTS rodada_ajuste     integer NOT NULL DEFAULT 0 CHECK (rodada_ajuste >= 0),
  ADD COLUMN IF NOT EXISTS aguardando_motivo text,
  ADD COLUMN IF NOT EXISTS aguardando_de     text CHECK (aguardando_de IN ('cliente', 'planejamento', 'fornecedor', 'interno')),
  ADD COLUMN IF NOT EXISTS aguardando_desde  timestamptz,
  ADD COLUMN IF NOT EXISTS nota              smallint CHECK (nota BETWEEN 0 AND 5),
  ADD COLUMN IF NOT EXISTS excluido_em       timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_por      uuid;
CREATE INDEX IF NOT EXISTS agency_jobs_pauta_idx ON public.agency_jobs (company_id, status, data_prazo) WHERE excluido_em IS NULL;

-- limite de ajustes por peça no contrato (vazio = sem limite, só contar · decisão CEO 01/10)
ALTER TABLE public.agency_contrato_itens
  ADD COLUMN IF NOT EXISTS ajustes_limite integer CHECK (ajustes_limite >= 0);

-- ── 2) grupos de clientes e campanhas ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agency_grupos_clientes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nome       text NOT NULL CHECK (length(btrim(nome)) > 0),
  criado_em  timestamptz NOT NULL DEFAULT now(),
  excluido_em timestamptz
);
ALTER TABLE public.agency_clientes ADD COLUMN IF NOT EXISTS grupo_id uuid REFERENCES public.agency_grupos_clientes(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.agency_campanhas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cliente_id uuid REFERENCES public.agency_clientes(id) ON DELETE SET NULL,
  nome       text NOT NULL CHECK (length(btrim(nome)) > 0),
  inicio     date,
  fim        date,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  excluido_em timestamptz,
  CHECK (fim IS NULL OR inicio IS NULL OR fim >= inicio)
);
ALTER TABLE public.agency_jobs ADD COLUMN IF NOT EXISTS campanha_id uuid REFERENCES public.agency_campanhas(id) ON DELETE SET NULL;

-- ── 3) rodadas de ajuste e aprovações (gravação pelas funções da P3) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agency_job_rodadas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id     uuid NOT NULL REFERENCES public.agency_jobs(id) ON DELETE CASCADE,
  rodada     integer NOT NULL CHECK (rodada >= 1),
  motivo     text,
  pedido_por text NOT NULL DEFAULT 'cliente' CHECK (pedido_por IN ('cliente', 'interno')),
  criado_por uuid,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, rodada)
);

CREATE TABLE IF NOT EXISTS public.agency_aprovacoes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id             uuid NOT NULL REFERENCES public.agency_jobs(id) ON DELETE CASCADE,
  rodada             integer NOT NULL DEFAULT 0,
  enviado_em         timestamptz NOT NULL DEFAULT now(),
  prazo_em           timestamptz NOT NULL,
  lembretes_enviados integer NOT NULL DEFAULT 0,
  decisao            text CHECK (decisao IN ('aprovado', 'ajustar', 'vencido')),
  decidido_em        timestamptz,
  decidido_por       uuid,
  criado_por         uuid
);
CREATE INDEX IF NOT EXISTS agency_aprovacoes_abertas_idx ON public.agency_aprovacoes (company_id, prazo_em) WHERE decisao IS NULL;
-- prazo padrão da aprovação por cliente (vazio = 2 dias úteis · decisão CEO 01/10)
ALTER TABLE public.agency_clientes ADD COLUMN IF NOT EXISTS aprovacao_prazo_dias_uteis integer CHECK (aprovacao_prazo_dias_uteis BETWEEN 1 AND 30);

-- ── 4) comentários (feed), anotações privadas, visões salvas ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agency_job_comentarios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_id      uuid NOT NULL REFERENCES public.agency_jobs(id) ON DELETE CASCADE,
  autor_id    uuid,
  texto       text NOT NULL CHECK (length(btrim(texto)) > 0),
  mencoes     uuid[] NOT NULL DEFAULT '{}',
  anexos      jsonb NOT NULL DEFAULT '[]'::jsonb,
  origem      text NOT NULL DEFAULT 'feed' CHECK (origem IN ('feed', 'migrado_campo_antigo')),
  criado_em   timestamptz NOT NULL DEFAULT now(),
  excluido_em timestamptz
);
CREATE INDEX IF NOT EXISTS agency_job_comentarios_job_idx ON public.agency_job_comentarios (job_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS agency_job_comentarios_mencoes_idx ON public.agency_job_comentarios USING gin (mencoes);

CREATE TABLE IF NOT EXISTS public.agency_anotacoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL DEFAULT auth.uid(),
  job_id        uuid REFERENCES public.agency_jobs(id) ON DELETE SET NULL,
  texto         text NOT NULL,
  fixada        boolean NOT NULL DEFAULT false,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  excluido_em   timestamptz
);
CREATE INDEX IF NOT EXISTS agency_anotacoes_user_idx ON public.agency_anotacoes (user_id, company_id);

CREATE TABLE IF NOT EXISTS public.agency_visoes_pauta (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  dono_id      uuid NOT NULL DEFAULT auth.uid(),
  compartilhada boolean NOT NULL DEFAULT false,
  nome         text NOT NULL CHECK (length(btrim(nome)) > 0),
  filtros      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ordem        integer NOT NULL DEFAULT 0,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  excluido_em  timestamptz
);
CREATE INDEX IF NOT EXISTS agency_visoes_pauta_idx ON public.agency_visoes_pauta (company_id, dono_id);

-- ── 5) RLS: tudo por empresa; anotação só do autor; visão compartilhada só gestor (fn_acessos_pode_gerir) ───────
ALTER TABLE public.agency_grupos_clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_campanhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_job_rodadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_aprovacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_job_comentarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_anotacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_visoes_pauta ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.agency_grupos_clientes, public.agency_campanhas, public.agency_job_rodadas, public.agency_aprovacoes,
              public.agency_job_comentarios, public.agency_anotacoes, public.agency_visoes_pauta FROM PUBLIC, anon;

-- grupos e campanhas: cadastro da empresa (exclusão lógica: sem DELETE)
DROP POLICY IF EXISTS agency_grupos_clientes_empresa ON public.agency_grupos_clientes;
CREATE POLICY agency_grupos_clientes_empresa ON public.agency_grupos_clientes FOR ALL TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
DROP POLICY IF EXISTS agency_campanhas_empresa ON public.agency_campanhas;
CREATE POLICY agency_campanhas_empresa ON public.agency_campanhas FOR ALL TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()))
  WITH CHECK (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT, INSERT, UPDATE ON public.agency_grupos_clientes, public.agency_campanhas TO authenticated;

-- rodadas e aprovações: leitura pela empresa; gravação só pelas funções (P3)
DROP POLICY IF EXISTS agency_job_rodadas_ler ON public.agency_job_rodadas;
CREATE POLICY agency_job_rodadas_ler ON public.agency_job_rodadas FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
DROP POLICY IF EXISTS agency_aprovacoes_ler ON public.agency_aprovacoes;
CREATE POLICY agency_aprovacoes_ler ON public.agency_aprovacoes FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT ON public.agency_job_rodadas, public.agency_aprovacoes TO authenticated;

-- comentários: a empresa lê; cada um escreve em seu nome e só mexe (excluir) no que é seu
DROP POLICY IF EXISTS agency_job_comentarios_ler ON public.agency_job_comentarios;
CREATE POLICY agency_job_comentarios_ler ON public.agency_job_comentarios FOR SELECT TO authenticated
  USING (public.is_admin() OR company_id IN (SELECT public.get_user_company_ids()));
DROP POLICY IF EXISTS agency_job_comentarios_criar ON public.agency_job_comentarios;
CREATE POLICY agency_job_comentarios_criar ON public.agency_job_comentarios FOR INSERT TO authenticated
  WITH CHECK (autor_id = auth.uid() AND company_id IN (SELECT public.get_user_company_ids())
              AND EXISTS (SELECT 1 FROM public.agency_jobs j WHERE j.id = job_id AND j.company_id = agency_job_comentarios.company_id));
DROP POLICY IF EXISTS agency_job_comentarios_proprio ON public.agency_job_comentarios;
CREATE POLICY agency_job_comentarios_proprio ON public.agency_job_comentarios FOR UPDATE TO authenticated
  USING (autor_id = auth.uid()) WITH CHECK (autor_id = auth.uid());
GRANT SELECT, INSERT ON public.agency_job_comentarios TO authenticated;
GRANT UPDATE (texto, excluido_em) ON public.agency_job_comentarios TO authenticated;

-- anotações: privadas do autor (nem o gestor vê)
DROP POLICY IF EXISTS agency_anotacoes_autor ON public.agency_anotacoes;
CREATE POLICY agency_anotacoes_autor ON public.agency_anotacoes FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND company_id IN (SELECT public.get_user_company_ids()));
GRANT SELECT, INSERT, UPDATE ON public.agency_anotacoes TO authenticated;

-- visões: a pessoa vê as suas e as compartilhadas da empresa; compartilhada só gestor cria/altera
DROP POLICY IF EXISTS agency_visoes_pauta_ler ON public.agency_visoes_pauta;
CREATE POLICY agency_visoes_pauta_ler ON public.agency_visoes_pauta FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) AND (dono_id = auth.uid() OR compartilhada));
DROP POLICY IF EXISTS agency_visoes_pauta_criar ON public.agency_visoes_pauta;
CREATE POLICY agency_visoes_pauta_criar ON public.agency_visoes_pauta FOR INSERT TO authenticated
  WITH CHECK (dono_id = auth.uid() AND company_id IN (SELECT public.get_user_company_ids())
              AND (NOT compartilhada OR public.fn_acessos_pode_gerir(company_id)));
DROP POLICY IF EXISTS agency_visoes_pauta_alterar ON public.agency_visoes_pauta;
CREATE POLICY agency_visoes_pauta_alterar ON public.agency_visoes_pauta FOR UPDATE TO authenticated
  USING (dono_id = auth.uid())
  WITH CHECK (dono_id = auth.uid() AND (NOT compartilhada OR public.fn_acessos_pode_gerir(company_id)));
GRANT SELECT, INSERT, UPDATE ON public.agency_visoes_pauta TO authenticated;

-- ── 6) listas configuráveis: situação do job (com "Aguardando") e motivo de espera ─────────────────────────────
-- As 5 situações estavam fixas no código; passam a vir de agency_config_opcao (cada agência pode renomear).
-- Semente na primeira leitura de cada empresa (não grava nada para empresa que não usa a Pauta).
CREATE OR REPLACE FUNCTION public.fn_pauta_opcoes(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn__guarda_empresa(p_company_id);
  IF NOT EXISTS (SELECT 1 FROM public.agency_config_opcao WHERE company_id = p_company_id AND lista = 'situacao_job') THEN
    INSERT INTO public.agency_config_opcao (company_id, lista, valor, rotulo, ordem, ativo) VALUES
      (p_company_id, 'situacao_job', 'nao_iniciada', 'Não iniciada', 1, true),
      (p_company_id, 'situacao_job', 'em_producao',  'Em produção',  2, true),
      (p_company_id, 'situacao_job', 'aguardando',   'Aguardando',   3, true),
      (p_company_id, 'situacao_job', 'em_aprovacao', 'Em aprovação', 4, true),
      (p_company_id, 'situacao_job', 'concluida',    'Concluída',    5, true),
      (p_company_id, 'situacao_job', 'publicado',    'Publicada',    6, true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agency_config_opcao WHERE company_id = p_company_id AND lista = 'motivo_aguardando') THEN
    INSERT INTO public.agency_config_opcao (company_id, lista, valor, rotulo, ordem, ativo) VALUES
      (p_company_id, 'motivo_aguardando', 'retorno_cliente',      'Retorno do cliente',      1, true),
      (p_company_id, 'motivo_aguardando', 'material_cliente',     'Material do cliente',     2, true),
      (p_company_id, 'motivo_aguardando', 'retorno_planejamento', 'Retorno do planejamento', 3, true),
      (p_company_id, 'motivo_aguardando', 'fornecedor',           'Fornecedor',              4, true),
      (p_company_id, 'motivo_aguardando', 'aprovacao_interna',    'Aprovação interna',       5, true);
  END IF;
  RETURN jsonb_build_object(
    'situacoes', (SELECT jsonb_agg(jsonb_build_object('valor', valor, 'rotulo', rotulo, 'ordem', ordem) ORDER BY ordem)
                    FROM public.agency_config_opcao WHERE company_id = p_company_id AND lista = 'situacao_job' AND ativo),
    'motivos',   (SELECT jsonb_agg(jsonb_build_object('valor', valor, 'rotulo', rotulo, 'ordem', ordem) ORDER BY ordem)
                    FROM public.agency_config_opcao WHERE company_id = p_company_id AND lista = 'motivo_aguardando' AND ativo));
END $function$;
REVOKE ALL ON FUNCTION public.fn_pauta_opcoes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pauta_opcoes(uuid) TO authenticated, service_role;

-- ── 7) contadores das abas: uma chamada, respeita o filtro e a RLS de quem chama (SECURITY INVOKER) ─────────────
-- p_filtros (todos opcionais): clientes[], responsaveis[], grupos[], campanhas[], fees[], servicos[], titulo, codigo,
-- situacao_cliente[], aguardando (bool), aguardando_de[], data_tipo (prazo|criacao|entrega) + data_de/data_ate,
-- atalho (meus | atrasados | hoje | esperando_cliente).
CREATE OR REPLACE FUNCTION public.fn_pauta_contadores(p_company_id uuid, p_filtros jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  WITH f AS (SELECT COALESCE(p_filtros, '{}'::jsonb) f, (now() AT TIME ZONE 'America/Sao_Paulo')::date hoje),
  base AS (
    SELECT j.status, j.data_prazo
      FROM public.agency_jobs j
      LEFT JOIN public.agency_clientes c ON c.id = j.cliente_id
      CROSS JOIN f
     WHERE j.company_id = p_company_id AND j.excluido_em IS NULL
       AND (NOT (f.f ? 'clientes')     OR j.cliente_id::text     IN (SELECT jsonb_array_elements_text(f.f->'clientes')))
       AND (NOT (f.f ? 'responsaveis') OR j.responsavel_id::text IN (SELECT jsonb_array_elements_text(f.f->'responsaveis')))
       AND (NOT (f.f ? 'grupos')       OR c.grupo_id::text       IN (SELECT jsonb_array_elements_text(f.f->'grupos')))
       AND (NOT (f.f ? 'campanhas')    OR j.campanha_id::text    IN (SELECT jsonb_array_elements_text(f.f->'campanhas')))
       AND (NOT (f.f ? 'fees')         OR j.fee_id::text         IN (SELECT jsonb_array_elements_text(f.f->'fees')))
       AND (NOT (f.f ? 'servicos')     OR j.servico_id::text     IN (SELECT jsonb_array_elements_text(f.f->'servicos')))
       AND (NOT (f.f ? 'situacao_cliente') OR c.status           IN (SELECT jsonb_array_elements_text(f.f->'situacao_cliente')))
       AND (NOT (f.f ? 'titulo') OR j.titulo ILIKE '%' || (f.f->>'titulo') || '%')
       -- código aceita com ou sem a letra da rodada (113223A → 113223)
       AND (NOT (f.f ? 'codigo') OR j.numero::text ILIKE '%' || regexp_replace(f.f->>'codigo', '[A-Za-z]+$', '') || '%')
       AND (NOT (f.f ? 'aguardando') OR ((f.f->>'aguardando')::boolean = (j.status = 'aguardando')))
       AND (NOT (f.f ? 'aguardando_de') OR j.aguardando_de IN (SELECT jsonb_array_elements_text(f.f->'aguardando_de')))
       AND (NOT (f.f ? 'data_de')  OR (CASE f.f->>'data_tipo' WHEN 'criacao' THEN j.created_at::date WHEN 'entrega' THEN j.data_entrega::date ELSE j.data_prazo::date END) >= (f.f->>'data_de')::date)
       AND (NOT (f.f ? 'data_ate') OR (CASE f.f->>'data_tipo' WHEN 'criacao' THEN j.created_at::date WHEN 'entrega' THEN j.data_entrega::date ELSE j.data_prazo::date END) <= (f.f->>'data_ate')::date)
       AND (CASE f.f->>'atalho'
              WHEN 'meus' THEN j.responsavel_id = auth.uid()
              WHEN 'atrasados' THEN j.data_prazo::date < f.hoje AND j.status NOT IN ('concluida', 'publicado')
              WHEN 'hoje' THEN j.data_prazo::date = f.hoje
              WHEN 'esperando_cliente' THEN j.status = 'aguardando' AND j.aguardando_de = 'cliente'
              ELSE true END)
  )
  SELECT jsonb_build_object(
    'por_situacao', COALESCE((SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM base GROUP BY status) s), '{}'::jsonb),
    'total', (SELECT count(*) FROM base),
    'atrasados', (SELECT count(*) FROM base, f WHERE base.data_prazo::date < f.hoje AND base.status NOT IN ('concluida', 'publicado')))
$function$;
REVOKE ALL ON FUNCTION public.fn_pauta_contadores(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_pauta_contadores(uuid, jsonb) TO authenticated, service_role;

-- ── 8) comentários antigos (campo agency_jobs.comentarios) copiados para o feed uma vez, sem apagar o campo ────
INSERT INTO public.agency_job_comentarios (company_id, job_id, texto, criado_em, origem)
SELECT j.company_id, j.id,
       COALESCE(NULLIF(btrim(e->>'texto'), ''), NULLIF(btrim(e->>'text'), ''), NULLIF(btrim(e #>> '{}'), '')),
       j.created_at, 'migrado_campo_antigo'
  FROM public.agency_jobs j
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(j.comentarios) = 'array' THEN j.comentarios ELSE '[]'::jsonb END) e
 WHERE COALESCE(NULLIF(btrim(e->>'texto'), ''), NULLIF(btrim(e->>'text'), ''), NULLIF(btrim(e #>> '{}'), '')) IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.agency_job_comentarios k WHERE k.job_id = j.id AND k.origem = 'migrado_campo_antigo');
