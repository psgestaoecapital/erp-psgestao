-- #5722 (jordana-manual) · Devolução de compra NF-e: grupo de transporte (transportador/veículo/volumes).
-- Só a ajuda RD-95 ("?") dos campos novos — a lógica é aditiva no código (builder + rota devolução + tela),
-- sem alterar o comportamento de quem não preencher. INSERTs idempotentes. Aditiva; não toca dado de cliente.
-- conserto-main (code-desenvolvedor-3, 25/11): status='ativo' violava erp_ajuda_campo_status_check
-- (só 'rascunho'/'publicado') — mesmo defeito do #9929; corrigido para 'publicado' e vertical 'fiscal'
-- (a irmã existente de nfe_devolucao no banco é fiscal/publicado). Desbloqueia o deploy-migrations.

INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
SELECT v.chave, '/dashboard/fiscal/nfe/devolucao', 'Devolução de compra', v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, 'fiscal', v.ordem, 1, 'publicado'
FROM (VALUES
  ('fiscal.nfe.devolucao.transporte','Transportador e veículo',
   'Preencha só quando a devolução tem transporte. Em branco, a nota sai sem transportador/veículo (como hoje). A modalidade do frete (quem paga) está no bloco de valores acima.',
   'Leva o transportador, o veículo e os volumes para a NF-e de devolução (grupo de transporte), para o DANFE sair completo.',
   'Transportadora X, CNPJ, placa ABC1D23, UF SC.',
   'Informar CNPJ e CPF ao mesmo tempo (use um só); placa com hífen (use 7 caracteres sem hífen).', 50),
  ('fiscal.nfe.devolucao.transp_nome','Nome / razão social do transportador',
   'Nome ou razão social de quem transporta. Pré-preenchido pela nota de compra quando houver.',
   'Identifica o transportador na NF-e.', 'Transportes Boa Viagem Ltda.',
   'Deixar em branco quando há transporte: informe ao menos nome e documento.', 51),
  ('fiscal.nfe.devolucao.transp_doc','CNPJ ou CPF do transportador',
   'Só números. CNPJ (14 dígitos) OU CPF (11 dígitos) — nunca os dois.',
   'Documento do transportador na NF-e.', '12345678000190.',
   'Misturar CNPJ e CPF, ou informar quantidade de dígitos errada.', 52),
  ('fiscal.nfe.devolucao.transp_ie','Inscrição estadual do transportador',
   'IE do transportador (opcional).', 'Completa os dados do transportador no DANFE.', '123456789.',
   'Informar letras/pontuação — use só o número da IE.', 53),
  ('fiscal.nfe.devolucao.transp_endereco','Endereço do transportador',
   'Logradouro, número, complemento e bairro do transportador (opcional).',
   'Endereço do transportador no DANFE.', 'Rua das Cargas, 100, Centro.', 'Texto muito longo (máx. 60).', 54),
  ('fiscal.nfe.devolucao.transp_municipio','Município do transportador',
   'Município do transportador (opcional).', 'Município do transportador no DANFE.', 'Joinville.', '—', 55),
  ('fiscal.nfe.devolucao.transp_uf','UF do transportador',
   'Sigla do estado do transportador (2 letras).', 'UF do transportador no DANFE.', 'SC.',
   'Informar mais de 2 letras ou número.', 56),
  ('fiscal.nfe.devolucao.veic_placa','Placa do veículo',
   'Placa sem hífen (7 caracteres). Preencha se for informar o veículo.',
   'Veículo que faz o transporte, no DANFE.', 'ABC1D23.',
   'Placa com hífen ou com menos/mais de 7 caracteres.', 57),
  ('fiscal.nfe.devolucao.veic_uf','UF da placa',
   'UF de emplacamento (2 letras).', 'Completa o grupo do veículo.', 'SC.', 'Mais de 2 letras.', 58),
  ('fiscal.nfe.devolucao.veic_rntc','RNTC do veículo',
   'Registro Nacional de Transportador de Carga (ANTT), quando houver.', 'Dado do veículo no DANFE.', '12345.', '—', 59),
  ('fiscal.nfe.devolucao.vol_qtd','Quantidade de volumes',
   'Número de volumes transportados (opcional). Pré-preenchido da nota de compra quando houver.',
   'Volumes no DANFE.', '2.', 'Informar texto — use só número.', 60),
  ('fiscal.nfe.devolucao.vol_especie','Espécie dos volumes',
   'Tipo do volume (opcional).', 'Espécie no DANFE.', 'Caixa.', '—', 61),
  ('fiscal.nfe.devolucao.vol_peso_bruto','Peso bruto (kg)',
   'Peso bruto total (opcional). Pré-preenchido da nota de compra quando houver.',
   'Peso bruto no DANFE.', '12,500.', 'Usar ponto como separador de milhar.', 62),
  ('fiscal.nfe.devolucao.vol_peso_liquido','Peso líquido (kg)',
   'Peso líquido total (opcional).', 'Peso líquido no DANFE.', '11,800.', '—', 63)
) AS v(chave, rotulo, o_que, para_que, exemplo, erro, ordem)
WHERE NOT EXISTS (SELECT 1 FROM public.erp_ajuda_campo e WHERE e.chave = v.chave);
