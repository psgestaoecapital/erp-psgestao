-- RD-95: "?" dos campos de seleção da sub-tela Vínculos do Plano de Contas (PDCA aud8 94->95).
-- As chaves plano_contas_vinc.{busca,massa_gerencial,vincular} já existem; faltava a da SELEÇÃO
-- (caixas "selecionar todas" e por linha, base das ações em massa). Aditiva/idempotente.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, status)
VALUES
  ('plano_contas_vinc.selecao',
   '/dashboard/cadastros/plano-contas/vinculos',
   'Vincular',
   'Selecionar contas',
   'Marque a caixa de uma ou mais contas contábeis (ou a caixa do cabeçalho para marcar todas as visíveis). Só contas ainda editáveis — ainda não confirmadas — podem ser marcadas.',
   'A seleção define quais contas recebem as ações em massa (Propor, Confirmar ou Descartar a mesma conta gerencial de uma vez), em vez de ajustar linha por linha.',
   'Filtrar por "Pendências", marcar todas, escolher a gerencial "Despesas administrativas" e clicar em Propor para vincular o lote de uma vez.',
   'Esperar incluir uma conta já CONFIRMADA na seleção: ela fica travada (imutável) e é ignorada pela ação em massa.',
   'cadastros', 4, 'publicado')
ON CONFLICT (chave) DO NOTHING;
