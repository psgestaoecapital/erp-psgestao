-- #2861 (Gean) · busca nas telas de Diagnóstico técnico e Aprovação do cliente (igual à da tela de Ordens de Serviço).
-- ADITIVA: só o texto do "?" (RD-95) das duas buscas novas. Sem tabela, função ou dado de cliente.
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, 'Oficina', 'Buscar', v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'oficina', 'publicado'
FROM (VALUES
 ('oficina.diagnostico.busca', '/dashboard/oficina/diagnostico',
  'Parte da placa, do número da OS, do nome do cliente ou do veículo (marca/modelo).',
  'Acha rápido o veículo a diagnosticar quando o pátio tem muitas OS. Só filtra a lista; não muda nada na OS.',
  '"ABC1D23", "0198", "João" ou "Strada".',
  'Digitar a placa com traço ou espaço não atrapalha; para placa, digite pelo menos 3 letras/números.', 1),
 ('oficina.aprovacao.busca', '/dashboard/oficina/aprovacao',
  'Parte da placa, do número da OS, do nome do cliente ou do veículo (marca/modelo).',
  'Acha rápido o laudo a orçar/aprovar quando há muitas OS esperando. Só filtra a lista; não muda nada na OS.',
  '"ABC1D23", "0198", "Maria" ou "Hilux".',
  'Digitar a placa com traço ou espaço não atrapalha; para placa, digite pelo menos 3 letras/números.', 1)
) AS v(chave, rota, o_que, para_que, exemplo, erro, ordem)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
