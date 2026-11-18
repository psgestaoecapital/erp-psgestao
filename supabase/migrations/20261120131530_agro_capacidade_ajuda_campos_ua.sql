-- RD-95 · #5660: os campos UA/ha e UA total do modal "Capacidade ideal" (CapacidadeIdealModal, usado em
-- /dashboard/agro/pasto e /dashboard/agro/rebanho) passaram a aceitar vírgula (type=text inputMode=decimal) e
-- ganharam o "?" (AjudaCampo). Como `chave` é única (índice erp_ajuda_campo_chave_key) e o modal é compartilhado,
-- o componente passa rota fixa ("/dashboard/agro/pasto") ao AjudaCampo — a ajuda é a mesma venha de qual tela vier.
-- Esta migration cadastra as 2 chaves sob essa rota canônica.
--
-- Aditivo (RD-55): só INSERT em catálogo de ajuda (erp_ajuda_campo), sem DDL, RLS, função ou dado de cliente.
-- IDEMPOTENTE: ON CONFLICT (chave) DO NOTHING — rodar 2x não duplica nem sobrescreve texto já publicado.
-- Reverter: DELETE FROM public.erp_ajuda_campo WHERE chave IN ('agro.capacidade.ua_ha','agro.capacidade.ua_total');

INSERT INTO public.erp_ajuda_campo (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem)
VALUES
  ('agro.capacidade.ua_ha', '/dashboard/agro/pasto', 'Agro', 'UA/ha',
   'Quantas Unidades Animais (UA) o pasto comporta por hectare. Digite com vírgula se precisar (ex.: 2,0). Você informa UA/ha OU UA total — o outro é calculado pela área.',
   'Define a lotação ideal do piquete: multiplicado pela área (ha) dá a capacidade total em UA que o pasto suporta sem degradar.',
   '2,0 UA/ha num piquete de 10 ha → capacidade de 20 UA.',
   'Confundir UA/ha (por hectare) com o total; usar ponto achando que a vírgula não entra (agora entra).',
   'agro', 1),
  ('agro.capacidade.ua_total', '/dashboard/agro/pasto', 'Agro', 'UA total',
   'A capacidade total do piquete em Unidades Animais (UA). Aceita vírgula. Informe este OU o UA/ha — o sistema calcula o par pela área.',
   'É a quantidade de UA que cabe no piquete inteiro; serve para comparar com o rebanho alocado e sinalizar super/sublotação.',
   '20 UA num piquete de 10 ha equivale a 2,0 UA/ha.',
   'Preencher os dois campos com valores que não batem com a área; deixar em branco os dois (nada é calculado).',
   'agro', 2)
ON CONFLICT (chave) DO NOTHING;
