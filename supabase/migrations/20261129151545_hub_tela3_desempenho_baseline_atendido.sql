-- Hub · tela 3 (Base protegida · Desempenho Comercial) · RD-38 reconcilia baseline
-- Requisito: "PRESERVAR: desempenho comercial por mês, trimestre, ano e período personalizado"
--
-- O status estava 'parcial' por DOIS motivos da fotografia de 09/10, ambos JÁ RESOLVIDOS na main:
--   (1) "Abriu vazia na DEMO (sem perdas registradas)": a tela hoje tem fallback automático de período
--       (escolhe o menor período com dado: trimestre -> ano -> 12 meses) e estado vazio honesto com o
--       próximo passo — src/app/dashboard/projetos/desempenho/page.tsx (auto-período + bloco "desempenho-vazio").
--   (2) "tabela rola no celular": a tela hoje mostra um cartão por vendedor no celular (className "md:hidden",
--       data-testid "desempenho-ranking-cartoes") e a tabela só aparece a partir de md — src/app/.../desempenho/page.tsx.
-- O núcleo do requisito (os 4 modos de período: Mês/Trimestre/Ano/Personalizado) está implementado nos botões
-- de preset + inputs de data (preset()/setPreset()). Logo o requisito está ATENDIDO.
--
-- Migration ADITIVA e IDEMPOTENTE: apenas atualiza a linha do blueprint se ainda estiver 'parcial'.
-- Não toca dado de cliente. RD-52: arquivo + PR.

UPDATE public.blueprint_tela_requisito
SET status_baseline = 'atendido',
    evidencia_baseline = 'Reconciliado (RD-38): 4 modos de período (Mês/Trimestre/Ano/Personalizado) implementados em '
      || 'src/app/dashboard/projetos/desempenho/page.tsx (preset/setPreset + inputs de data). Os 2 motivos do '
      || '''parcial'' de 09/10 resolvidos: abertura vazia -> fallback automático de período + estado vazio honesto '
      || '(data-testid desempenho-vazio); tabela no celular -> cartões por vendedor (data-testid '
      || 'desempenho-ranking-cartoes, className md:hidden). Rota: /dashboard/projetos/desempenho.'
WHERE id = 'bd3110e3-c054-4db9-b082-a8fc215d87f1'
  AND vertical = 'hub_projetos'
  AND tela_num = 3
  AND status_baseline = 'parcial';
