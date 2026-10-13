// Gate (chamado #587 · Frioeste · CEO 02/10): batida ajustada como CAMADA à parte; batida ORIGINAL imutável (Portaria
// 671/2021); Ciência assinada nunca é regerada (nova versão guarda a anterior); releitura com retorno sem saída só
// grava dizendo, de propósito, que não se sabe o horário. Roda no build, sem rede.
import { readFileSync } from 'node:fs'
import { parearMarcas, type Marca } from '../../src/lib/ponto/pausasMarcas'
import { linhaPausaDoc, pendenciasDaPrevia, rotuloAjuste, notaDiaDoc, type AjusteDia } from '../../src/lib/ponto/ajusteBatida'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// 1) o caso do chamado (Leonel, 15/09): originais 07:30 (retorno sem saída), 09:10–09:31, 13:42–14:00
const orig: Marca[] = [
  { hora: '07:30', papel: 'retorno', origem: 'arquivo' }, { hora: '09:10', papel: 'saida', origem: 'arquivo' },
  { hora: '09:31', papel: 'retorno', origem: 'arquivo' }, { hora: '13:42', papel: 'saida', origem: 'arquivo' },
  { hora: '14:00', papel: 'retorno', origem: 'arquivo' }]
ok(JSON.stringify(pendenciasDaPrevia(parearMarcas(orig))) === '[{"tipo":"sem_saida","hora":"07:30"}]', 'sem o horário da catraca, a prévia aponta: falta a saída do retorno das 07:30')
const comCatraca: Marca[] = [...orig, { hora: '07:10', papel: 'saida', origem: 'manual', origem_ajuste: 'catraca' }]
ok(pendenciasDaPrevia(parearMarcas(comCatraca)).length === 0, 'com a saída digitada (catraca), não sobra pendência')

// 2) documento: retorno sem saída não sai invertido; ajustado mostra original × ajustado, origem, quem e quando
const semSaida = linhaPausaDoc({ de: '09:04', ate: null, sem_saida: true })
ok(semSaida.texto.includes('09:04 (retorno)') && !semSaida.texto.includes('sem registro de saída'), 'retorno sem saída: "saída não registrada → 09:04 (retorno)"')
const aj: AjusteDia = { originais: ['07:30', '09:10', '09:31', '13:42', '14:00'], desconsideradas: [], relido: true,
  ajustes: [{ hora: '07:10', papel: 'saida', origem: 'catraca', por: 'segurancadotrabalho', em: '2026-10-02T17:53:31Z' }] }
const ajustada = linhaPausaDoc({ de: '07:10', ate: '07:30', min: 20 }, aj)
ok(ajustada.texto === '07:10 → 07:30', 'pausa ajustada: 07:10 → 07:30')
ok(ajustada.notas.some(n => n === 'saída 07:10 ajustada · catraca · por segurancadotrabalho em 02/10'), 'nota: saída ajustada · catraca · por quem em dd/mm')
ok(ajustada.notas.some(n => n === 'original do relógio: 07:30'), 'nota: o original do relógio aparece junto')
ok(rotuloAjuste({ hora: '08:00', papel: 'retorno', origem: 'conferido_colaborador' }) === 'ajustada · conferido com o colaborador', 'origem "conferido com o colaborador"')
ok((notaDiaDoc(aj) || '').startsWith('Batidas originais do relógio: 07:30, 09:10, 09:31, 13:42, 14:00'), 'o dia ajustado lista as batidas originais')

// 3) banco
const mig = readFileSync('supabase/migrations/20261002253000_nr36_587_ajuste_batida_camada.sql', 'utf8')
ok(/CREATE TABLE IF NOT EXISTS public\.nr36_batida_ajuste/.test(mig) && /origem\s+text NOT NULL CHECK \(origem IN \('catraca', 'conferido_colaborador'\)\)/.test(mig), 'camada de ajuste com origem (catraca | conferido com o colaborador)')
ok(/REVOKE ALL ON public\.nr36_batida_ajuste FROM PUBLIC, anon, authenticated/.test(mig) && !/GRANT (INSERT|UPDATE|DELETE)[^;]*nr36_batida_ajuste/.test(mig), 'ajuste só é gravado pela releitura justificada (cliente só lê)')
ok(/#587 original imutavel/.test(mig) && /marca_original_alterada/.test(mig) && /fn__nr36_batidas_originais/.test(mig), 'marca "do relatório" tem de ser batida original do dia')
ok(/REVOKE ALL ON FUNCTION public\.fn_nr36_reler_dia\(uuid, text, date, jsonb\) FROM PUBLIC, anon, authenticated/.test(mig), 'releitura direta (sem justificativa e sem camada) fechada para a sessão')
ok(!/\b(UPDATE|DELETE FROM)\s+public\.(ind_ponto_pausa|nr36_pausa_historico)\b/.test(mig), 'a migration não altera pausa nem histórico (batida original intacta)')
ok(/falta_horario/.test(mig) && /p_pendencia_ciente boolean DEFAULT false/.test(mig), 'retorno sem saída só grava com "não sei o horário" explícito')
ok(/origem_ajuste_obrigatoria/.test(mig), 'horário digitado exige a origem')
ok(/status NOT IN \('assinado', 'recusado'\)/.test(mig), 'Ciência assinada/recusada nunca é sobrescrita')
ok(/INSERT INTO public\.nr36_ciencia_versao[\s\S]*UPDATE public\.nr36_ciencia_mensal SET\s+status = 'pendente'/.test(mig), 'nova versão guarda a anterior inteira antes de reabrir')
ok(/desatualizado_em = now\(\)/.test(mig) && /fn_nr36_ciencia_gerar\(p_company_id, p_data, p_cpf\)/.test(mig), 'ajuste: regera a não assinada; marca a assinada como desatualizada')
ok(/'ajustados'/.test(mig) && /fn__nr36_ajustes_dia\(r\.company_id, r\.cpf, r\.data\)/.test(mig), 'Auditoria mantém o dia ajustado na lista, com a camada de ajuste')
ok(/#587 sem_saida/.test(mig), 'apuração marca o retorno sem saída no detalhe')

// 4) telas
const tela = readFileSync('src/app/dashboard/compliance/pausas-tecnicas/page.tsx', 'utf8')
const sign = readFileSync('src/app/sign/nr36/[token]/page.tsx', 'utf8')
ok(/data-testid="marca-nova-origem"/.test(tela) && /De onde veio\?/.test(tela), 'editor: horário digitado pede a origem')
ok(/data-testid="marcas-pendencia-ciente"/.test(tela) && /p_pendencia_ciente/.test(tela) && /bloqueadoPend/.test(tela), 'editor: não salva retorno sem saída sem "não sei o horário"')
ok(/data-testid="auditoria-ajustados"/.test(tela), 'Auditoria lista os dias ajustados')
ok(/fn_nr36_ciencia_nova_versao/.test(tela), 'Ciência: nova versão para documento assinado')
ok(/linhaPausaDoc/.test(tela) && /linhaPausaDoc/.test(sign), 'tela e página de assinatura usam a mesma leitura do documento')
ok(!/sem registro de saída/.test(tela) && !/sem registro de saída/.test(sign), 'nenhuma das duas imprime mais "sem registro de saída" (invertido)')

if (falhas) { console.error(`\n${falhas} falha(s) na camada de ajuste (#587)`); process.exit(1) }
console.log('\nCamada de ajuste de batida (#587): ok')
