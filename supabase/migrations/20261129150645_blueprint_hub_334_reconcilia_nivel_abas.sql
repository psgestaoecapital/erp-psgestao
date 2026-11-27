-- Reconciliação de baseline · blueprint_tela_requisito · tela 334 (Hub · importador de orçamento por EAP)
-- Duas features JÁ PUBLICADAS na main seguiam com status desatualizado. Marca SÓ o que está vivo (RD-38),
-- conservador: o que não está provado permanece como estava.
--
--  (A) "Nível pela quantidade de pontos do código (1=etapa, 1.1=subetapa…); linha com unidade = item; linha sem
--      unidade = agrupador." [12c4cc78]  — ausente -> PARCIAL.
--      PROVA: PR #5864 (publicada) — a prévia da importação mostra o NÍVEL da EAP pela contagem de pontos do código
--      (função nivelEap, viva em /orcamento/importar). FALTA (segue parcial): tratar linha sem unidade como agrupador
--      de forma integrada (em revisão na PR #5877), por isso NÃO é "atendido".
--
--  (B) "As outras abas não entram na EAP: Outros Custos e Análise vão para a viabilidade (316)…; ligação entre abas."
--      [c89b3a39] — segue PARCIAL, atualiza a evidência.
--      PROVA: PR #5862 (publicada) — o importador detecta a aba da EAP e IGNORA abas "Análise"/"Outros Custos"/
--      "Resumo"/"Capa" etc. (ehAbaNaoEap). FALTA (segue parcial): levar "Outros Custos"/"Análise" para a viabilidade
--      (316) e a ligação de custo entre abas.
--
-- Data-only, aditiva, idempotente (UPDATE por id da linha do blueprint). Não toca dado de cliente, código, RLS nem
-- estrutura. RD-38: antes status_baseline ('12c4cc78'='ausente', 'c89b3a39'='parcial'); depois ambos 'parcial' com a
-- evidência das PRs vivas.

UPDATE public.blueprint_tela_requisito
   SET status_baseline = 'parcial',
       evidencia_baseline = 'PR #5864 · /orcamento/importar · prévia mostra o nível da EAP pela contagem de pontos do código (nivelEap). Agrupador (linha sem unidade) em revisão na #5877.'
 WHERE id = '12c4cc78-24e2-4f93-8551-94c304bce009'
   AND vertical = 'hub_projetos' AND tela_num = 334
   AND status_baseline = 'ausente';

UPDATE public.blueprint_tela_requisito
   SET status_baseline = 'parcial',
       evidencia_baseline = 'PR #5862 · /orcamento/importar · detecta a aba da EAP e ignora "Análise"/"Outros Custos"/"Resumo"/"Capa" (ehAbaNaoEap). Falta: levar essas abas à viabilidade (316) e a ligação de custo entre abas.'
 WHERE id = 'c89b3a39-1011-44ae-b638-25ba13feed35'
   AND vertical = 'hub_projetos' AND tela_num = 334;
