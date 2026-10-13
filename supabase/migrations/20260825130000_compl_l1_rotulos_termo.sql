-- COMPL-L1 · Compliance quick wins (#24 · #20 · #17/#19). Só rótulos/catálogo — sem mexer em
-- rotas/slugs (RD-52: muda a EXIBIÇÃO, não a chave).

-- #24 · Menu "Pausas Técnicas" → "Pausas Térmicas" (NR-36, frigorífico). Rota intacta.
UPDATE public.module_catalog SET nome = 'Pausas Térmicas'
 WHERE id = 'compliance_pausas_tecnicas' AND nome = 'Pausas Técnicas';

-- #20 · Rótulo "Cartão CNPJ MEI Ativo" → "Cartão CNPJ Ativo" (generaliza — nem toda terceira é MEI).
-- Mantém o slug 'cartao_cnpj_mei' (não quebra vínculos) — só o nome exibido muda.
UPDATE public.compliance_tipos_documento SET nome = 'Cartão CNPJ Ativo'
 WHERE slug = 'cartao_cnpj_mei';

-- #17/#19 · Novo tipo "Termo de Compromisso". Auditoria (RD-38): o SPEC trocou categoria/grupo — os
-- valores válidos são categoria ∈ (empresa,funcionario,prestador) e grupo inclui 'juridico'
-- (NÃO 'terceiros'). Corrigido: categoria='prestador' (doc de terceiro/prestador), grupo='juridico'.
INSERT INTO public.compliance_tipos_documento
  (slug, nome, categoria, grupo, descricao, exige_assinatura, aplicavel_a, obrigatorio, ativo, ordem_exibicao)
VALUES
  ('termo-compromisso', 'Termo de Compromisso', 'prestador', 'juridico',
   'Termo de compromisso para liberação de serviço de terceiros',
   true, 'prestador', false, true, 50)
ON CONFLICT (slug) DO NOTHING;
