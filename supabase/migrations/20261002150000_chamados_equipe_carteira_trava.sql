-- Chamados em equipe · T1 + T2 (SPEC "Chamados em equipe" rev. 9, seções 1 e 2 — lista do banco APROVADA pelo CEO 02/10).
--
-- T1 · Carteira: cada empresa cliente tem um responsável (com vigência e histórico, só o CEO edita). Chamado aberto cai
--      em "Meus chamados" do responsável e no sino dele; empresa sem responsável → fila "Sem dono" + alerta ao CEO;
--      empresa da PS → "interno" (backlog de desenvolvimento). A carteira define para onde o chamado CAI, não quem
--      pode atendê-lo: toda a equipe PS vê todos os chamados.
-- T2 · Trava de atendimento: um atendente por vez. Assumir (livre), Direcionar (atendente atual / responsável / CEO,
--      com motivo), Puxar (qualquer um da equipe, com motivo; confirmação extra se o atendente mexeu há < 2 h; o CEO
--      não precisa), Liberar; a trava expira em 24 h sem movimento (aviso 4 h antes) e volta para o responsável.
--      Quem perdeu a trava perde NA HORA o direito de gravar: um gatilho em sugestoes (e em sugestao_mensagem, para a
--      conversa) recusa qualquer ação da equipe PS em chamado que está com outra pessoa — vale para TODAS as funções
--      que já existem (responder, aprovar, status, encerrar, reenviar, desmembrar, mensagem) e para update direto.
--      Toda troca fica em sugestao_atendimento_hist (só inserção).
--
-- Equipe: tabela própria (erp_chamado_equipe), NÃO a ps_equipe_acesso — aquela dá acesso a TODAS as empresas
-- clientes (user_companies); pôr a Stephany lá abriria os dados de todos os clientes, além do que o CEO decidiu
-- ("ver, assumir, puxar" chamados, sem carteira). O robô (usuário de screenshot) não é da equipe: só atua em
-- chamado de empresa de demonstração (RD-69), para os testes de aceitação.
--
-- Implantação (decisão do CEO 02/10): chamados ABERTOS com o CEO ou com o robô vão para a fila do responsável da
-- carteira, LIVRES, com registro "implantacao" no histórico; Frioeste e Mariele (carteira do CEO) e os internos da
-- PS ficam com o CEO. Nada é apagado (RD-30); a prévia com contagem foi enviada ao CEO antes do merge.

-- ───────────────────────── 1. Equipe de atendimento ─────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_chamado_equipe (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_curto text NOT NULL,
  papel      text NOT NULL CHECK (papel IN ('ceo', 'socio', 'suporte')),
  agente     text,                                   -- identificação do Claude/Code da pessoa ("code-jordana")
  ativo      boolean NOT NULL DEFAULT true,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  criado_por uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_chamado_equipe_um_ceo ON public.erp_chamado_equipe ((papel)) WHERE papel = 'ceo' AND ativo;
ALTER TABLE public.erp_chamado_equipe ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chamado_equipe_select ON public.erp_chamado_equipe;
CREATE POLICY chamado_equipe_select ON public.erp_chamado_equipe FOR SELECT TO authenticated
  USING (public.fn_pode_ver_fila_suporte() OR user_id = auth.uid());
REVOKE ALL ON public.erp_chamado_equipe FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.erp_chamado_equipe FROM authenticated;
GRANT SELECT ON public.erp_chamado_equipe TO authenticated;

INSERT INTO public.erp_chamado_equipe (user_id, nome_curto, papel, agente) VALUES
  ('4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb', 'Gilberto', 'ceo',     'code-gilberto'),
  ('43ef8386-3262-4e56-b31a-6f0e41d1e21c', 'Jordana',  'socio',   'code-jordana'),
  ('33464170-036f-4d3b-bc48-f2dc3dfde660', 'Rodrigo',  'socio',   'code-rodrigo'),
  ('f3867e65-94d6-43c0-aeb9-8da82fcfe433', 'André',    'socio',   'code-andre'),
  ('ef06f426-c001-41dc-bd56-adac0cc08085', 'Stephany', 'suporte', 'code-stephany')
ON CONFLICT (user_id) DO NOTHING;

-- ───────────────────────── 2. Carteira (responsável por empresa, com vigência) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.erp_carteira_responsavel (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id),
  responsavel_id  uuid REFERENCES auth.users(id),
  interno         boolean NOT NULL DEFAULT false,      -- empresa da PS: chamado é backlog de desenvolvimento
  vigencia_inicio timestamptz NOT NULL DEFAULT now(),
  vigencia_fim    timestamptz,
  motivo          text,
  criado_por      uuid,
  criado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_carteira_vigente ON public.erp_carteira_responsavel (company_id) WHERE vigencia_fim IS NULL;
ALTER TABLE public.erp_carteira_responsavel ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS carteira_select ON public.erp_carteira_responsavel;
CREATE POLICY carteira_select ON public.erp_carteira_responsavel FOR SELECT TO authenticated USING (public.fn_pode_ver_fila_suporte());
REVOKE ALL ON public.erp_carteira_responsavel FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.erp_carteira_responsavel FROM authenticated;
GRANT SELECT ON public.erp_carteira_responsavel TO authenticated;

-- ───────────────────────── 3. Histórico de atendimento (só inserção) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.sugestao_atendimento_hist (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sugestao_id       uuid NOT NULL REFERENCES public.sugestoes(id),
  acao              text NOT NULL CHECK (acao IN ('assumir', 'direcionar', 'puxar', 'liberar', 'expirar', 'implantacao', 'carteira')),
  de_user           uuid,
  para_user         uuid,
  motivo            text,
  agente            text,
  confirmacao_extra boolean NOT NULL DEFAULT false,   -- puxou um chamado mexido há menos de 2 h (confirmou)
  automatico        boolean NOT NULL DEFAULT false,   -- assumiu sozinho na primeira ação / expirou pelo robô
  criado_por        uuid,
  criado_em         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_sug_atend_hist_sugestao ON public.sugestao_atendimento_hist (sugestao_id, criado_em);
ALTER TABLE public.sugestao_atendimento_hist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sug_atend_hist_select ON public.sugestao_atendimento_hist;
CREATE POLICY sug_atend_hist_select ON public.sugestao_atendimento_hist FOR SELECT TO authenticated USING (public.fn_pode_ver_fila_suporte());
REVOKE ALL ON public.sugestao_atendimento_hist FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.sugestao_atendimento_hist FROM authenticated;
GRANT SELECT ON public.sugestao_atendimento_hist TO authenticated;

CREATE OR REPLACE FUNCTION public.fn__sug_atend_hist_imutavel()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'O histórico de atendimento só recebe inserções (RD-30)' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_sug_atend_hist_imutavel ON public.sugestao_atendimento_hist;
CREATE TRIGGER trg_sug_atend_hist_imutavel BEFORE UPDATE OR DELETE ON public.sugestao_atendimento_hist
  FOR EACH ROW EXECUTE FUNCTION public.fn__sug_atend_hist_imutavel();

-- ───────────────────────── 4. Campos de atendimento no chamado ─────────────────────────
ALTER TABLE public.sugestoes
  ADD COLUMN IF NOT EXISTS responsavel_id       uuid,
  ADD COLUMN IF NOT EXISTS interno              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agente               text,
  ADD COLUMN IF NOT EXISTS em_atendimento_desde timestamptz,
  ADD COLUMN IF NOT EXISTS ultimo_movimento     timestamptz,
  ADD COLUMN IF NOT EXISTS ramo                 text,
  ADD COLUMN IF NOT EXISTS trava_aviso_em       timestamptz;
CREATE INDEX IF NOT EXISTS ix_sugestoes_responsavel ON public.sugestoes (responsavel_id);
CREATE INDEX IF NOT EXISTS ix_sugestoes_atendente ON public.sugestoes (atendente_id);

-- ───────────────────────── 5. Ajudantes ─────────────────────────
-- Status em que o chamado ainda está "aberto" para a trava (concluída, recusada, duplicada e arquivada ficam fora).
CREATE OR REPLACE FUNCTION public.fn__chamado_aberto(p_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(p_status, 'nova') IN ('nova', 'em_analise', 'aceita', 'em_desenvolvimento', 'aguardando_confirmacao')
$$;

CREATE OR REPLACE FUNCTION public.fn__chamado_ceo_pode()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM erp_chamado_equipe WHERE user_id = auth.uid() AND papel = 'ceo' AND ativo)
$$;

-- Pode atuar no chamado: quem é da equipe de atendimento; o robô (PS sem estar na equipe) só em empresa DEMO.
CREATE OR REPLACE FUNCTION public.fn__chamado_pode_atuar(p_sugestao_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM erp_chamado_equipe WHERE user_id = auth.uid() AND ativo)
      OR (public.fn_pode_ver_fila_suporte() AND EXISTS (
            SELECT 1 FROM sugestoes s JOIN companies c ON c.id = s.company_id WHERE s.id = p_sugestao_id AND c.is_demo))
$$;

CREATE OR REPLACE FUNCTION public.fn__chamado_nome(p_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN p_user IS NULL THEN NULL ELSE coalesce((SELECT nome_curto FROM erp_chamado_equipe WHERE user_id = p_user),
                  (SELECT nullif(split_part(coalesce(u.full_name, u.email, ''), ' ', 1), '') FROM users u WHERE u.id = p_user),
                  'alguém') END
$$;

-- ci-sem-guarda: fn__chamado_avisar — interna (sem GRANT a authenticated); só é chamada por funções que já conferiram fn__chamado_pode_atuar / fn__chamado_ceo_pode ou pelo cron
-- ci-sem-guarda: fn__chamado_trocar — interna (sem GRANT a authenticated); só é chamada por funções que já conferiram fn__chamado_pode_atuar / fn__chamado_ceo_pode ou pelo cron
-- Aviso no sino de uma pessoa da equipe. Chamado de empresa DEMO não avisa ninguém (robô de teste, RD-69).
CREATE OR REPLACE FUNCTION public.fn__chamado_avisar(p_sugestao_id uuid, p_dest uuid, p_titulo text, p_msg text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_dest IS NULL OR p_dest IS NOT DISTINCT FROM auth.uid() THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM sugestoes s JOIN companies c ON c.id = s.company_id WHERE s.id = p_sugestao_id AND c.is_demo) THEN RETURN; END IF;
  INSERT INTO sugestao_notificacao (sugestao_id, destinatario_id, tipo, titulo, mensagem)
  VALUES (p_sugestao_id, p_dest, 'atendimento', left(p_titulo, 200), p_msg);
END $$;

-- Troca de atendente (o único caminho que muda a trava): grava o chamado + o histórico na mesma transação.
-- O gatilho de trava deixa passar SÓ enquanto esta função grava (marca local da transação, desligada logo depois).
CREATE OR REPLACE FUNCTION public.fn__chamado_trocar(p_id uuid, p_para uuid, p_acao text, p_motivo text,
                                                    p_agente text, p_confirmacao boolean, p_auto boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_de uuid;
BEGIN
  SELECT atendente_id INTO v_de FROM sugestoes WHERE id = p_id;
  PERFORM set_config('app.chamado_troca', '1', true);
  UPDATE sugestoes SET
    atendente_id         = p_para,
    em_atendimento_desde = CASE WHEN p_para IS NULL THEN NULL ELSE now() END,
    ultimo_movimento     = now(),
    agente               = CASE WHEN p_para IS NULL THEN NULL ELSE coalesce(p_agente, (SELECT agente FROM erp_chamado_equipe WHERE user_id = p_para)) END,
    trava_aviso_em       = NULL,
    status               = CASE WHEN p_para IS NOT NULL AND status = 'nova' THEN 'em_analise' ELSE status END,
    updated_at           = now()
  WHERE id = p_id;
  PERFORM set_config('app.chamado_troca', '', true);
  INSERT INTO sugestao_atendimento_hist (sugestao_id, acao, de_user, para_user, motivo, agente, confirmacao_extra, automatico, criado_por)
  VALUES (p_id, p_acao, v_de, p_para, p_motivo, p_agente, coalesce(p_confirmacao, false), coalesce(p_auto, false), auth.uid());
END $$;

-- ───────────────────────── 6. Gatilhos: carteira na abertura e trava em toda ação ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn__sugestao_carteira_ao_abrir()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c record;
BEGIN
  IF NEW.company_id IS NOT NULL THEN
    SELECT responsavel_id, interno INTO v_c FROM erp_carteira_responsavel WHERE company_id = NEW.company_id AND vigencia_fim IS NULL;
    IF FOUND THEN
      NEW.responsavel_id := coalesce(NEW.responsavel_id, v_c.responsavel_id);
      NEW.interno := NEW.interno OR v_c.interno;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sugestao_carteira_ao_abrir ON public.sugestoes;
CREATE TRIGGER trg_sugestao_carteira_ao_abrir BEFORE INSERT ON public.sugestoes
  FOR EACH ROW EXECUTE FUNCTION public.fn__sugestao_carteira_ao_abrir();

CREATE OR REPLACE FUNCTION public.fn__sugestao_avisar_ao_abrir()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_demo boolean; v_ceo uuid; v_emp text;
BEGIN
  SELECT c.is_demo, coalesce(c.nome_fantasia, c.razao_social) INTO v_demo, v_emp FROM companies c WHERE c.id = NEW.company_id;
  IF coalesce(v_demo, false) THEN RETURN NEW; END IF;
  IF NEW.responsavel_id IS NOT NULL THEN
    PERFORM fn__chamado_avisar(NEW.id, NEW.responsavel_id,
      '#' || NEW.numero || ' · Novo chamado em Meus chamados: ' || coalesce(nullif(btrim(NEW.titulo), ''), left(NEW.descricao, 60)),
      coalesce(v_emp, 'sem empresa') || ' abriu um chamado. Ele está em "Meus chamados" na Fila de atendimento.');
  ELSIF NEW.company_id IS NOT NULL THEN
    SELECT user_id INTO v_ceo FROM erp_chamado_equipe WHERE papel = 'ceo' AND ativo;
    PERFORM fn__chamado_avisar(NEW.id, v_ceo,
      '#' || NEW.numero || ' · Chamado SEM DONO: ' || coalesce(v_emp, 'empresa sem responsável'),
      'A empresa não tem responsável na carteira. O chamado está na fila "Sem dono" — defina o responsável em Administração › Carteira.');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sugestao_avisar_ao_abrir ON public.sugestoes;
CREATE TRIGGER trg_sugestao_avisar_ao_abrir AFTER INSERT ON public.sugestoes
  FOR EACH ROW EXECUTE FUNCTION public.fn__sugestao_avisar_ao_abrir();

-- Trava: ação da equipe PS (quem não é o autor) que muda o chamado.
--   livre        → quem age assume sozinho (histórico "assumir", automático) — nunca há ação sem atendente;
--   é o atendente → segue, e marca o último movimento;
--   CEO          → segue sempre (decisão do CEO);
--   outra pessoa → RECUSA (42501): "Em atendimento por X desde HH:MM — use Puxar".
-- Sem usuário (robôs do banco, cron, service_role) e o próprio autor passam. Só conta mudança de campo de trabalho.
CREATE OR REPLACE FUNCTION public.fn__sugestao_trava_guarda()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF coalesce(current_setting('app.chamado_troca', true), '') = '1' THEN RETURN NEW; END IF;
  IF v_uid IS NULL OR v_uid = OLD.user_id THEN RETURN NEW; END IF;
  IF NOT public.fn_pode_ver_fila_suporte() THEN RETURN NEW; END IF;
  IF NOT (NEW.resposta IS DISTINCT FROM OLD.resposta OR NEW.resposta_aprovada IS DISTINCT FROM OLD.resposta_aprovada
       OR NEW.status IS DISTINCT FROM OLD.status OR NEW.pr_numero IS DISTINCT FROM OLD.pr_numero
       OR NEW.prioridade IS DISTINCT FROM OLD.prioridade OR NEW.categoria IS DISTINCT FROM OLD.categoria
       OR NEW.titulo IS DISTINCT FROM OLD.titulo OR NEW.descricao IS DISTINCT FROM OLD.descricao
       OR NEW.atendente_id IS DISTINCT FROM OLD.atendente_id OR NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id
       OR NEW.encerrado_sem_confirmacao IS DISTINCT FROM OLD.encerrado_sem_confirmacao
       OR NEW.ultimo_movimento IS DISTINCT FROM OLD.ultimo_movimento) THEN
    RETURN NEW;
  END IF;
  -- responsável só muda pela carteira (fn_carteira_definir)
  NEW.responsavel_id := OLD.responsavel_id;
  IF public.fn__chamado_ceo_pode() THEN
    IF OLD.atendente_id IS NULL THEN
      NEW.atendente_id := v_uid; NEW.em_atendimento_desde := now();
      NEW.agente := (SELECT agente FROM erp_chamado_equipe WHERE user_id = v_uid);
      INSERT INTO sugestao_atendimento_hist (sugestao_id, acao, de_user, para_user, motivo, automatico, criado_por)
      VALUES (OLD.id, 'assumir', NULL, v_uid, 'primeira ação no chamado', true, v_uid);
    ELSE
      NEW.atendente_id := OLD.atendente_id; NEW.em_atendimento_desde := OLD.em_atendimento_desde; NEW.agente := OLD.agente;
    END IF;
    NEW.ultimo_movimento := now();
    RETURN NEW;
  END IF;
  IF OLD.atendente_id IS NULL THEN
    IF NOT public.fn__chamado_pode_atuar(OLD.id) THEN
      RAISE EXCEPTION 'Só a equipe de atendimento mexe em chamado de cliente' USING ERRCODE = '42501';
    END IF;
    NEW.atendente_id := v_uid; NEW.em_atendimento_desde := now(); NEW.ultimo_movimento := now(); NEW.trava_aviso_em := NULL;
    NEW.agente := (SELECT agente FROM erp_chamado_equipe WHERE user_id = v_uid);
    INSERT INTO sugestao_atendimento_hist (sugestao_id, acao, de_user, para_user, motivo, automatico, criado_por)
    VALUES (OLD.id, 'assumir', NULL, v_uid, 'primeira ação no chamado', true, v_uid);
    RETURN NEW;
  END IF;
  IF OLD.atendente_id = v_uid THEN
    NEW.atendente_id := v_uid; NEW.em_atendimento_desde := OLD.em_atendimento_desde; NEW.agente := OLD.agente;
    NEW.ultimo_movimento := now(); NEW.trava_aviso_em := NULL;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Chamado #% em atendimento por % desde %. Para mexer nele, use "Puxar" (com motivo).',
    OLD.numero, public.fn__chamado_nome(OLD.atendente_id),
    to_char(coalesce(OLD.em_atendimento_desde, OLD.updated_at) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI')
    USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_sugestao_trava_guarda ON public.sugestoes;
CREATE TRIGGER trg_sugestao_trava_guarda BEFORE UPDATE ON public.sugestoes
  FOR EACH ROW EXECUTE FUNCTION public.fn__sugestao_trava_guarda();

-- Conversa: mensagem da equipe PS também é "mexer no chamado" — passa pela mesma trava (marca o último movimento,
-- o gatilho acima decide: assume se livre, segue se é o atendente, recusa se é de outra pessoa).
CREATE OR REPLACE FUNCTION public.fn__sugestao_mensagem_trava()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.papel = 'ps' AND auth.uid() IS NOT NULL THEN
    UPDATE sugestoes SET ultimo_movimento = now() WHERE id = NEW.sugestao_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sugestao_mensagem_trava ON public.sugestao_mensagem;
CREATE TRIGGER trg_sugestao_mensagem_trava BEFORE INSERT ON public.sugestao_mensagem
  FOR EACH ROW EXECUTE FUNCTION public.fn__sugestao_mensagem_trava();

REVOKE ALL ON FUNCTION public.fn__chamado_ceo_pode() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn__chamado_pode_atuar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn__chamado_nome(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn__chamado_avisar(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn__chamado_trocar(uuid, uuid, text, text, text, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn__sugestao_carteira_ao_abrir() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn__sugestao_avisar_ao_abrir() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn__sugestao_trava_guarda() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn__sugestao_mensagem_trava() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn__chamado_ceo_pode() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn__chamado_pode_atuar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn__chamado_nome(uuid) TO authenticated;

-- ───────────────────────── 7. Funções da trava (assumir, direcionar, puxar, liberar) ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_chamado_assumir(p_id uuid, p_agente text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); s record;
BEGIN
  IF v_uid IS NULL OR NOT public.fn__chamado_pode_atuar(p_id) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT id, numero, atendente_id, em_atendimento_desde, status INTO s FROM sugestoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'sugestao_nao_encontrada'); END IF;
  IF s.atendente_id = v_uid THEN RETURN jsonb_build_object('ok', true, 'ja_era_seu', true); END IF;
  IF s.atendente_id IS NOT NULL THEN
    IF NOT public.fn__chamado_ceo_pode() THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'em_atendimento', 'atendente', public.fn__chamado_nome(s.atendente_id),
        'mensagem', format('Em atendimento por %s desde %s. Para assumir, use "Puxar" (com motivo).', public.fn__chamado_nome(s.atendente_id),
          to_char(s.em_atendimento_desde AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI')));
    END IF;
    -- o CEO assume chamado de outra pessoa = puxar, sem confirmação extra
    PERFORM public.fn__chamado_trocar(p_id, v_uid, 'puxar', 'o CEO assumiu', p_agente, false, false);
    PERFORM public.fn__chamado_avisar(p_id, s.atendente_id, '#' || s.numero || ' · O CEO assumiu este chamado', 'O CEO assumiu o chamado que estava com você.');
    RETURN jsonb_build_object('ok', true);
  END IF;
  PERFORM public.fn__chamado_trocar(p_id, v_uid, 'assumir', NULL, p_agente, false, false);
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.fn_chamado_liberar(p_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); s record;
BEGIN
  IF v_uid IS NULL OR NOT public.fn__chamado_pode_atuar(p_id) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  SELECT id, numero, atendente_id, responsavel_id INTO s FROM sugestoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'sugestao_nao_encontrada'); END IF;
  IF s.atendente_id IS NULL THEN RETURN jsonb_build_object('ok', true, 'ja_livre', true); END IF;
  IF s.atendente_id <> v_uid AND NOT public.fn__chamado_ceo_pode() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'nao_e_atendente', 'mensagem', 'Só quem está atendendo (ou o CEO) libera o chamado.');
  END IF;
  PERFORM public.fn__chamado_trocar(p_id, NULL, 'liberar', nullif(btrim(coalesce(p_motivo, '')), ''), NULL, false, false);
  PERFORM public.fn__chamado_avisar(p_id, s.responsavel_id, '#' || s.numero || ' · Chamado liberado — voltou para a sua fila',
    public.fn__chamado_nome(v_uid) || ' liberou o chamado' || coalesce(': ' || nullif(btrim(coalesce(p_motivo, '')), ''), '.'));
  RETURN jsonb_build_object('ok', true);
END $$;

-- Direcionar: o atendente atual, o responsável da carteira ou o CEO passam o chamado para outra pessoa da equipe.
CREATE OR REPLACE FUNCTION public.fn_chamado_direcionar(p_id uuid, p_para uuid, p_motivo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); s record; v_nome text;
BEGIN
  IF v_uid IS NULL OR NOT public.fn__chamado_pode_atuar(p_id) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF nullif(btrim(coalesce(p_motivo, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio', 'mensagem', 'Direcionar exige o motivo.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM erp_chamado_equipe WHERE user_id = p_para AND ativo) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'destino_fora_da_equipe', 'mensagem', 'Escolha uma pessoa da equipe de atendimento.');
  END IF;
  SELECT id, numero, atendente_id, responsavel_id INTO s FROM sugestoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'sugestao_nao_encontrada'); END IF;
  IF NOT (s.atendente_id = v_uid OR s.responsavel_id = v_uid OR public.fn__chamado_ceo_pode()) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_permissao_direcionar',
      'mensagem', 'Direciona quem está atendendo, o responsável da carteira ou o CEO. Para trazer para você, use "Puxar".');
  END IF;
  IF s.atendente_id = p_para THEN RETURN jsonb_build_object('ok', true, 'ja_estava', true); END IF;
  PERFORM public.fn__chamado_trocar(p_id, p_para, 'direcionar', btrim(p_motivo), NULL, false, false);
  v_nome := public.fn__chamado_nome(v_uid);
  PERFORM public.fn__chamado_avisar(p_id, p_para, '#' || s.numero || ' · ' || v_nome || ' direcionou este chamado para você', 'Motivo: ' || btrim(p_motivo));
  IF s.atendente_id IS NOT NULL AND s.atendente_id <> v_uid THEN
    PERFORM public.fn__chamado_avisar(p_id, s.atendente_id, '#' || s.numero || ' · ' || v_nome || ' direcionou o chamado para ' || public.fn__chamado_nome(p_para),
      'Você não é mais o atendente deste chamado. Motivo: ' || btrim(p_motivo));
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Puxar: qualquer pessoa da equipe traz para si um chamado que está com outra, com motivo. Se o atendente atual
-- mexeu há menos de 2 h, pede confirmação a mais (p_confirmar = true). O CEO não precisa da confirmação.
CREATE OR REPLACE FUNCTION public.fn_chamado_puxar(p_id uuid, p_motivo text, p_confirmar boolean DEFAULT false, p_agente text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); s record; v_ceo boolean; v_min int; v_recente boolean; v_nome text;
BEGIN
  IF v_uid IS NULL OR NOT public.fn__chamado_pode_atuar(p_id) THEN RETURN jsonb_build_object('ok', false, 'erro', 'sem_acesso'); END IF;
  IF nullif(btrim(coalesce(p_motivo, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'motivo_obrigatorio', 'mensagem', 'Puxar exige o motivo — quem estava atendendo recebe o aviso.');
  END IF;
  SELECT id, numero, atendente_id, ultimo_movimento, em_atendimento_desde, updated_at INTO s FROM sugestoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'sugestao_nao_encontrada'); END IF;
  IF s.atendente_id = v_uid THEN RETURN jsonb_build_object('ok', true, 'ja_era_seu', true); END IF;
  IF s.atendente_id IS NULL THEN
    PERFORM public.fn__chamado_trocar(p_id, v_uid, 'assumir', btrim(p_motivo), p_agente, false, false);
    RETURN jsonb_build_object('ok', true);
  END IF;
  v_ceo := public.fn__chamado_ceo_pode();
  v_min := floor(extract(epoch FROM (now() - coalesce(s.ultimo_movimento, s.em_atendimento_desde, s.updated_at))) / 60)::int;
  v_recente := v_min < 120;
  IF v_recente AND NOT v_ceo AND NOT coalesce(p_confirmar, false) THEN
    RETURN jsonb_build_object('ok', false, 'precisa_confirmar', true, 'minutos', v_min, 'atendente', public.fn__chamado_nome(s.atendente_id),
      'mensagem', format('%s mexeu neste chamado há %s min. Puxar mesmo assim?', public.fn__chamado_nome(s.atendente_id), v_min));
  END IF;
  PERFORM public.fn__chamado_trocar(p_id, v_uid, 'puxar', btrim(p_motivo), p_agente, v_recente AND NOT v_ceo, false);
  v_nome := public.fn__chamado_nome(v_uid);
  PERFORM public.fn__chamado_avisar(p_id, s.atendente_id, v_nome || ' puxou o #' || s.numero || ': ' || left(btrim(p_motivo), 120),
    'Você não é mais o atendente deste chamado. Motivo: ' || btrim(p_motivo));
  RETURN jsonb_build_object('ok', true, 'avisado', public.fn__chamado_nome(s.atendente_id));
END $$;

-- O botão antigo "assumir" passa a usar a trava (o p_user do cliente é ignorado: quem assume é quem está logado).
CREATE OR REPLACE FUNCTION public.fn_sugestao_assumir(p_id uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.fn_chamado_assumir(p_id, NULL);
END $$;

-- Histórico de atendimento do chamado (quem, quando, por quê).
CREATE OR REPLACE FUNCTION public.fn_chamado_historico(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT public.fn_pode_ver_fila_suporte() THEN '[]'::jsonb ELSE coalesce((
    SELECT jsonb_agg(jsonb_build_object('acao', h.acao, 'de', CASE WHEN h.de_user IS NULL THEN NULL ELSE public.fn__chamado_nome(h.de_user) END,
             'para', CASE WHEN h.para_user IS NULL THEN NULL ELSE public.fn__chamado_nome(h.para_user) END,
             'por', CASE WHEN h.criado_por IS NULL THEN 'sistema' ELSE public.fn__chamado_nome(h.criado_por) END,
             'motivo', h.motivo, 'agente', h.agente, 'confirmacao_extra', h.confirmacao_extra, 'automatico', h.automatico,
             'em', h.criado_em) ORDER BY h.criado_em)
    FROM sugestao_atendimento_hist h WHERE h.sugestao_id = p_id), '[]'::jsonb) END
$$;

-- Equipe (para "Direcionar para…" e o filtro por responsável).
CREATE OR REPLACE FUNCTION public.fn_chamado_equipe_listar()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT public.fn_pode_ver_fila_suporte() THEN '[]'::jsonb ELSE coalesce((
    SELECT jsonb_agg(jsonb_build_object('user_id', e.user_id, 'nome', e.nome_curto, 'papel', e.papel, 'agente', e.agente,
             'eu', e.user_id = auth.uid()) ORDER BY CASE e.papel WHEN 'ceo' THEN 0 WHEN 'socio' THEN 1 ELSE 2 END, e.nome_curto)
    FROM erp_chamado_equipe e WHERE e.ativo), '[]'::jsonb) END
$$;

-- ───────────────────────── 8. Carteira: listar e definir (só o CEO) ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_carteira_listar()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT public.fn_pode_ver_fila_suporte() THEN '[]'::jsonb ELSE coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'company_id', c.id, 'empresa', coalesce(c.nome_fantasia, c.razao_social),
             'responsavel_id', k.responsavel_id, 'responsavel', CASE WHEN k.responsavel_id IS NULL THEN NULL ELSE public.fn__chamado_nome(k.responsavel_id) END,
             'interno', coalesce(k.interno, false), 'desde', k.vigencia_inicio,
             'abertos', (SELECT count(*) FROM sugestoes s WHERE s.company_id = c.id AND public.fn__chamado_aberto(s.status)),
             'historico', (SELECT count(*) FROM erp_carteira_responsavel h WHERE h.company_id = c.id))
           ORDER BY (k.responsavel_id IS NULL AND NOT coalesce(k.interno, false)) DESC, coalesce(c.nome_fantasia, c.razao_social))
    FROM companies c LEFT JOIN erp_carteira_responsavel k ON k.company_id = c.id AND k.vigencia_fim IS NULL
    WHERE NOT coalesce(c.is_demo, false)), '[]'::jsonb) END
$$;

CREATE OR REPLACE FUNCTION public.fn_carteira_definir(p_company_id uuid, p_responsavel uuid, p_interno boolean DEFAULT false, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_atual record; v_mov int := 0; r record;
BEGIN
  IF v_uid IS NULL OR NOT public.fn__chamado_ceo_pode() THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'so_ceo', 'mensagem', 'Só o CEO edita a carteira.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id AND NOT coalesce(is_demo, false)) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'empresa_invalida');
  END IF;
  IF p_responsavel IS NOT NULL AND NOT EXISTS (SELECT 1 FROM erp_chamado_equipe WHERE user_id = p_responsavel AND ativo) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'responsavel_fora_da_equipe');
  END IF;
  SELECT * INTO v_atual FROM erp_carteira_responsavel WHERE company_id = p_company_id AND vigencia_fim IS NULL FOR UPDATE;
  IF FOUND AND v_atual.responsavel_id IS NOT DISTINCT FROM p_responsavel AND v_atual.interno = coalesce(p_interno, false) THEN
    RETURN jsonb_build_object('ok', true, 'sem_mudanca', true);
  END IF;
  UPDATE erp_carteira_responsavel SET vigencia_fim = now() WHERE company_id = p_company_id AND vigencia_fim IS NULL;
  INSERT INTO erp_carteira_responsavel (company_id, responsavel_id, interno, motivo, criado_por)
  VALUES (p_company_id, p_responsavel, coalesce(p_interno, false), nullif(btrim(coalesce(p_motivo, '')), ''), v_uid);
  -- chamados ABERTOS da empresa passam a cair no novo responsável (a trava de quem está atendendo continua)
  FOR r IN SELECT id, responsavel_id FROM sugestoes WHERE company_id = p_company_id AND fn__chamado_aberto(status)
             AND responsavel_id IS DISTINCT FROM p_responsavel LOOP
    PERFORM set_config('app.chamado_troca', '1', true);
    UPDATE sugestoes SET responsavel_id = p_responsavel, interno = coalesce(p_interno, false) WHERE id = r.id;
    PERFORM set_config('app.chamado_troca', '', true);
    INSERT INTO sugestao_atendimento_hist (sugestao_id, acao, de_user, para_user, motivo, criado_por)
    VALUES (r.id, 'carteira', r.responsavel_id, p_responsavel, coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'carteira alterada pelo CEO'), v_uid);
    v_mov := v_mov + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'chamados_abertos_movidos', v_mov);
END $$;

-- ───────────────────────── 9. Trava vencida: aviso 4 h antes e expiração em 24 h sem movimento ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_chamados_trava_expirar()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_av int := 0; v_ex int := 0;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Só o robô do banco (cron) roda a expiração' USING ERRCODE = '42501'; END IF;
  FOR r IN SELECT id, numero, atendente_id, responsavel_id FROM sugestoes
            WHERE atendente_id IS NOT NULL AND fn__chamado_aberto(status)
              AND coalesce(ultimo_movimento, em_atendimento_desde, updated_at) < now() - interval '24 hours' LOOP
    PERFORM fn__chamado_trocar(r.id, NULL, 'expirar', '24 h sem movimento', NULL, false, true);
    PERFORM fn__chamado_avisar(r.id, r.atendente_id, '#' || r.numero || ' · Sua trava venceu (24 h sem movimento)', 'O chamado voltou para a fila do responsável.');
    IF r.responsavel_id IS DISTINCT FROM r.atendente_id THEN
      PERFORM fn__chamado_avisar(r.id, r.responsavel_id, '#' || r.numero || ' · Chamado voltou para a sua fila', 'A trava de ' || fn__chamado_nome(r.atendente_id) || ' venceu: 24 h sem movimento.');
    END IF;
    v_ex := v_ex + 1;
  END LOOP;
  FOR r IN SELECT id, numero, atendente_id FROM sugestoes
            WHERE atendente_id IS NOT NULL AND fn__chamado_aberto(status) AND trava_aviso_em IS NULL
              AND coalesce(ultimo_movimento, em_atendimento_desde, updated_at) < now() - interval '20 hours' LOOP
    PERFORM fn__chamado_avisar(r.id, r.atendente_id, '#' || r.numero || ' · Sua trava vence em até 4 h',
      'Sem movimento há 20 h. Faça um movimento no chamado ou libere-o; em 24 h ele volta para a fila do responsável.');
    UPDATE sugestoes SET trava_aviso_em = now() WHERE id = r.id;
    v_av := v_av + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'avisados', v_av, 'expirados', v_ex);
END $$;

REVOKE ALL ON FUNCTION public.fn_chamado_assumir(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_chamado_liberar(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_chamado_direcionar(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_chamado_puxar(uuid, text, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_sugestao_assumir(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_chamado_historico(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_chamado_equipe_listar() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_carteira_listar() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_carteira_definir(uuid, uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_chamados_trava_expirar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_chamado_assumir(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_chamado_liberar(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_chamado_direcionar(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_chamado_puxar(uuid, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sugestao_assumir(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_chamado_historico(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_chamado_equipe_listar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_carteira_listar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_carteira_definir(uuid, uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_chamados_trava_expirar() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chamados-trava-expirar-hora') THEN
    PERFORM cron.unschedule('chamados-trava-expirar-hora');
  END IF;
END $$;
SELECT cron.schedule('chamados-trava-expirar-hora', '17 * * * *', $cron$ SELECT public.fn_chamados_trava_expirar(); $cron$);

-- ───────────────────────── 10. Fila: a view ganha os campos de atendimento ─────────────────────────
CREATE OR REPLACE VIEW public.v_sugestao_fila WITH (security_invoker = true) AS
 SELECT s.id, s.company_id, c.nome_fantasia AS empresa, s.user_email, s.user_name, s.tipo, s.titulo, s.descricao, s.categoria,
    s.prioridade, s.status, s.rota, s.area, s.atendente_id, s.pr_numero, s.resposta, s.concluido_em,
    (s.ia_analise IS NOT NULL) AS tem_ia, s.ia_analise, s.ia_analisado_em,
    (SELECT count(*) AS count FROM sugestao_anexo a WHERE a.sugestao_id = s.id) AS n_anexos,
    s.created_at,
    ((EXTRACT(epoch FROM (now() - s.created_at)) / (86400)::numeric))::integer AS dias_aberta,
    s.resposta_aprovada, s.resposta_aprovada_em, s.confirmado_pelo_autor, s.confirmado_em, s.numero, s.erro_assinatura,
    s.origem_sugestao_id,
    (SELECT sm.erro_comparacao FROM sugestao_mensagem sm WHERE sm.sugestao_id = s.id AND sm.erro_comparacao IS NOT NULL
      ORDER BY sm.criado_em DESC LIMIT 1) AS ultimo_erro_comparacao,
    s.resposta_redigida_por, s.resposta_origem, s.resposta_aprovada_por,
    (SELECT COALESCE(u.full_name, u.email) AS "coalesce" FROM users u WHERE u.id = s.resposta_aprovada_por) AS aprovador_nome,
    (SELECT COALESCE(u.full_name, u.email) AS "coalesce" FROM users u WHERE u.id = s.resposta_redigida_por) AS redator_nome,
    s.responsavel_id,
    (SELECT e.nome_curto FROM erp_chamado_equipe e WHERE e.user_id = s.responsavel_id) AS responsavel_nome,
    (SELECT coalesce(e.nome_curto, split_part(coalesce(u.full_name, u.email, ''), ' ', 1))
       FROM users u LEFT JOIN erp_chamado_equipe e ON e.user_id = u.id WHERE u.id = s.atendente_id) AS atendente_nome,
    s.em_atendimento_desde, s.ultimo_movimento, s.interno, s.agente, s.ramo
   FROM sugestoes s LEFT JOIN companies c ON c.id = s.company_id;

-- ───────────────────────── 11. Carga da carteira + implantação ─────────────────────────
INSERT INTO public.erp_carteira_responsavel (company_id, responsavel_id, interno, motivo)
SELECT k.company_id, k.responsavel_id, k.interno, 'carteira inicial (SPEC Chamados em equipe rev. 9)'
FROM (VALUES
  -- Jordana
  ('9a3ddff7-82a3-4b32-b541-4261015821e8'::uuid, '43ef8386-3262-4e56-b31a-6f0e41d1e21c'::uuid, false), -- Breier Soluções Integradas
  ('b202b50f-37cb-462e-accf-126869de49f0'::uuid, '43ef8386-3262-4e56-b31a-6f0e41d1e21c'::uuid, false), -- FC Pisos
  ('3ddcaac8-7a54-4845-8d1b-835dfc11bd68'::uuid, '43ef8386-3262-4e56-b31a-6f0e41d1e21c'::uuid, false), -- FCR Materiais
  ('a462e13f-0f51-4c54-abe8-4474b591633b'::uuid, '43ef8386-3262-4e56-b31a-6f0e41d1e21c'::uuid, false), -- Gean Auto Mecânica
  ('edd4979c-e9aa-4f40-a342-44a8f779c1d2'::uuid, '43ef8386-3262-4e56-b31a-6f0e41d1e21c'::uuid, false), -- Mecânica Diesel Triches
  ('659c8522-c7d0-44c1-a754-e6d81fa905d2'::uuid, '43ef8386-3262-4e56-b31a-6f0e41d1e21c'::uuid, false), -- Nueva Energia Solar
  ('c7b8719d-1bc3-4ff1-828e-93650951c384'::uuid, '43ef8386-3262-4e56-b31a-6f0e41d1e21c'::uuid, false), -- Odair Breier
  ('36b69d77-b4ea-414b-8519-2ff6621c8de7'::uuid, '43ef8386-3262-4e56-b31a-6f0e41d1e21c'::uuid, false), -- Pdois
  ('b2b96eef-0ad9-4588-85c1-a4e9f2cd7490'::uuid, '43ef8386-3262-4e56-b31a-6f0e41d1e21c'::uuid, false), -- Proplay
  ('1174714d-3867-41e4-9186-6be94e530273'::uuid, '43ef8386-3262-4e56-b31a-6f0e41d1e21c'::uuid, false), -- Stel Instalações Elétricas
  ('22a7f4fd-149d-47ee-8dd2-bfbb4c897f58'::uuid, '43ef8386-3262-4e56-b31a-6f0e41d1e21c'::uuid, false), -- Toy Tintas
  -- Rodrigo
  ('5ab9cfd2-1446-4c0b-a069-0c7ea04e0cfb'::uuid, '33464170-036f-4d3b-bc48-f2dc3dfde660'::uuid, false), -- Alliance Veículos
  ('e46c50e5-eaae-4f4f-913b-bf7aadffbb18'::uuid, '33464170-036f-4d3b-bc48-f2dc3dfde660'::uuid, false), -- Felicita
  ('5d30d19f-0138-400b-9e71-01973f355bbe'::uuid, '33464170-036f-4d3b-bc48-f2dc3dfde660'::uuid, false), -- Genius Teck
  ('1163bb56-616b-435d-a9a3-621e562dfb55'::uuid, '33464170-036f-4d3b-bc48-f2dc3dfde660'::uuid, false), -- M.m Serviços e Acabamentos
  ('d1330faf-78f8-40fc-904f-711a6e4b7352'::uuid, '33464170-036f-4d3b-bc48-f2dc3dfde660'::uuid, false), -- R.R Serviços e Acabamentos
  ('50b1da9b-7367-4489-8b50-e62dd6efc760'::uuid, '33464170-036f-4d3b-bc48-f2dc3dfde660'::uuid, false), -- Tryo Acabamentos
  ('918c3ea4-770d-4a10-9200-f9c21f92a1f6'::uuid, '33464170-036f-4d3b-bc48-f2dc3dfde660'::uuid, false), -- Tryo Gesso
  ('64400871-b402-4d55-abcd-450e0b88ed92'::uuid, '33464170-036f-4d3b-bc48-f2dc3dfde660'::uuid, false), -- Vianz Performance Diesel
  -- Gilberto (CEO)
  ('975365cc-9e5a-4251-9022-68c6bfde10d8'::uuid, '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb'::uuid, false), -- Frioeste
  ('37d88cda-b558-4b9a-8804-0e90f024da4f'::uuid, '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb'::uuid, false), -- Mariele Móveis
  -- André
  ('636af107-f11f-4f0c-8aaa-3fd3d0ffdf38'::uuid, 'f3867e65-94d6-43c0-aeb9-8da82fcfe433'::uuid, false), -- Estância Umuarama
  -- Interno PS (backlog de desenvolvimento) — com o CEO
  ('b26c19c0-bf6d-495b-b8d1-9fa8d6896725'::uuid, '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb'::uuid, true),  -- Ps Gestão LTDA
  ('25305b15-09e1-4abe-944f-9bff31743350'::uuid, '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb'::uuid, true)   -- PS Gestão & Capital
) AS k(company_id, responsavel_id, interno)
WHERE EXISTS (SELECT 1 FROM public.companies c WHERE c.id = k.company_id)
  AND NOT EXISTS (SELECT 1 FROM public.erp_carteira_responsavel x WHERE x.company_id = k.company_id AND x.vigencia_fim IS NULL);

DO $$
DECLARE
  v_ceo   uuid := '4a3b3c86-e1a0-412c-9d0b-ac22f35c2abb';
  v_robo  uuid := '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa';
  v_resp  int; v_livres int := 0; v_ceo_fica int := 0; r record;
BEGIN
  PERFORM set_config('app.chamado_troca', '1', true);
  -- responsável e "interno" em TODOS os chamados (abertos e fechados), pela carteira vigente
  UPDATE public.sugestoes s SET responsavel_id = k.responsavel_id, interno = k.interno
    FROM public.erp_carteira_responsavel k
   WHERE k.company_id = s.company_id AND k.vigencia_fim IS NULL
     AND (s.responsavel_id IS DISTINCT FROM k.responsavel_id OR s.interno IS DISTINCT FROM k.interno);
  GET DIAGNOSTICS v_resp = ROW_COUNT;

  -- abertos com o CEO ou com o robô: carteira do CEO (Frioeste, Mariele, internos) fica com o CEO; o resto vai LIVRE
  -- para a fila do responsável. Uma linha de histórico "implantacao" por chamado que mudou.
  FOR r IN SELECT s.id, s.atendente_id, s.responsavel_id FROM public.sugestoes s
            WHERE public.fn__chamado_aberto(s.status) AND s.atendente_id IN (v_ceo, v_robo) LOOP
    IF r.responsavel_id = v_ceo THEN
      UPDATE public.sugestoes SET atendente_id = v_ceo, em_atendimento_desde = coalesce(em_atendimento_desde, now()),
             ultimo_movimento = now(), agente = 'code-gilberto' WHERE id = r.id;
      IF r.atendente_id <> v_ceo THEN
        INSERT INTO public.sugestao_atendimento_hist (sugestao_id, acao, de_user, para_user, motivo, automatico)
        VALUES (r.id, 'implantacao', r.atendente_id, v_ceo, 'implantação: carteira do CEO', true);
      END IF;
      v_ceo_fica := v_ceo_fica + 1;
    ELSE
      UPDATE public.sugestoes SET atendente_id = NULL, em_atendimento_desde = NULL, agente = NULL, ultimo_movimento = now() WHERE id = r.id;
      INSERT INTO public.sugestao_atendimento_hist (sugestao_id, acao, de_user, para_user, motivo, automatico)
      VALUES (r.id, 'implantacao', r.atendente_id, NULL, 'implantação: livre na fila do responsável da carteira', true);
      v_livres := v_livres + 1;
    END IF;
  END LOOP;
  -- demais travas abertas: marca o movimento de hoje (senão expirariam todas na primeira hora)
  UPDATE public.sugestoes SET ultimo_movimento = coalesce(ultimo_movimento, now()), em_atendimento_desde = coalesce(em_atendimento_desde, now())
   WHERE atendente_id IS NOT NULL AND public.fn__chamado_aberto(status);
  PERFORM set_config('app.chamado_troca', '', true);
  RAISE NOTICE 'Chamados em equipe · implantação: % chamados com responsável/interno gravados; % abertos liberados para a fila do responsável; % ficam com o CEO (carteira dele).',
    v_resp, v_livres, v_ceo_fica;
END $$;
