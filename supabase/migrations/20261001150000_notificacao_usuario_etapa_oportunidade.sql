-- Chamado #120 (Tryo, CEO 01/10 · DECISÃO): aviso DENTRO do sistema (sino) quando o orçamento/oportunidade muda de
-- etapa, para o RESPONSÁVEL e o VENDEDOR. Custo zero; WhatsApp fica para depois.
-- Hoje o sino (TopNav) só tem duas fontes: alerta do sistema POR EMPRESA (erp_alerta_proativo) e aviso de CHAMADO por
-- pessoa (sugestao_notificacao, preso a sugestoes). Não havia aviso por pessoa de outra coisa. Esta migration cria o
-- aviso genérico por pessoa (erp_notificacao_usuario) e o primeiro gatilho que o usa: a etapa da oportunidade.
--  - quem recebe: responsável da oportunidade + vendedor do orçamento vinculado (sem orçamento/vendedor: quem criou a
--    oportunidade); nunca quem fez a mudança; só quem tem acesso à empresa (vínculo em user_companies ou equipe PS);
--  - o aviso nasce no banco (gatilho), então vale para o arraste no kanban, o formulário e qualquer outra porta;
--  - cada pessoa só lê e marca como lido o PRÓPRIO aviso (RLS); ninguém insere pelo cliente.

CREATE TABLE IF NOT EXISTS public.erp_notificacao_usuario (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  destinatario_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tipo            text NOT NULL,
  titulo          text NOT NULL,
  mensagem        text,
  link            text,
  origem_tipo     text,
  origem_id       uuid,
  autor_id        uuid,
  lida            boolean NOT NULL DEFAULT false,
  lida_em         timestamptz,
  criado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS erp_notificacao_usuario_dest_idx
  ON public.erp_notificacao_usuario (destinatario_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS erp_notificacao_usuario_origem_idx
  ON public.erp_notificacao_usuario (origem_tipo, origem_id);

ALTER TABLE public.erp_notificacao_usuario ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erp_notificacao_usuario_ler_proprio ON public.erp_notificacao_usuario;
CREATE POLICY erp_notificacao_usuario_ler_proprio ON public.erp_notificacao_usuario
  FOR SELECT TO authenticated USING (destinatario_id = auth.uid());

DROP POLICY IF EXISTS erp_notificacao_usuario_marcar_lida ON public.erp_notificacao_usuario;
CREATE POLICY erp_notificacao_usuario_marcar_lida ON public.erp_notificacao_usuario
  FOR UPDATE TO authenticated USING (destinatario_id = auth.uid()) WITH CHECK (destinatario_id = auth.uid());

-- o cliente só lê e marca "lida" — não cria, não apaga, não reescreve o texto
REVOKE ALL ON public.erp_notificacao_usuario FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.erp_notificacao_usuario TO authenticated;
GRANT UPDATE (lida, lida_em) ON public.erp_notificacao_usuario TO authenticated;

-- rótulo humano da etapa (o mesmo do kanban) — o aviso nunca mostra "proposta_enviada"
CREATE OR REPLACE FUNCTION public.fn_crm_etapa_rotulo(p_etapa text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE p_etapa
    WHEN 'prospeccao'       THEN 'Prospecção'
    WHEN 'visita_agendada'  THEN 'Visita Agendada'
    WHEN 'visita_feita'     THEN 'Visita Feita'
    WHEN 'orcando'          THEN 'Orçando'
    WHEN 'proposta_enviada' THEN 'Proposta Enviada'
    WHEN 'negociacao'       THEN 'Negociação'
    WHEN 'ganho'            THEN 'Ganho'
    WHEN 'perdido'          THEN 'Perdido'
    ELSE COALESCE(p_etapa, '—')
  END
$function$;

-- ── gatilho: etapa da oportunidade mudou → avisa responsável e vendedor ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_crm_oport_notificar_etapa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_autor    uuid := auth.uid();
  v_vendedor uuid;
  v_de       text;
  v_para     text;
  v_nome     text;
  v_quem     text;
  v_dest     uuid;
BEGIN
  IF NEW.etapa IS NOT DISTINCT FROM OLD.etapa OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.orcamento_id IS NOT NULL THEN
    SELECT o.vendedor_id INTO v_vendedor FROM public.erp_orcamentos o WHERE o.id = NEW.orcamento_id;
  END IF;
  v_vendedor := COALESCE(v_vendedor, NEW.created_by);

  v_de   := public.fn_crm_etapa_rotulo(OLD.etapa);
  v_para := public.fn_crm_etapa_rotulo(NEW.etapa);
  SELECT COALESCE(NULLIF(btrim(c.nome_fantasia), ''), c.razao_social) INTO v_nome
    FROM public.erp_clientes c WHERE c.id = NEW.cliente_id;
  v_nome := COALESCE(NULLIF(btrim(v_nome), ''), NULLIF(btrim(NEW.titulo), ''), 'Oportunidade');
  SELECT COALESCE(NULLIF(btrim(u.full_name), ''), u.email) INTO v_quem FROM public.users u WHERE u.id = v_autor;

  FOR v_dest IN
    SELECT DISTINCT d FROM unnest(ARRAY[NEW.responsavel_id, v_vendedor]) AS d
     WHERE d IS NOT NULL
       AND d IS DISTINCT FROM v_autor
       AND (EXISTS (SELECT 1 FROM public.user_companies uc WHERE uc.user_id = d AND uc.company_id = NEW.company_id)
            OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = d AND u.system_role IN ('PS_ADMIN', 'PS_ADMIN_CVM')))
  LOOP
    INSERT INTO public.erp_notificacao_usuario
      (company_id, destinatario_id, tipo, titulo, mensagem, link, origem_tipo, origem_id, autor_id)
    VALUES
      (NEW.company_id, v_dest, 'oportunidade_etapa',
       v_nome || ' · ' || v_para,
       'Etapa: ' || v_de || ' → ' || v_para || COALESCE(' · por ' || v_quem, ''),
       '/dashboard/projetos/oportunidades/' || NEW.id,
       'erp_crm_oportunidade', NEW.id, v_autor);
  END LOOP;

  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.fn_crm_oport_notificar_etapa() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_crm_oport_notificar_etapa ON public.erp_crm_oportunidade;
CREATE TRIGGER trg_crm_oport_notificar_etapa
  AFTER UPDATE OF etapa ON public.erp_crm_oportunidade
  FOR EACH ROW EXECUTE FUNCTION public.fn_crm_oport_notificar_etapa();
