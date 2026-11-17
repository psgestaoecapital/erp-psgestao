-- RD-95: "?" (AjudaCampo) do bloco "Últimos turnos registrados" do Apontamento de Produção — Bovinos.
-- Aditivo e idempotente (ON CONFLICT na chave única). Só texto de ajuda (tabela de referência global),
-- sem dado de cliente, sem RLS/permissão. Chave consumida por src/app/dashboard/industrial/apontamento/page.tsx.
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, vertical, ordem, versao, status)
VALUES
  ('industria.apontamento.ultimos_turnos',
   '/dashboard/industrial/apontamento',
   NULL,
   'Últimos turnos registrados',
   'Nada a preencher aqui: esta é a lista dos turnos já apontados desta empresa, do mais recente para o mais antigo.',
   'Serve para você conferir o que foi salvo (kg produzido e custo por kg de cada turno) e corrigir um turno — clique em "Corrigir" para carregá-lo no formulário acima e registrar de novo, substituindo os números do mesmo dia/turno/unidade.',
   'Turno A de 13/11 na Planta Matriz com 12.300 kg e R$ 4,8700/kg; se o custo estiver errado, clique em Corrigir, ajuste e registre.',
   'Registrar um novo turno quando a intenção era corrigir um já lançado — use sempre "Corrigir" para o mesmo dia/turno/unidade, senão o cálculo do dia pode ficar duplicado.',
   NULL,
   0,
   1,
   'publicado')
ON CONFLICT (chave) DO NOTHING;
