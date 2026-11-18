-- Orçamentos · Numeração do orçamento (modal de config) — RD-95 "?" nos 4 campos
-- ============================================================================
-- GAP (RD-95): o modal "Numeração do orçamento" (src/components/orcamento/NumeracaoConfigModal.tsx,
--   aberto em /dashboard/orcamentos) não tinha "?" em nenhum dos 4 campos: Prefixo, Começar do
--   número, Dígitos (padding) e Incluir o ano.
-- CORREÇÃO (aditiva, idempotente): 4 chaves NOVAS no grupo "Orçamento".
-- RD-38: ON CONFLICT (chave) DO UPDATE — re-rodar não duplica.
-- Não toca cálculo, RLS nem dado de cliente: só texto de ajuda num catálogo global.
-- Code: desenvolvedor_4_g
-- ============================================================================

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('orcamentos.config.num_prefixo', '/dashboard/orcamentos', 'Orçamento', 'Prefixo',
   'As letras que abrem o número do orçamento (até 10 caracteres).',
   'Identifica o documento como orçamento e separa a sequência das outras numerações da empresa.',
   'ORC', 'Trocar o prefixo depois de já ter orçamentos emitidos NÃO renumera os antigos — vale só para os próximos.', 'gestao_empresarial', 80),

  ('orcamentos.config.num_proximo', '/dashboard/orcamentos', 'Orçamento', 'Começar do número',
   'O número a partir do qual a sequência começa.',
   'Define o próximo orçamento a ser emitido. É um piso: se já existir número maior neste formato, a sequência continua a partir dele.',
   '1', 'Definir um número menor que um já usado não duplica — o sistema continua do maior número existente no formato.', 'gestao_empresarial', 81),

  ('orcamentos.config.num_padding', '/dashboard/orcamentos', 'Orçamento', 'Dígitos (padding)',
   'Quantos dígitos o número terá, completado com zeros à esquerda (de 1 a 8).',
   'Deixa a numeração alinhada e ordenável (ex.: 0001, 0002…).',
   '4 → 0001', 'Poucos dígitos fazem o número "estourar" o formato quando a sequência cresce (ex.: 2 dígitos já não comportam o 100).', 'gestao_empresarial', 82),

  ('orcamentos.config.num_incluir_ano', '/dashboard/orcamentos', 'Orçamento', 'Incluir o ano',
   'Marque para incluir o ano no número do orçamento.',
   'Organiza a numeração por ano (ex.: ORC-2026-0001), facilitando a leitura e o arquivamento.',
   'Ligado → ORC-2026-0001', 'Ligar ou desligar muda só o formato dos PRÓXIMOS orçamentos; os já emitidos permanecem como estão.', 'gestao_empresarial', 83)
ON CONFLICT (chave) DO UPDATE SET
  rota = EXCLUDED.rota, grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum, vertical = EXCLUDED.vertical,
  ordem = EXCLUDED.ordem, atualizado_em = now();
