-- Central de Melhorias · Fase 1 · modelo. Reusa sugestoes (RD-26/30): não cria tabela nova para
-- a sugestão, só acrescenta colunas. Anexo (foto + marcação) em tabela própria. Bucket PRIVADO
-- (foto de usuário pode ter dado de cliente — nunca no system-screenshots público).
--
-- RLS da fila (achado da auditoria): is_admin() gateia por role (adm/acesso_total), NÃO por
-- system_role — então PS_SUPPORT e alguns PS_ADMIN não passam. A fila cruzada gateia por
-- system_role IN ('PS_ADMIN','PS_SUPPORT') via helper. Decisão do CEO: CLIENT_OWNER vê só as
-- próprias (sem cláusula de empresa).

-- helper: quem enxerga a fila de suporte (todas as empresas)
CREATE OR REPLACE FUNCTION public.fn_pode_ver_fila_suporte()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND system_role IN ('PS_ADMIN','PS_SUPPORT'))
$function$;
REVOKE ALL ON FUNCTION public.fn_pode_ver_fila_suporte() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_pode_ver_fila_suporte() TO authenticated, service_role;

-- (2.1) sugestoes ganha colunas (as 11 existentes: company_id nasce nulo — são do CEO/Rodrigo)
ALTER TABLE public.sugestoes
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id),
  ADD COLUMN IF NOT EXISTS rota text,
  ADD COLUMN IF NOT EXISTS area text,
  ADD COLUMN IF NOT EXISTS categoria text,
  ADD COLUMN IF NOT EXISTS atendente_id uuid,
  ADD COLUMN IF NOT EXISTS pr_numero integer,
  ADD COLUMN IF NOT EXISTS concluido_em timestamptz,
  ADD COLUMN IF NOT EXISTS ia_analise jsonb,
  ADD COLUMN IF NOT EXISTS ia_analisado_em timestamptz,
  ADD COLUMN IF NOT EXISTS ia_custo_usd numeric;

-- estados da fila (CHECK brando: mantém os valores atuais + os novos do fluxo)
DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sugestoes_status_fluxo_chk') THEN
    ALTER TABLE public.sugestoes ADD CONSTRAINT sugestoes_status_fluxo_chk
      CHECK (status IS NULL OR status IN ('nova','em_analise','aceita','em_desenvolvimento','concluida','recusada','duplicada',
                                          'aberta','pendente','em_andamento','concluido','resolvida')) NOT VALID;
  END IF;
END $chk$;

-- RLS estendida: fila para PS_ADMIN/PS_SUPPORT (system_role) + role-admins (is_admin) + dono (user_id)
DROP POLICY IF EXISTS sug_all ON public.sugestoes;
CREATE POLICY sug_rw ON public.sugestoes FOR ALL
  USING (is_admin() OR public.fn_pode_ver_fila_suporte() OR user_id = auth.uid())
  WITH CHECK (is_admin() OR public.fn_pode_ver_fila_suporte() OR user_id = auth.uid());

-- (2.2) anexo: foto + marcação (coordenadas relativas)
CREATE TABLE IF NOT EXISTS public.sugestao_anexo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sugestao_id uuid NOT NULL REFERENCES public.sugestoes(id) ON DELETE CASCADE,
  company_id uuid,
  storage_path text NOT NULL,
  url_publica text,
  tipo text DEFAULT 'imagem',
  marcacoes jsonb DEFAULT '[]'::jsonb,
  ordem int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  created_by uuid
);
CREATE INDEX IF NOT EXISTS ix_sugestao_anexo_sugestao ON public.sugestao_anexo (sugestao_id);

ALTER TABLE public.sugestao_anexo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sug_anexo_rw ON public.sugestao_anexo;
-- visível/editável se a sugestão-pai é visível (mesmo critério): fila-suporte, admin, ou dono da sugestão
CREATE POLICY sug_anexo_rw ON public.sugestao_anexo FOR ALL
  USING (is_admin() OR public.fn_pode_ver_fila_suporte()
         OR EXISTS (SELECT 1 FROM public.sugestoes s WHERE s.id = sugestao_id AND s.user_id = auth.uid()))
  WITH CHECK (is_admin() OR public.fn_pode_ver_fila_suporte()
         OR EXISTS (SELECT 1 FROM public.sugestoes s WHERE s.id = sugestao_id AND s.user_id = auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sugestao_anexo TO authenticated;

-- bucket PRIVADO para as fotos dos usuários
INSERT INTO storage.buckets (id, name, public) VALUES ('sugestoes-anexos','sugestoes-anexos', false)
ON CONFLICT (id) DO NOTHING;

-- storage RLS: authenticated envia (INSERT) no bucket; leitura/gestão para fila-suporte, admin
-- ou dono (o path começa com o auth.uid() do remetente — convenção <uid>/<sugestao_id>/<arquivo>).
DROP POLICY IF EXISTS sug_anexo_insert ON storage.objects;
CREATE POLICY sug_anexo_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='sugestoes-anexos' AND (split_part(name,'/',1) = auth.uid()::text OR public.fn_pode_ver_fila_suporte() OR is_admin()));
DROP POLICY IF EXISTS sug_anexo_select ON storage.objects;
CREATE POLICY sug_anexo_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='sugestoes-anexos' AND (split_part(name,'/',1) = auth.uid()::text OR public.fn_pode_ver_fila_suporte() OR is_admin()));
DROP POLICY IF EXISTS sug_anexo_delete ON storage.objects;
CREATE POLICY sug_anexo_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id='sugestoes-anexos' AND (split_part(name,'/',1) = auth.uid()::text OR public.fn_pode_ver_fila_suporte() OR is_admin()));
