-- ============================================================
-- PACOTE Revenda · as telas novas no menu + o badge parar de mentir
-- Falha 1: /dashboard/revenda/preparacao (Onda 9) e /dashboard/revenda/demanda (Onda 10)
--          existem e buildaram, mas nunca foram cadastradas em module_catalog (o menu) — inalcançaveis.
-- Falha 2: feature_catalog marcava as 3 features de revenda como pronto/100 desde 03/09 SEM auditoria,
--          contradizendo system_screens (estado_real=desconhecida). Badge que mente = RD-51/58.
-- ============================================================

-- ------------------------------------------------------------
-- BLOCO 1 · cadastrar as duas rotas no menu (module_catalog)
--   icones: PascalCase lucide (Wrench/Search existem; wrench/search minusculos nao).
--   layer/vertical_specific herdados de revenda_patio (ambos NULL hoje, como as demais revenda_*).
-- ------------------------------------------------------------
INSERT INTO public.module_catalog
  (id, nome, grupo, subgrupo, icone, rota, ordem, ativo, legacy, descricao, layer, vertical_specific)
VALUES
  ('revenda_preparacao', 'Revenda · Preparação', 'revenda_veiculos', 'revenda_veiculos',
   'Wrench', '/dashboard/revenda/preparacao', 190, true, false,
   'Kanban das OS de preparacao dos veiculos do patio: a fazer, fazendo, finalizado.',
   (SELECT layer FROM module_catalog WHERE id='revenda_patio'),
   (SELECT vertical_specific FROM module_catalog WHERE id='revenda_patio')),
  ('revenda_demanda', 'Revenda · O que comprar', 'revenda_veiculos', 'revenda_veiculos',
   'Search', '/dashboard/revenda/demanda', 191, true, false,
   'Demanda que a loja nao atendeu: o que os clientes procuraram e nao havia no patio.',
   (SELECT layer FROM module_catalog WHERE id='revenda_patio'),
   (SELECT vertical_specific FROM module_catalog WHERE id='revenda_patio'))
ON CONFLICT (id) DO NOTHING;

-- vincula aos mesmos planos dos modulos-irmaos do grupo (senao o item nao aparece mesmo cadastrado)
SELECT public.fn_vincular_modulo_aos_planos('revenda_preparacao');
SELECT public.fn_vincular_modulo_aos_planos('revenda_demanda');

-- ------------------------------------------------------------
-- BLOCO 2 · alinhar o badge ao que se sabe (RD-51/58)
--   percentual_pronto era NOT NULL — o SPEC pediu NULL ("nao medimos", nunca 0). Relaxa a constraint
--   antes: NULL e o honesto; nenhum componente de tela le percentual_pronto (so uma edge function,
--   que apenas o interpola em texto), entao NULL nao quebra a UI.
-- ------------------------------------------------------------
ALTER TABLE public.feature_catalog ALTER COLUMN percentual_pronto DROP NOT NULL;

UPDATE public.feature_catalog
   SET status = 'parcial',
       percentual_pronto = NULL,
       observacao = COALESCE(observacao || ' | ', '') ||
         'Ajustado em 07/09/2026: status era pronto/100% desde 03/09 sem auditoria. '
         'system_screens marca as telas como desconhecida. Voltar a pronto so apos veredito '
         'OURO/PRATA da Auditoria Gold e uso real confirmado (RD-38).',
       atualizado_em = now()
 WHERE area = 'revenda_veiculos';
