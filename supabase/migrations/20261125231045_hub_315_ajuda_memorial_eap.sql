-- Hub §315 (Orçamento por EAP) · RD-95: "?" dos campos Memorial descritivo e Especificação técnica
-- por item da EAP. Prepara a ajuda que a PR de front do memorial vai referenciar (chaves
-- projetos.orcamento_eap.item_memorial / item_especificacao). Par da migration base 20261125230045.
--
-- ADITIVO e IDEMPOTENTE: só INSERT em erp_ajuda_campo com ON CONFLICT (chave) DO NOTHING.
-- Mesmo padrão (rota/grupo/vertical) das demais chaves projetos.orcamento_eap.*.
-- RD-38: as 2 chaves NÃO existem hoje em erp_ajuda_campo (verificado em produção, somente leitura).
-- Code: desenvolvedor_4_g

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('projetos.orcamento_eap.item_memorial',
   '/dashboard/projetos/obras/[id]/orcamento',
   'Orçamento por EAP',
   'Memorial descritivo',
   'Descreva O QUE será executado neste serviço e COMO: etapas, sequência e cuidados de execução. Texto livre, em linguagem de obra.',
   'Fecha o escopo do serviço para quem vai executar e medir, evitando divergência entre orçado e executado.',
   'Assentamento de porcelanato 60×60 em piso interno: regularização do contrapiso, aplicação de argamassa AC-III, juntas de 2 mm e rejunte epóxi.',
   'Deixar o memorial vazio ou genérico demais ("conforme projeto"): na medição ninguém sabe o que estava incluído.',
   'projetos', 175),
  ('projetos.orcamento_eap.item_especificacao',
   '/dashboard/projetos/obras/[id]/orcamento',
   'Orçamento por EAP',
   'Especificação técnica',
   'Informe MATERIAL, marca/modelo de referência, norma técnica e acabamento esperado do serviço.',
   'Garante que a compra e a execução usem o material certo e que a obra atenda à norma; base para a cotação depois.',
   'Porcelanato acetinado 60×60, PEI-4, retificado, ref. linha comercial equivalente; rejunte epóxi cinza-platina; norma ABNT NBR 13818.',
   'Misturar especificação com memorial, ou citar só "de primeira linha" sem norma nem referência verificável.',
   'projetos', 176)
ON CONFLICT (chave) DO NOTHING;
