-- ⑥ · REVELAR o caminho de DESPESA recorrente que JÁ EXISTE (RD-44: corrigir a premissa no dado).
--
-- Premissa que o cliente vivia ("não tem caminho, então duplico à mão as parcelas → '(cópia)'"):
--   quase certa, mas o caminho EXISTE. A tela /dashboard/contratos/recorrencias-ps já tem o wizard
--   com toggle receita/DESPESA + preview de cronograma (fn_contrato_recorrencia_criar grava natureza),
--   e o cron diário (jobid 17, fn_contrato_processar_lote_diario) já roteia
--   natureza='despesa' → fn_contrato_gerar_pagar (conta A PAGAR). O que faltava era DESCOBERTA:
--   a entrada de menu se chamava "Recorrências PS" e a descrição dizia "receita recorrente de serviço"
--   — não parecia servir para aluguel/salário/diarista. Ninguém achou a porta.
--
-- Correção MÍNIMA: só renomeia/redescreve a entrada de menu para deixar claro que registra
-- receita OU despesa. NÃO cria tela, NÃO toca métrica de MRR, NÃO mexe nas outras entradas de contrato.
-- (RD-53 não-regressão: a rota, o grupo e o wizard seguem idênticos; muda só o rótulo que o cliente lê.)

UPDATE public.module_catalog
   SET nome = 'Recorrências (receita e despesa)',
       descricao = 'Contrato recorrente de RECEITA ou DESPESA (aluguel, salário, diarista, mensalidade, BPO). '
                || 'Wizard com preview do cronograma — o sistema gera as parcelas sozinho, a receber ou a pagar. '
                || 'Evita duplicar lançamentos à mão.'
 WHERE id = 'ge_recorrencias_ps';
