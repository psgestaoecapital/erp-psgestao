-- Plano de Ação 5W2H (compartilhado, Indústria primeiro) — pedido do CEO 06/10 (Frioeste, reunião quinta 08:00).
-- RD-26: a antiga plano_acao foi removida pelo CEO em 20/05; conferido no banco que não há tabela equivalente
-- (bpo_rotinas é de BPO). Nomes novos: erp_pa_*. Tudo ADITIVO: tabelas novas, RLS por empresa, REVOKE anon.
-- Regra: qualquer membro da empresa vê e cria; só o dono (responsável ou quem criou) altera a ação; os demais só comentam.

CREATE TABLE IF NOT EXISTS public.erp_pa_rotina (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  dia_semana smallint CHECK (dia_semana BETWEEN 0 AND 6),
  horario time,
  ativa boolean NOT NULL DEFAULT true,
  criado_por uuid DEFAULT auth.uid(),
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_erp_pa_rotina_nome ON public.erp_pa_rotina (company_id, lower(nome));

CREATE TABLE IF NOT EXISTS public.erp_pa_acao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  rotina_id uuid REFERENCES public.erp_pa_rotina(id) ON DELETE SET NULL,
  o_que text NOT NULL CHECK (length(btrim(o_que)) > 0),
  por_que text,
  onde text,
  quando date,
  quem_id uuid REFERENCES public.users(id),
  como text,
  quanto numeric(14,2) CHECK (quanto IS NULL OR quanto >= 0),
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','em_andamento','concluida','cancelada')),
  prioridade text NOT NULL DEFAULT 'media' CHECK (prioridade IN ('baixa','media','alta')),
  evidencia_url text,
  concluida_em timestamptz,
  criado_por uuid DEFAULT auth.uid(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_erp_pa_acao_emp ON public.erp_pa_acao (company_id, status, quando);
CREATE INDEX IF NOT EXISTS ix_erp_pa_acao_quem ON public.erp_pa_acao (quem_id) WHERE status IN ('aberta','em_andamento');

CREATE TABLE IF NOT EXISTS public.erp_pa_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  acao_id uuid NOT NULL REFERENCES public.erp_pa_acao(id) ON DELETE CASCADE,
  autor_id uuid DEFAULT auth.uid(),
  tipo text NOT NULL CHECK (tipo IN ('comentario','criacao','status','edicao')),
  texto text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_erp_pa_hist_acao ON public.erp_pa_historico (acao_id, criado_em);

-- carimbo de atualização/conclusão + histórico automático (status e criação)
CREATE OR REPLACE FUNCTION public.fn_pa_acao_trigger() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
-- ci-sem-guarda: fn_pa_acao_trigger — trigger interno, sem GRANT a usuário
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO erp_pa_historico (company_id, acao_id, autor_id, tipo, texto) VALUES (NEW.company_id, NEW.id, auth.uid(), 'criacao', 'Ação criada');
    IF NEW.status = 'concluida' AND NEW.concluida_em IS NULL THEN NEW.concluida_em := now(); END IF;
    RETURN NEW;
  END IF;
  NEW.atualizado_em := now();
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.concluida_em := CASE WHEN NEW.status = 'concluida' THEN now() ELSE NULL END;
    INSERT INTO erp_pa_historico (company_id, acao_id, autor_id, tipo, texto)
    VALUES (NEW.company_id, NEW.id, auth.uid(), 'status', OLD.status || ' → ' || NEW.status);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.fn_pa_acao_trigger() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_pa_acao ON public.erp_pa_acao;
CREATE TRIGGER trg_pa_acao BEFORE INSERT OR UPDATE ON public.erp_pa_acao FOR EACH ROW EXECUTE FUNCTION public.fn_pa_acao_trigger();

ALTER TABLE public.erp_pa_rotina ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_pa_acao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_pa_historico ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pa_rotina_sel ON public.erp_pa_rotina;
CREATE POLICY pa_rotina_sel ON public.erp_pa_rotina FOR SELECT TO authenticated USING (company_id IN (SELECT public.user_company_ids()));
DROP POLICY IF EXISTS pa_rotina_ins ON public.erp_pa_rotina;
CREATE POLICY pa_rotina_ins ON public.erp_pa_rotina FOR INSERT TO authenticated WITH CHECK (company_id IN (SELECT public.user_company_ids()));
DROP POLICY IF EXISTS pa_rotina_upd ON public.erp_pa_rotina;
CREATE POLICY pa_rotina_upd ON public.erp_pa_rotina FOR UPDATE TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND criado_por = auth.uid())
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

DROP POLICY IF EXISTS pa_acao_sel ON public.erp_pa_acao;
CREATE POLICY pa_acao_sel ON public.erp_pa_acao FOR SELECT TO authenticated USING (company_id IN (SELECT public.user_company_ids()));
DROP POLICY IF EXISTS pa_acao_ins ON public.erp_pa_acao;
CREATE POLICY pa_acao_ins ON public.erp_pa_acao FOR INSERT TO authenticated
  WITH CHECK (company_id IN (SELECT public.user_company_ids())
              AND (quem_id IS NULL OR quem_id IN (SELECT user_id FROM public.user_companies WHERE company_id = erp_pa_acao.company_id)));
DROP POLICY IF EXISTS pa_acao_upd ON public.erp_pa_acao;
CREATE POLICY pa_acao_upd ON public.erp_pa_acao FOR UPDATE TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()) AND (quem_id = auth.uid() OR criado_por = auth.uid()))
  WITH CHECK (company_id IN (SELECT public.user_company_ids())
              AND (quem_id IS NULL OR quem_id IN (SELECT user_id FROM public.user_companies WHERE company_id = erp_pa_acao.company_id)));

DROP POLICY IF EXISTS pa_hist_sel ON public.erp_pa_historico;
CREATE POLICY pa_hist_sel ON public.erp_pa_historico FOR SELECT TO authenticated USING (company_id IN (SELECT public.user_company_ids()));
DROP POLICY IF EXISTS pa_hist_ins ON public.erp_pa_historico;
CREATE POLICY pa_hist_ins ON public.erp_pa_historico FOR INSERT TO authenticated
  WITH CHECK (tipo = 'comentario' AND autor_id = auth.uid() AND company_id IN (SELECT public.user_company_ids())
              AND EXISTS (SELECT 1 FROM public.erp_pa_acao a WHERE a.id = acao_id AND a.company_id = erp_pa_historico.company_id));

REVOKE ALL ON public.erp_pa_rotina, public.erp_pa_acao, public.erp_pa_historico FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.erp_pa_rotina, public.erp_pa_acao TO authenticated;
GRANT SELECT, INSERT ON public.erp_pa_historico TO authenticated;

-- menu (Indústria; reutilizável por outras verticais depois)
INSERT INTO public.module_catalog (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, descricao, layer, vertical_specific, is_shared)
VALUES ('plano_acao_5w2h', 'Plano de ação 5W2H', 'industrial', NULL, 'ClipboardCheck', '/dashboard/_compartilhado/plano-acao', 90, true,
        'Ações 5W2H nascidas nas reuniões e rotinas: pauta da próxima reunião, minhas ações, atrasadas, Kanban e ata em PDF.',
        '3_specific', ARRAY['industrial'], true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.plan_modules (plan_id, module_id)
SELECT pm.plan_id, 'plano_acao_5w2h' FROM public.plan_modules pm WHERE pm.module_id = 'industrial_apontamento_mobile'
  AND NOT EXISTS (SELECT 1 FROM public.plan_modules x WHERE x.plan_id = pm.plan_id AND x.module_id = 'plano_acao_5w2h');
