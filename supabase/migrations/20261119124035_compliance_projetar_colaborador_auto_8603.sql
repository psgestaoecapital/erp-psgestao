-- #8603 (FRIOESTE / compliance) — "Funcionário não aparece no sistema": colaborador novo do ponto (iopoint) não
-- entra em compliance_funcionarios, então não aparece na tela /dashboard/compliance/funcionarios nem dá para
-- parametrizar pausa (ex.: MAIKER ALEXANDER SALAZAR YEGRES e HECTOR FREDDERY ROSQUEL MARCANO, câmara fria, admitidos 10/11).
--
-- CAUSA (provado no banco): a projeção ind_ponto_colaborador → compliance_funcionarios SEMPRE foi MANUAL — o botão
-- "Importar pro Compliance" (fn_compliance_projetar_de_ind_ponto), chamado só pela tela. Não há trigger nem cron: o
-- sync do ponto (fn_ponto_sync_dispatch → /api/cron/ponto-diario) popula ind_ponto_colaborador mas NÃO projeta no
-- compliance. O último clique foi 22/10, então os 47 colaboradores sincronizados depois ficaram de fora.
--
-- CONSERTO: colaborador novo entra SOZINHO (por CPF, sem duplicar).
--   (A) TRIGGER AFTER INSERT em ind_ponto_colaborador projeta o novo colaborador em compliance_funcionarios — só para
--       empresas que JÁ usam o compliance (têm linhas lá), por CPF (dígitos), sem duplicar. Metadado manual existente
--       nunca é tocado (só insere quando não existe). RETURNS trigger (isento da guarda de empresa do check-fn-guards).
--   (B) BACKFILL dos que ficaram de fora (todas as empresas que usam compliance), com cópia de segurança antes e prova.
--   (C) ELEGIBILIDADE NR-36 pela REGRA POR FUNÇÃO já existente: marca termica_253 nos colaboradores cuja FUNÇÃO já é
--       elegível-por-função (origem='funcao') na mesma empresa — é a regra estabelecida, não marcação em massa.

-- ───────── (A) projeção automática ─────────
CREATE OR REPLACE FUNCTION public.fn_compliance_projetar_colaborador_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.cpf IS NULL OR btrim(NEW.cpf) = '' OR NEW.nome IS NULL OR btrim(NEW.nome) = '' THEN RETURN NEW; END IF;
  -- só projeta para empresa que JÁ usa o compliance (evita ruído em quem não usa o módulo)
  IF NOT EXISTS (SELECT 1 FROM public.compliance_funcionarios cf WHERE cf.company_id = NEW.company_id) THEN RETURN NEW; END IF;
  -- por CPF (dígitos), sem duplicar; metadado manual existente fica intocado (só insere quando falta)
  INSERT INTO public.compliance_funcionarios
    (company_id, nome_completo, cpf, email, matricula, funcao, cargo, setor, data_admissao, ativo, vinculo_tipo)
  SELECT NEW.company_id, NEW.nome, NEW.cpf, NEW.email, NEW.matricula, NEW.funcao, NEW.funcao, NEW.departamento, NEW.admissao, true, 'direto'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.compliance_funcionarios cf
     WHERE cf.company_id = NEW.company_id
       AND regexp_replace(coalesce(cf.cpf,''), '[^0-9]', '', 'g') = regexp_replace(NEW.cpf, '[^0-9]', '', 'g')
       AND regexp_replace(NEW.cpf, '[^0-9]', '', 'g') <> '');
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_compliance_projetar_colaborador_trg() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_compliance_projetar_colaborador ON public.ind_ponto_colaborador;
CREATE TRIGGER trg_compliance_projetar_colaborador
  AFTER INSERT ON public.ind_ponto_colaborador
  FOR EACH ROW EXECUTE FUNCTION public.fn_compliance_projetar_colaborador_trg();

-- ───────── (B) backfill dos que já ficaram de fora (cópia de segurança antes) ─────────
CREATE TABLE IF NOT EXISTS public.compliance_funcionarios_bkp_8603 (
  id uuid, company_id uuid, cpf text, bkp_em timestamptz NOT NULL DEFAULT now());
-- cópia tem CPF (LGPD): fechada para a API — RLS ligada sem policy e sem grant para anon/authenticated
ALTER TABLE public.compliance_funcionarios_bkp_8603 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.compliance_funcionarios_bkp_8603 FROM PUBLIC, anon, authenticated;
INSERT INTO public.compliance_funcionarios_bkp_8603 (id, company_id, cpf)
  SELECT id, company_id, cpf FROM public.compliance_funcionarios;

-- projeta os faltantes, deduplicando por CPF (CPF com 2+ matrículas no ponto não vira 2 linhas no compliance)
INSERT INTO public.compliance_funcionarios
  (company_id, nome_completo, cpf, email, matricula, funcao, cargo, setor, data_admissao, ativo, vinculo_tipo)
SELECT DISTINCT ON (c.company_id, regexp_replace(c.cpf, '[^0-9]', '', 'g'))
  c.company_id, c.nome, c.cpf, c.email, c.matricula, c.funcao, c.funcao, c.departamento, c.admissao, true, 'direto'
FROM public.ind_ponto_colaborador c
WHERE c.cpf IS NOT NULL AND btrim(c.cpf) <> '' AND c.nome IS NOT NULL AND btrim(c.nome) <> ''
  AND EXISTS (SELECT 1 FROM public.compliance_funcionarios cf0 WHERE cf0.company_id = c.company_id)       -- empresa que usa compliance
  AND NOT EXISTS (
    SELECT 1 FROM public.compliance_funcionarios cf
     WHERE cf.company_id = c.company_id
       AND regexp_replace(coalesce(cf.cpf,''), '[^0-9]', '', 'g') = regexp_replace(c.cpf, '[^0-9]', '', 'g')
       AND regexp_replace(c.cpf, '[^0-9]', '', 'g') <> '')
ORDER BY c.company_id, regexp_replace(c.cpf, '[^0-9]', '', 'g'), c.sincronizado_em DESC NULLS LAST;

-- ───────── (C) elegibilidade NR-36 pela regra por função JÁ estabelecida ─────────
-- marca termica_253 só nos colaboradores cuja FUNÇÃO já tem elegível-por-função (origem='funcao') ativo na mesma
-- empresa — é a regra que o RH já aplicou (ex.: OPERADOR DE CAMARA FRIA II). Não cria regra nova nem marca em massa.
INSERT INTO public.nr36_funcionario_elegivel (company_id, colaborador_id, tipo, origem, ativo)
SELECT DISTINCT c.company_id, c.id, 'termica_253', 'funcao', true
FROM public.ind_ponto_colaborador c
WHERE c.funcao IS NOT NULL AND btrim(c.funcao) <> ''
  AND EXISTS (
    SELECT 1 FROM public.nr36_funcionario_elegivel e
      JOIN public.ind_ponto_colaborador c2 ON c2.id = e.colaborador_id
     WHERE e.company_id = c.company_id AND e.tipo = 'termica_253' AND e.origem = 'funcao' AND e.ativo
       AND c2.funcao = c.funcao)
  AND NOT EXISTS (
    SELECT 1 FROM public.nr36_funcionario_elegivel e2
     WHERE e2.company_id = c.company_id AND e2.colaborador_id = c.id AND e2.tipo = 'termica_253')
ON CONFLICT (company_id, colaborador_id, tipo) DO NOTHING;
