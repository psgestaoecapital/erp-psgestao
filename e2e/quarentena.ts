// Quarentena de specs de aceitação @pos-migration da main (CEO 10/10).
//
// Problema: um spec da main que falha de forma instável ou por motivo SEM RELAÇÃO com a PR daquele head segura a fila
// (nenhuma PR com migration publica enquanto o @pos da main está vermelho). A quarentena tira esse spec da EXECUÇÃO
// — datado, com motivo e com tarefa ao Code dono — para a fila voltar, sem mascarar regressão de verdade.
//
// Travas (as duas valem SEMPRE, decididas pelo CEO):
//  1) "SEM RELAÇÃO com a PR": só entra em quarentena se, no run em que COMEÇOU a falhar (o 1º vermelho da sequência),
//     a PR daquele head NÃO tocou a ÁREA do spec (área derivada do nome do arquivo × arquivos da PR). Tocou → é
//     regressão da PR: NÃO quarentena, segura a fila (corrige/reverte a culpada).
//  2) "CRÍTICOS nunca entram": áreas de risco alto SEMPRE seguram a fila, mesmo sem relação com a PR — um @pos
//     vermelho nelas é trabalho AGORA, nunca se esconde.
//
// O detector (scripts/merge/quarentena-detectar.ts) decide e inclui/remove por commit no ramo da main; o Playwright
// lê `specsEmQuarentena()` em `testIgnore` para não rodar o spec (o ARQUIVO continua no repo — nunca se apaga).
// Sai da quarentena sozinho quando o spec volta a passar. Gate: scripts/gates/check-quarentena.ts.
//
// VALIDADE OBRIGATÓRIA (Item 4, CEO 20/11) — a dívida NÃO vira permanente: toda entrada tem um `ate` ('YYYY-MM-DD').
// Enquanto hoje <= ate a quarentena VALE (o portão @pos não congela por causa dela). Depois do `ate`, a entrada está
// VENCIDA: o portão da main (passo "Registrar status da main" do aceitacao-pos-migration.yml) VOLTA A FICAR VERMELHO
// por causa dela — forçando o Code dono a consertar o spec e remover a entrada, ou renovar o `ate` por nova PR
// (humano-only, revisável). A decisão é computada por `decidirVerde(...)` abaixo — reusada pelo workflow E pelo gate.
// Quarentena NÃO é esconder bug: a entrada vigente segue como chamado/alerta aberto (erp_quarentena_spec) e o banner
// da esteira mostra "verde (N em quarentena)" para ninguém esquecer que há dívida aberta.

// Áreas que NUNCA entram em quarentena (substring, minúsculas) — financeiro, fiscal, permissões/RLS/guarda, NR-36,
// LGPD, Wealth/CVM. Um spec cujo caminho/nome casa com qualquer uma destas sempre segura a fila.
export const QUARENTENA_CRITICOS = [
  'financeiro', 'fiscal', 'nfse', 'nfe', 'nf-e', 'imposto', 'tribut',
  'permiss', 'rls', 'guarda', 'rbac', 'acesso',
  'nr-36', 'nr36', 'lgpd', 'wealth', 'cvm',
] as const

export type SpecQuarentenado = {
  spec: string              // caminho a partir da raiz: e2e/jornadas/aceitacao/<arquivo>.spec.ts
  area: string              // área derivada do nome do spec (para a tarefa e a auditoria)
  motivo: string            // por que entrou (resumo do erro) — linguagem de quem vai consertar
  desde: string             // ISO 8601 de quando entrou
  ate: string               // 'YYYY-MM-DD' validade: enquanto hoje <= ate a quarentena VALE (desconta no portão); depois re-congela
  runs: [number, number]    // os 2 runs @pos consecutivos da main que falharam
  code: string              // Code dono da área (recebe a tarefa de consertar)
}

// Lista VIVA — vazia por padrão. O detector inclui entradas entre os marcadores abaixo (edição segura por texto);
// a remoção é feita pela PR do Code dono que conserta o spec. Nunca apaga o arquivo do spec, só o tira da execução.
export const QUARENTENA: SpecQuarentenado[] = [
  /* quarentena:inicio */
  {
    spec: 'e2e/jornadas/aceitacao/pdois-solicitar-contrato-59.spec.ts',
    area: 'contratos',
    motivo: '@pos-migration da main VERMELHO 4x consecutivos (runs 43979564093, 43981754020, 43986690667, 43996371532) em pdois-solicitar-contrato-59.spec.ts:100 [celular]: após clicar "solicitar-contrato", o testid "solicitacao-criada" não aparece (timeout 20s, element not found). RD-38 PROVADO: na commit 24341000 (conserto-main #5276) a árvore de PRODUÇÃO é BYTE-IDÊNTICA à última VERDE 694ae18 (git diff 694ae184..24341000 = só arquivos de teste; SolicitarContratoModal.tsx restaurado ao verde) e MESMO ASSIM o spec falha — logo NÃO é regressão de código (nada a reverter; re-reverter é inútil). O teste-irmão (RPC como usuário, mesma migration) PASSA e deploy-migrations está VERDE. Causa = ambiente/dado da DEMO Agência OU fragilidade [celular] do submit da tela (validação/seleção do cliente inline no viewport mobile). NÃO-CRÍTICO (contratos; fora de financeiro/fiscal/RLS/NR-36/LGPD/Wealth). Quarentena MANUAL do guardião (a automática recusou por "área tocada pela PR do 1º vermelho", mas a PR culpada #5263/#5271 já foi revertida ao verde). Dono jordana-code: reproduzir o submit [celular] na DEMO, achar o campo/validação que bloqueia (ou corrigir a PREPARAÇÃO do teste, sem tocar nos expects) e só então remover esta entrada.',
    desde: '2026-11-17T02:20:00Z',
    runs: [43986690667, 43996371532], // 2 últimos @pos consecutivos da main vermelhos neste spec (há 4 na sequência)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'jordana-code',
  },
  {
    spec: 'e2e/jornadas/aceitacao/prod-custos-posto-f3.spec.ts',
    area: 'custos-posto',
    motivo: 'Re-quarentena por ordem do Eng. Chefe (contexto 11d3ec7a): @pos-migration da main vermelho em prod-custos-posto-f3.spec.ts:46 — o posto criado pelo teste NÃO aparece como botão na lista de /dashboard/produtividade/custos-posto. A #4681 (dev7) tirou da quarentena sem o spec passar de fato, travando a publicação de ~41 PRs. SEM RELAÇÃO com as PRs de migration da fila; NÃO-CRÍTICO (custo industrial — não é financeiro/fiscal/RLS/NR-36/LGPD/Wealth). Dono: consertar o fluxo criar-posto → aparecer na lista (ou a fragilidade do teste) e só então remover esta entrada.',
    desde: '2026-11-11T21:15:00Z',
    runs: [0, 0], // re-quarentena manual (Eng. Chefe destrava a esteira; @pos da main vermelho em custos-posto-f3:46)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'desenvolvedor_4_g',
  },
  {
    spec: 'e2e/jornadas/aceitacao/agency-origens-semente.spec.ts',
    area: 'agency-origens',
    motivo: 'asserção da linha 31 falha no banco de testes novo (DEMO da agência sem algum dado da semente); trava o teste da main e ~32 PRs. Conserto: Eng. Chefe msg 8787bb9d, ação 2',
    desde: '2026-10-11T09:00:00Z',
    runs: [0, 0], // run da aceitacao-main 01:09 e o seguinte (CEO destrava manual, 11/10)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/agente-caixa-mensagens.spec.ts',
    area: 'agentes-caixa',
    motivo: 'QUARENTENA TEMPORÁRIA seed-gap banco de testes — restaurar após semear (semente-demo). Eng. Chefe msg 00149d0d, ação 2',
    desde: '2026-10-11T13:00:00Z',
    runs: [0, 0], // aceitacao-main/@pos 11/10 12:23 (run 38137150574) e anterior — CEO destrava manual
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/agente-despertador.spec.ts',
    area: 'agentes-despertador',
    motivo: 'QUARENTENA TEMPORÁRIA seed-gap banco de testes — restaurar após semear (semente-demo). Eng. Chefe msg 00149d0d, ação 2',
    desde: '2026-10-11T13:00:00Z',
    runs: [0, 0], // aceitacao-main/@pos 11/10 12:23 (run 38137150574) e anterior — CEO destrava manual
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/agente-encerrar-despertador5.spec.ts',
    area: 'agentes-despertador',
    motivo: 'QUARENTENA TEMPORÁRIA seed-gap banco de testes — restaurar após semear (semente-demo). Eng. Chefe msg 00149d0d, ação 2',
    desde: '2026-10-11T13:00:00Z',
    runs: [0, 0], // aceitacao-main/@pos 11/10 12:23 (run 38137150574) e anterior — CEO destrava manual
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/agente-lease.spec.ts',
    area: 'agentes-lease',
    motivo: 'QUARENTENA TEMPORÁRIA seed-gap banco de testes — restaurar após semear (semente-demo). Eng. Chefe msg 00149d0d, ação 2',
    desde: '2026-10-11T13:00:00Z',
    runs: [0, 0], // aceitacao-main/@pos 11/10 12:23 (run 38137150574) e anterior — CEO destrava manual
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/caminho-atendimento-fila.spec.ts',
    area: 'atendimento-fila',
    motivo: 'QUARENTENA TEMPORÁRIA seed-gap banco de testes — restaurar após semear (semente-demo). Eng. Chefe msg 00149d0d, ação 2',
    desde: '2026-10-11T13:00:00Z',
    runs: [0, 0], // aceitacao-main/@pos 11/10 12:23 (run 38137150574) e anterior — CEO destrava manual
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/caminho-clonar-produto.spec.ts',
    area: 'clonar-produto',
    motivo: 'QUARENTENA TEMPORÁRIA seed-gap banco de testes — restaurar após semear (semente-demo). Eng. Chefe msg 00149d0d, ação 2',
    desde: '2026-10-11T13:00:00Z',
    runs: [0, 0], // aceitacao-main/@pos 11/10 12:23 (run 38137150574) e anterior — CEO destrava manual
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/caminho-clonar-servico.spec.ts',
    area: 'clonar-servico',
    motivo: 'QUARENTENA TEMPORÁRIA seed-gap banco de testes — restaurar após semear (semente-demo). Eng. Chefe msg 00149d0d, ação 2',
    desde: '2026-10-11T13:00:00Z',
    runs: [0, 0], // aceitacao-main/@pos 11/10 12:23 (run 38137150574) e anterior — CEO destrava manual
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/caminho-conexoes-bancarias.spec.ts',
    area: 'caminho-conexoes',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/caminho-oficina-os-impressao.spec.ts',
    area: 'caminho-oficina',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/coletor-antigo-fora-do-ar.spec.ts',
    area: 'coletor-antigo',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/fila-rascunho-precisa-de-mim.spec.ts',
    area: 'fila-rascunho',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/gean-cnpj-duplicado-editar-130.spec.ts',
    area: 'gean-cnpj',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/hidratacao-empresa-sel.spec.ts',
    area: 'hidratacao-empresa',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/ibpt-empresa-token.spec.ts',
    area: 'ibpt-empresa',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/kgf-devolucao-compra-obs-94.spec.ts',
    area: 'kgf-devolucao',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/kgf-os-impressao-cnpj-foto-89-80.spec.ts',
    area: 'kgf-os',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/plano-contas-relatorio-arvore.spec.ts',
    area: 'plano-contas',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/plano-contas-relatorio-kpi.spec.ts',
    area: 'plano-contas',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/pm-selos-margem.spec.ts',
    area: 'pm-selos',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/produtividade-cadastro-editavel.spec.ts',
    area: 'produtividade-cadastro',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/revenda-foto-upload.spec.ts',
    area: 'revenda-foto',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/revenda-vistoria-rapida-foto-reparo.spec.ts',
    area: 'revenda-vistoria',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/sicredi-erro-claro-88.spec.ts',
    area: 'sicredi-erro',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/tryo-anexos-264-266.spec.ts',
    area: 'tryo-anexos',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/xml-compra-lote.spec.ts',
    area: 'xml-compra',
    motivo: 'falha em todas as PRs: a DEMO das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T20:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-desenv',
  },
  {
    spec: 'e2e/jornadas/aceitacao/kgf-quantidade-fracionada-102.spec.ts',
    area: 'kgf-quantidade',
    motivo: 'falha igual em todas as PRs (#2563, #2839, #2827): a DEMO Oficina das vagas não é a DEMO da produção (18/10) — não é regressão de PR. Quarentena temporária autorizada pelo CEO 18/10; vira P1 ao Code dono',
    desde: '2026-10-18T22:30:00Z',
    runs: [0, 0], // falha em todas as PRs de 18/10 (ambiente das vagas)
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-esteira',
  },
  {
    spec: 'e2e/jornadas/aceitacao/caminho-oficina-diagnostico.spec.ts',
    area: 'caminho-oficina-diagnostico',
    motivo: 'falha de ambiente em 4 PRs diferentes (#2114, #2856, #2118, #2845) — DEMO das vagas ≠ produção; não crítico',
    desde: '2026-10-19T10:00:00Z',
    runs: [0, 0], // falha de ambiente nas vagas (não é regressão de PR), 19/10
    ate: '2026-12-05', // backfill Item 4 (CEO 20/11): janela de graça uniforme p/ NÃO congelar no merge; depois re-congela e força conserto+remoção ou renovação do ate
    code: 'gilberto-esteira',
  },
  /* quarentena:fim */
]

export function specsEmQuarentena(): string[] {
  return QUARENTENA.map((q) => q.spec)
}

// ── Validade (Item 4) ──────────────────────────────────────────────────────────────────────────────────────────
// `hojeISO` é a data do dia ('YYYY-MM-DD'); comparar strings ISO de data é equivalente a comparar as datas.
export function hojeIso(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10)
}

// Vigente = ainda dentro da validade (hoje <= ate). A entrada sem `ate` (não deve existir: o tipo exige) é tratada
// como VENCIDA (viés de segurança: na dúvida, re-congela — nunca esconde dívida sem prazo).
export function quarentenaVigente(q: SpecQuarentenado, hoje: string = hojeIso()): boolean {
  return typeof q.ate === 'string' && q.ate.length >= 10 && hoje <= q.ate
}

export function quarentenasVigentes(hoje: string = hojeIso()): SpecQuarentenado[] {
  return QUARENTENA.filter((q) => quarentenaVigente(q, hoje))
}

// Entradas VENCIDAS (ate < hoje, ou sem ate válido): cada uma re-congela o portão até o dono consertar/renovar.
export function quarentenasVencidas(hoje: string = hojeIso()): SpecQuarentenado[] {
  return QUARENTENA.filter((q) => !quarentenaVigente(q, hoje))
}

// DECISÃO DO PORTÃO (reusada pelo workflow e pelo gate — RD-26). Dado se a suíte @pos passou (os specs quarentenados
// NÃO rodam, via testIgnore; logo suíte vermelha = um spec NÃO quarentenado falhou) e a data de hoje, decide o verde:
//   verde = suíte verde E nenhuma quarentena VENCIDA.
// Critérios do Item 4 que isto garante:
//   1) spec na lista (vigente) falhando/ausente + resto verde → suíte verde, sem vencidas → VERDE (fila publica).
//   2) spec FORA da lista falhando → suíte vermelha → VERMELHO (congela, como hoje).
//   4) quarentena VENCIDA → VERMELHO (a dívida não vira permanente), mesmo com a suíte verde.
// `motivo` nomeia o 1º culpado para o banner/portão (o spec vencido, quando o vermelho vem da validade).
export function decidirVerde(
  suiteVerde: boolean,
  hoje: string = hojeIso(),
): { verde: boolean; n_vigentes: number; vencidas: string[]; motivo: string } {
  const vencidas = quarentenasVencidas(hoje).map((q) => q.spec)
  const n_vigentes = quarentenasVigentes(hoje).length
  if (!suiteVerde) {
    return { verde: false, n_vigentes, vencidas, motivo: 'suíte @pos vermelha (spec não quarentenado falhou)' }
  }
  if (vencidas.length) {
    return { verde: false, n_vigentes, vencidas, motivo: `quarentena vencida (re-congela): ${vencidas.join(', ')}` }
  }
  return { verde: true, n_vigentes, vencidas, motivo: n_vigentes ? `verde (${n_vigentes} em quarentena)` : 'verde' }
}

// Área do spec: tokens do nome do arquivo (sem .spec.ts), em minúsculas, só os com 3+ letras. Ex.:
// "mao-obra-componentes" → ['mao','obra','componentes']; "cliente-cnpj-duplicado-guarda" → ['cliente','cnpj',...].
export function tokensDoSpec(spec: string): string[] {
  const base = (spec.split('/').pop() ?? spec).replace(/\.spec\.ts$/, '').toLowerCase()
  return base.split(/[^a-z0-9]+/).filter((t) => t.length >= 3)
}

// Área "curta" para exibir (os 1–2 primeiros tokens).
export function areaDoSpec(spec: string): string {
  return tokensDoSpec(spec).slice(0, 2).join('-') || 'desconhecida'
}

// Crítico? (substring do caminho/nome contra a lista) — crítico SEMPRE segura a fila, nunca entra em quarentena.
export function ehCritico(spec: string): boolean {
  const s = spec.toLowerCase()
  return QUARENTENA_CRITICOS.some((c) => s.includes(c))
}

// Relação PR × área: a PR do 1º vermelho tocou a área do spec? Comparação GENEROSA (viés de segurança: na dúvida,
// "tocou" → NÃO quarentena → segura a fila). Casa se algum arquivo da PR contém algum token da área do spec.
export function prTocaAreaDoSpec(arquivosDaPr: string[], spec: string): boolean {
  const toks = tokensDoSpec(spec)
  const arq = arquivosDaPr.map((f) => f.toLowerCase())
  return arq.some((f) => toks.some((t) => f.includes(t)))
}

// Decisão final: pode pôr este spec em quarentena? (precisa: não-crítico E a PR do 1º vermelho não tocou a área).
export function podeQuarentenar(spec: string, arquivosDaPrPrimeiroVermelho: string[]): { ok: boolean; motivo: string } {
  if (ehCritico(spec)) return { ok: false, motivo: 'área crítica (financeiro/fiscal/permissões-RLS-guarda/NR-36/LGPD/Wealth) — sempre segura a fila' }
  if (prTocaAreaDoSpec(arquivosDaPrPrimeiroVermelho, spec)) return { ok: false, motivo: 'a PR do 1º vermelho tocou a área do spec — é regressão da PR, não quarentena' }
  return { ok: true, motivo: 'sem relação com a PR do 1º vermelho e não-crítico' }
}
