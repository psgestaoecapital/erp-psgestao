-- RD-95 / RD-98 p2 (PDCA /dashboard/pm/cobranca, aud8 72/95 · gap 2):
-- Não há "Editar" de uma cobrança já lançada (valor/competência) — e NEM deve haver: cobrança é
-- lançamento financeiro e o livro é IMUTÁVEL. A forma correta e rastreável de corrigir é ESTORNAR
-- (soft, com motivo e trilha de auditoria) e LANÇAR de novo com o valor/competência certos.
-- Esta migration só documenta esse fluxo numa nova chave de ajuda ("?") exibida na tela, para o
-- usuário entender por que não existe um botão "Editar". Nenhum cálculo ou dado é alterado.
-- Aditivo e idempotente (ON CONFLICT chave DO NOTHING).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o, v.p, v.e, v.x, v.ordem, '/dashboard/pm/cobranca', 'pm', 'publicado'
FROM (VALUES
 ('pm.cobranca.correcao', 'Cobrança · Ações', 'Corrigir uma cobrança lançada',
  'Não se edita uma cobrança já lançada (indicador, não se digita). Para mudar o valor ou a competência de uma cobrança que já foi lançada, estorne-a (botão Estornar, com o motivo) e lance de novo com os dados certos.',
  'Mantém o livro de cobranças imutável e com trilha de auditoria: nada é apagado nem alterado por baixo — a correção fica visível no histórico (a cobrança antiga como Estornada e a nova no lugar).',
  'Lancei R$ 3.200 mas o fee do mês é R$ 3.500: estorno a de R$ 3.200 com o motivo "valor corrigido" e lanço de novo com o valor certo. O histórico mostra as duas.',
  'Procurar um botão "Editar" para trocar o valor: ele não existe de propósito — a correção certa e rastreável é estornar e relançar.',
  12)
) AS v(chave, grupo, rotulo, o, p, e, x, ordem)
ON CONFLICT (chave) DO NOTHING;
