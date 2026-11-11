-- Oficina · Apontamento do mecânico (/dashboard/oficina/apontamento) — RD-95 "?" dos campos/indicadores/ações.
-- Code: rodrigo-code. Fecha o gap do PDCA (aud8 run 1935, tela "apontamento" 72/100: RD-95 = 0 AjudaCampo).
-- A tela não tinha nenhum "?": quem executa, serviços aprovados (iniciar/concluir, previsto × real), peças,
-- observação por voz e o total previsto × real no rodapé passam a ter ajuda de campo.
-- Aditiva e idempotente (catálogo global de ajuda, sem company_id, sem RLS por empresa, sem dado de cliente).
-- Prova RD-38:
--   antes: SELECT count(*) FROM public.erp_ajuda_campo
--          WHERE rota = '/dashboard/oficina/apontamento';  => 0
--   depois: => 5  (só inserções novas; ON CONFLICT (chave) DO NOTHING — nada é apagado nem alterado).
INSERT INTO public.erp_ajuda_campo
  (chave, rota, grupo, vertical, rotulo, o_que_preencher, para_que_serve, exemplo, erro_comum, ordem)
VALUES
  ('oficina.apontamento.executor', '/dashboard/oficina/apontamento', 'Apontamento', 'oficina',
   'Quem está executando',
   'Por padrão entra você, que está logado — é no seu nome que o tempo é registrado. Em "Trocar" você escolhe, com um toque, outro mecânico já designado na OS. "Outro (sem cadastro)" é exceção: grava só o nome, sem vínculo com um usuário.',
   'Define de quem é a mão de obra apontada. Com o cadastro ligado, as horas alimentam o tempário e a produtividade daquele mecânico; só com o nome (sem cadastro) o tempo fica avulso.',
   'Dois mecânicos na mesma OS: cada um abre o Apontamento no próprio login (ou é trocado por 1 toque) antes de Iniciar o serviço dele.',
   'Deixar o nome de outra pessoa e bater o ponto: o tempo vai para o nome errado. Confira "Quem está executando" antes de Iniciar.',
   1),
  ('oficina.apontamento.servico', '/dashboard/oficina/apontamento', 'Apontamento', 'oficina',
   'Serviços aprovados (Iniciar / Concluir)',
   'Nada a digitar: toque Iniciar quando começar o serviço e Concluir quando terminar. O relógio marca o tempo sozinho (não há campo de hora no caminho normal). "Reabrir / refazer" volta um serviço já concluído.',
   'Mede o tempo real de cada serviço e compara com o previsto (tempário). O real em vermelho significa que passou do previsto; em verde, dentro do previsto. É assim que a oficina enxerga a margem em horas.',
   'Previsto 1,0h. Você toca Iniciar, trabalha 1h20 e toca Concluir: Real 1,3h aparece em vermelho (estourou o previsto).',
   'Esquecer de tocar Concluir deixa o cronômetro correndo e infla o tempo real. Se esqueceu de bater o ponto, use "ajustar o tempo".',
   2),
  ('oficina.apontamento.observacao', '/dashboard/oficina/apontamento', 'Apontamento', 'oficina',
   'Observação (por voz)',
   'Opcional. Escreva, ou toque no microfone (🎙️) e fale em português — o aparelho transcreve. Conte o que achou do serviço, o que faltou ou algo que o próximo precisa saber.',
   'Fica registrada junto do apontamento concluído. Ajuda a explicar um tempo fora do previsto e serve de histórico para quem reabrir ou revisar a OS.',
   'Ditar: "Parafuso espanado, troquei o coxim; demorou mais por causa da ferrugem."',
   'Falar com o microfone desligado: toque no 🎙️ (fica vermelho ■ quando está gravando) antes de começar.',
   3),
  ('oficina.apontamento.ajuste_tempo', '/dashboard/oficina/apontamento', 'Apontamento', 'oficina',
   'Esqueci de bater o ponto — ajustar o tempo',
   'Exceção. Só abra se esqueceu de iniciar/concluir na hora certa. Informe as horas reais em número (ex.: 1,5 = 1h30). Deixar em branco mantém o tempo do relógio.',
   'Substitui o tempo do cronômetro pelo valor que você digitar, para o apontamento refletir o que de fato levou quando o ponto não foi batido no momento.',
   'Serviço levou 2h30 mas você só lembrou de concluir agora: abra "ajustar o tempo" e digite 2,5.',
   'Digitar minutos como se fossem horas: 1,30 vale 1h18 (é decimal), não 1h30. Para 1h30 use 1,5.',
   4),
  ('oficina.apontamento.total', '/dashboard/oficina/apontamento', 'Apontamento', 'oficina',
   'Total Previsto × Real',
   'Nada a preencher: é a soma dos serviços da OS. "Previsto" soma os tempos de tempário; "Real" soma só os serviços já concluídos.',
   'Mostra, de um olhar, se a OS está dentro do tempo orçado. Real maior que Previsto (em vermelho) sinaliza que a mão de obra passou do planejado — base para rever o tempário ou o orçamento.',
   'Previsto 4,0h e Real 4,5h: a OS estourou 0,5h de mão de obra.',
   'Comparar o Real antes de concluir todos os serviços: ele só conta os já concluídos, então sobe conforme você finaliza cada item.',
   5)
ON CONFLICT (chave) DO NOTHING;
