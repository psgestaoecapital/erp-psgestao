-- HB1 · Resultado por obra — custo de mão de obra alocado (CEO 15/10 · Diego/FC · Virada 01/11). ADITIVA: objetos novos.
--   projetos_obra_horas = horas apontadas na obra por função (projetos_mao_obra); custo/h congelado no apontamento.
--   fn_obras_custo_mao_obra = Σ horas × custo/h por obra (só leitura; a empresa tem de ser do usuário).
-- Escrita da tabela entra na próxima entrega (tela de apontamento via RPC); aqui só leitura (REVOKE de escrita).
CREATE TABLE IF NOT EXISTS public.projetos_obra_horas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  obra_id uuid NOT NULL REFERENCES public.projetos_obras(id),
  mao_obra_id uuid REFERENCES public.projetos_mao_obra(id),
  data date NOT NULL DEFAULT CURRENT_DATE,
  horas numeric(8,2) NOT NULL CHECK (horas > 0 AND horas <= 24),
  custo_hora numeric(12,4) NOT NULL CHECK (custo_hora >= 0),
  observacao text,
  excluido_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX IF NOT EXISTS ix_obra_horas_obra ON public.projetos_obra_horas (obra_id) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS ix_obra_horas_company ON public.projetos_obra_horas (company_id);
ALTER TABLE public.projetos_obra_horas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projetos_obra_horas_select ON public.projetos_obra_horas;
CREATE POLICY projetos_obra_horas_select ON public.projetos_obra_horas FOR SELECT TO authenticated
  USING (company_id IN (SELECT public.get_user_company_ids()) OR public.is_admin());
REVOKE ALL ON public.projetos_obra_horas FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.projetos_obra_horas FROM authenticated;
GRANT SELECT ON public.projetos_obra_horas TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_obras_custo_mao_obra(p_company_ids uuid[])
 RETURNS TABLE(obra_id uuid, horas numeric, custo_mao_obra numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT o.id,
         COALESCE((SELECT sum(h.horas) FROM public.projetos_obra_horas h
                    WHERE h.obra_id = o.id AND h.excluido_em IS NULL), 0)::numeric(14,2),
         COALESCE((SELECT sum(h.horas * h.custo_hora) FROM public.projetos_obra_horas h
                    WHERE h.obra_id = o.id AND h.excluido_em IS NULL), 0)::numeric(14,2)
    FROM public.projetos_obras o
   WHERE o.company_id = ANY(p_company_ids)
     AND o.company_id IN (SELECT public.get_user_company_ids());
$function$;
REVOKE ALL ON FUNCTION public.fn_obras_custo_mao_obra(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_obras_custo_mao_obra(uuid[]) TO authenticated, service_role;

INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'hub_construcao', 'publicado'
FROM (VALUES
 ('projetos.resultado_obra.mao_obra', 'Resultado por obra', 'Mão de obra', 'Nada a preencher: a coluna soma as horas apontadas na obra vezes o custo da hora de cada função.', 'Mostra quanto a equipe custou na obra e entra no custo e na margem.', 'Pedreiro 40 h a R$ 30,00/h = R$ 1.200,00.', 'Esperar valor sem ter apontado horas na obra: sem apontamento a coluna fica em zero.', 22, '/dashboard/projetos/obras/resultado')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
