-- Hub · Gestão de Obras · aba Subempreiteiros → MEDIÇÕES. Code: desenvolvedor_4_g.
-- RD-95: "?" da nova coluna "A pagar (GE)" da tabela de medições, que mostra o título a pagar gerado no
-- financeiro quando a medição é aprovada (ponte slice 2b parte 2/2). Migration aditiva e idempotente.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('projetos.subempreiteiro.medicao_a_pagar', '/dashboard/projetos/obras/[id]/subempreiteiros', 'Subempreiteiros', 'hub_projetos',
   'A pagar (GE)',
   'Coluna só de leitura: mostra o valor do título a pagar que o sistema gerou no financeiro (Gestão Empresarial) quando esta medição foi aprovada. Não é um campo para preencher.',
   'Confirma que a aprovação da medição virou um pagamento real no financeiro, pelo líquido (bruto menos retenção, INSS e ISS), no centro de custo da obra — fechando o elo medição → a pagar.',
   'Medição aprovada de R$ 40.000 com 5% ret + 11% INSS + 5% ISS mostra R$ 31.600,00 em "A pagar (GE)".',
   'Esperar valor numa medição em rascunho ou cancelada: o título a pagar só nasce quando a medição está aprovada.', 23)
ON CONFLICT (chave) DO NOTHING;
