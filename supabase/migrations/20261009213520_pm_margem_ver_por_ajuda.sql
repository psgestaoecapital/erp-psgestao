-- P&M · Margem por Job: "Ver margem por" job, cliente, serviço ou fee (onda 1 da P&M da Pdois, mapeamento do SIGA,
-- Parte S). "?" dos 2 controles novos (RD-95). Aditiva (só texto de ajuda novo; sem dado de cliente).
INSERT INTO public.erp_ajuda_campo (chave, grupo, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem, rota, vertical, status)
SELECT v.chave, v.grupo, v.rotulo, v.o_que, v.para_que, v.exemplo, v.erro, v.ordem, v.rota, 'pm', 'publicado'
FROM (VALUES
 ('pm.margem.ver_por', 'Margem', 'Ver margem por', 'Toque em Job, Cliente, Serviço ou Fee para ver a mesma margem somada desse jeito.', 'Mostra onde a agência ganha e onde perde: cada grupo soma valor, custo das horas e lucro dos jobs dele.', 'Cliente: todos os jobs da Padaria Sol somados numa linha só, com a margem do cliente.', 'Achar que Fee mostra o valor mensal do contrato: aqui entram só os jobs ligados ao fee; job sem fee aparece em "Fora de fee (avulso)".', 10, '/dashboard/pm/margem-job'),
 ('pm.margem.grupo', 'Margem', 'Margem do grupo', 'Nada a preencher: é o lucro do grupo dividido pelo valor dos jobs dele.', 'Compara clientes, serviços e fees pela mesma régua: verde a partir de 50%, amarelo a partir de 25%, vermelho abaixo.', 'Valor R$ 10.000, custo R$ 6.000 → lucro R$ 4.000 → margem 40% (amarelo).', 'Esquecer os jobs "sem custo": eles não entram no lucro do grupo até alguém apontar as horas ou informar o custo estimado.', 11, '/dashboard/pm/margem-job')
) AS v(chave, grupo, rotulo, o_que, para_que, exemplo, erro, ordem, rota)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'erp_ajuda_campo')
ON CONFLICT (chave) DO NOTHING;
