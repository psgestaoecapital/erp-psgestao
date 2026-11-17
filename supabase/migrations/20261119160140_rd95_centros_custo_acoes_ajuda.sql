-- PDCA GE · /dashboard/gestao-empresarial/centros-custo (Resultado por negócio) · auditor_pdca_2 17/11
-- RD-95: as AÇÕES da tabela de regras de rateio não tinham "?": o botão "+ Gravar regra" e os
--   botões de linha (Editar/Tirar/Salvar/Cancelar). Esta migration cadastra as 2 chaves de ajuda;
--   a tela passa a mostrar o "?" nesses pontos.
-- Aditiva e idempotente (ON CONFLICT DO NOTHING). Não toca dado de cliente, não mexe em RLS.

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
(
  'cc.regra_gravar', '/dashboard/gestao-empresarial/centros-custo', 'Resultado por negócio', '+ Gravar regra',
  'Depois de escolher Tipo, Chave, Negócio e %, clique para gravar a regra.',
  'Cria a regra de rateio: de agora em diante, toda despesa que casar com a chave (conta ou palavra) é distribuída para o negócio escolhido na porcentagem definida. As somas por chave devem fechar 100% (o que faltar vai para o rateio pela receita).',
  'Tipo "palavra", chave "energia", Negócio "Loja 1", 100% → toda despesa com "energia" vira custo da Loja 1.',
  'Gravar duas regras para a mesma chave somando mais de 100% — o excedente é ignorado; mantenha o total em 100%.',
  'gestao_empresarial', 50, 1, 'publicado'
),
(
  'cc.regra_acoes', '/dashboard/gestao-empresarial/centros-custo', 'Resultado por negócio', 'Ações da regra',
  'Nada a preencher: use "Editar" para mudar o negócio/percentual da regra e "Tirar" para removê-la do cálculo.',
  'Editar reabre a linha para ajustar negócio e %. Tirar faz a baixa rastreável (a regra sai do rateio mas o histórico fica para auditoria) — não apaga de vez.',
  'Mudou a divisão entre lojas? Clique em Editar, ajuste o % e Salvar. Regra que não vale mais? Clique em Tirar.',
  'Achar que "Tirar" apaga o histórico — não apaga; é um soft-delete rastreável e reversível pela equipe.',
  'gestao_empresarial', 51, 1, 'publicado'
)
ON CONFLICT (chave) DO NOTHING;
