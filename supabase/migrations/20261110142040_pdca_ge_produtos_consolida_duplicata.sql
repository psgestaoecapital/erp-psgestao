-- PDCA GE (Princípio 3 — menu limpo, CEO 07/11): consolidação da tela DUPLICADA /dashboard/produtos.
-- A tela CANÔNICA é /dashboard/cadastros/produtos (única no menu/module_catalog; superset: ProdutoForm,
-- import fiscal, autoclassificar, clonar, etiquetas A4, excluir). /dashboard/produtos era uma DUPLICATA
-- (CRUD inline, 387 linhas) fora do menu, com SELO ERRADO (estado_real='placeholder' apesar de full CRUD).
--
-- No código (mesma PR): a canônica absorveu o deep-link ?busca; os links "Editar" de /compras/margem-negativa
-- e /compras/custo-simulacao passam a apontar para a canônica; a rota /dashboard/produtos vira redirect 308
-- (next.config.ts) e o arquivo da página duplicada foi removido. Aqui só corrigimos o METADADO do selo —
-- NENHUM dado de cliente é tocado.

-- 1) Alinha o CHECK de estado_real com o filtro já em produção desde #4110 (que compara
--    `estado_real <> 'removido'`, porém a constraint não permitia 'removido' — valor morto latente).
--    Idempotente e ADITIVO (apenas amplia o conjunto permitido; nenhuma linha atual viola).
ALTER TABLE public.system_screens DROP CONSTRAINT IF EXISTS system_screens_estado_real_check;
ALTER TABLE public.system_screens ADD CONSTRAINT system_screens_estado_real_check
  CHECK (estado_real = ANY (ARRAY['pronto','parcial','placeholder','quebrada','desconhecida','removido']::text[]));

-- 2) Marca a rota duplicada como REMOVIDA (redirect) e NÃO-AUDITÁVEL (o aud8 não deve tentar fotografar
--    um redirect). Idempotente (valores fixos).
UPDATE public.system_screens
SET estado_real          = 'removido',
    auditavel_robo       = false,
    motivo_nao_auditavel = 'Rota consolidada: redirect 308 para /dashboard/cadastros/produtos (tela canônica).',
    observacoes          = 'Duplicata aposentada na consolidação PDCA GE (Princ.3 menu limpo): a canônica '
                           '/dashboard/cadastros/produtos (superset) absorveu o deep-link ?busca.',
    atualizado_em        = now()
WHERE rota = '/dashboard/produtos';
