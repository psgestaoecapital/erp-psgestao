-- P&M · Importar jobs do SIGA (auditoria 31/10, nota 75 → >=95): HISTÓRICO de importações com rastro.
-- A tela já tem prévia/validação (passos 2-3: mapa de colunas, "entram/ficam de fora", conferência no banco
-- antes de gravar) — o achado "sem preview" era a foto da tela vazia. Faltava o histórico com rastro.
-- Tabela NOVA agency_siga_importacao (aditiva): RLS por company_id, REVOKE anon, sem UPDATE/DELETE pelo cliente
-- (log imutável; nunca DELETE físico). O cliente grava uma linha a cada importação concluída; a leitura é por empresa.
CREATE TABLE IF NOT EXISTS public.agency_siga_importacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid DEFAULT auth.uid(),
  arquivo text,
  total integer NOT NULL DEFAULT 0,
  novos integer NOT NULL DEFAULT 0,
  ja_existem integer NOT NULL DEFAULT 0,
  gravados integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_agency_siga_importacao_empresa ON public.agency_siga_importacao (company_id, criado_em DESC);

ALTER TABLE public.agency_siga_importacao ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.agency_siga_importacao'::regclass AND polname='agency_siga_importacao_sel') THEN
    CREATE POLICY agency_siga_importacao_sel ON public.agency_siga_importacao
      FOR SELECT USING (company_id IN (SELECT get_user_company_ids()) OR is_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.agency_siga_importacao'::regclass AND polname='agency_siga_importacao_ins') THEN
    -- só grava na própria empresa (e como o próprio usuário, se criado_por vier preenchido)
    CREATE POLICY agency_siga_importacao_ins ON public.agency_siga_importacao
      FOR INSERT WITH CHECK (company_id IN (SELECT get_user_company_ids()) AND (criado_por IS NULL OR criado_por = auth.uid()));
  END IF;
END $$;

-- Sem anon; leitura/escrita só para usuário logado (RLS acima restringe por empresa). Sem UPDATE/DELETE (log imutável).
REVOKE ALL ON public.agency_siga_importacao FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.agency_siga_importacao TO authenticated;

-- Ajuda (RD-95)
INSERT INTO erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
 ('pm.siga.importar', '/dashboard/pm/importar-siga', 'Importar SIGA · Ações', 'Importar',
  'Grava no sistema os jobs novos conferidos na prévia. Só habilita depois de "Conferir no sistema".',
  'Trazer de uma vez os jobs do SIGA que ainda não existem, sem duplicar os que já estão.',
  'Prévia diz 31 novos → Importar → 31 jobs criados na Pauta.',
  'Clicar antes de conferir: a importação só roda após a conferência, para não gravar duplicata.',
  'pm', 7, 1, 'publicado'),
 ('pm.siga.historico', '/dashboard/pm/importar-siga', 'Importar SIGA · Histórico', 'Histórico de importações',
  'Lista as importações já feitas nesta empresa: quando, arquivo, quantos entraram e quantos já existiam.',
  'Deixar rastro do que foi importado e quando, para conferência e auditoria.',
  '31/10 14:20 · planilha.xlsx · 31 novos (de 45).',
  'Esperar desfazer por aqui: o histórico é um registro; correções são feitas na Pauta.',
  'pm', 8, 1, 'publicado')
ON CONFLICT (chave) DO NOTHING;

-- Origem do dado (RD-98 pilar 3)
UPDATE public.system_screens
   SET views_consumidas = ARRAY['agency_siga_importacao']::text[],
       rpcs_chamadas = ARRAY['fn_pm_importar_jobs_siga']::text[],
       atualizado_em = now()
 WHERE rota = '/dashboard/pm/importar-siga';
