-- NFS-e "sem tributos aproximados do IBPT" (spec 26/11 · Code: rodrigo-manual) — ajuda RD-95 do botão novo
-- "Atualizar agora" no cartão de Tributos aproximados (IBPT) em Configurações › Fiscal.
-- Metadado de ajuda — NÃO toca dado de cliente, função, RLS nem regra fiscal/financeira. Aditiva e idempotente.
-- Faixa de segundos :30 (rodrigo-manual), acima da última versão da main.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Configuração Fiscal', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem,
       '/dashboard/configuracoes/fiscal', 'fiscal', 'publicado'
FROM (VALUES
 ('fiscal.config.ibpt_atualizar_agora', 'Atualizar agora (tributos do IBPT)',
  'Nada a preencher — é uma ação. Toque para reconsultar o IBPT com o token já salvo e recarregar os tributos aproximados (sem precisar remover/recolocar o token).',
  'Os tributos aproximados (Lei 12.741) têm validade e vencem de tempos em tempos. Quando vencem, a emissão de NFS-e do regime normal trava (o Ambiente Nacional exige o valor). Esta ação baixa a versão vigente para o produto e o serviço da empresa e regrava o cache, destravando a emissão.',
  'Mensagem "tabela do IBPT não tem os tributos deste serviço (venceu em DD/MM)" na emissão → toque em Atualizar agora e emita de novo.',
  'Achar que "Trocar" é obrigatório para atualizar: não é — o Atualizar agora usa o token que já está salvo. Token ausente: aí sim cadastre o token primeiro.', 1)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
ON CONFLICT (chave) DO UPDATE SET grupo = EXCLUDED.grupo, rotulo = EXCLUDED.rotulo,
  o_que_preencher = EXCLUDED.o_que_preencher, para_que_serve = EXCLUDED.para_que_serve,
  exemplo = EXCLUDED.exemplo, erro_comum = EXCLUDED.erro_comum,
  ordem = EXCLUDED.ordem, rota = EXCLUDED.rota, vertical = EXCLUDED.vertical, status = EXCLUDED.status;
