// Gate (chamado #76 · Frioeste · CEO 03/10): cada desvio mostra o motivo pela régua da empresa, com o número que decide
// (minutos:segundos). Limite inferior vazio = vale a própria pausa (como hoje). Roda no build, sem rede.
import { readFileSync } from 'node:fs'
import { reguaDe, mmss, motivoRegua, textoRegua } from '../../src/lib/ponto/reguaPausa'
import { frasesPausasCurtas, frasesExcesso } from '../../src/lib/ponto/supervisaoFrases'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// régua da Frioeste: pausa 20, excesso a partir de 24, limite inferior não definido
const r = reguaDe({ pausa_min: 20, tolerancia_excesso_min: 24 })
ok(mmss(1196) === '19:56' && mmss(1440) === '24:00', 'segundos em minutos:segundos')
ok(motivoRegua({ seg: 1196, classe: 'pausa_insuficiente' }, r) === 'abaixo do mínimo: 19:56 < 20:00', 'caso real 01/09 14:40–15:00 (1196 s): abaixo do mínimo: 19:56 < 20:00')
ok(motivoRegua({ seg: 1440, classe: 'pausa_excesso' }, r) === 'acima do máximo: 24:00 ≥ 24:00', 'excesso: acima do máximo: 24:00 ≥ 24:00')
ok(motivoRegua({ seg: 1439, classe: 'pausa_normal' }, r) === null, 'pausa normal não tem motivo de desvio')
ok(textoRegua(r) === 'Régua da empresa: pausa de 20 min · normal de 20:00 a 23:59 · excesso a partir de 24:00 · abaixo de 20:00 é desvio (limite inferior ainda não definido pela empresa: vale a própria pausa, sem tolerância)', 'régua em uma linha, dizendo que o limite inferior não foi definido')
ok(motivoRegua({ seg: 1185, classe: 'pausa_insuficiente' }, reguaDe({ pausa_min: 20, tolerancia_excesso_min: 24, limite_inferior_min: 19.5 })) === 'abaixo do mínimo: 19:45 < 19:30', 'limite inferior definido entra no motivo')

const pausas = [{ de: '14:40', ate: '15:00', min: 20, seg: 1196, classe: 'pausa_insuficiente' }, { de: '07:13', ate: '07:37', min: 24, seg: 1440, classe: 'pausa_excesso' }]
ok(frasesPausasCurtas({ tipo: 'pausa_insuficiente', quantidade: 1 }, pausas, 20, r)[0] === 'pausa das 14:40 às 15:00 — abaixo do mínimo: 19:56 < 20:00', 'Supervisão: a pausa "de 20 min" que é desvio agora diz por quê')
ok(frasesExcesso(pausas, r)[0] === 'pausa das 07:13 às 07:37 — acima do máximo: 24:00 ≥ 24:00 (gestão, não é infração)', 'Supervisão: excesso com a régua')
ok(frasesPausasCurtas({ tipo: 'pausa_insuficiente', quantidade: 1 }, pausas, 20)[0] === 'pausa das 14:40 às 15:00: 20 min — o mínimo é 20 min', 'sem a régua, o texto de antes (compatível)')

const mig = readFileSync('supabase/migrations/20261004090000_nr36_76_regua_motivo.sql', 'utf8')
ok(/FUNCTION public\.fn_nr36_pausas_regua[\s\S]*STABLE/.test(mig) && /fn_nr36_duracao_seg/.test(mig), 'régua + segundos: função só de leitura, mesma duração da apuração')
ok(/#76 limite inferior/.test(mig) && /fn_nr36_classificar_eventos/.test(mig) && /fn_nr36_apurar/.test(mig), 'limite inferior nas DUAS leituras (classificação e apuração)')
ok(/COALESCE\(\(v_par->>''limite_inferior_min''\)::numeric, v_pmin\)/.test(mig) && /COALESCE\(\(v_param->>''limite_inferior_min''\)::numeric, v_pausa_min\)/.test(mig), 'vazio = a própria pausa (resultado idêntico ao de hoje)')
ok(!/\b(INSERT INTO|DELETE FROM)\b|\bUPDATE public\./.test(mig), 'a migration não grava dado')

const tela = readFileSync('src/app/dashboard/compliance/pausas-tecnicas/page.tsx', 'utf8')
ok(/data-testid="sup-regua"/.test(tela) && /frasesChao\(d, regua, segMap\)/.test(tela), 'Supervisão mostra a régua e o motivo de cada desvio')
ok(/data-testid="rel-regua"/.test(tela) && /rotuloDesvio\(dv, c\.cpf, d\.data\)/.test(tela), 'relatório de Auditoria com a régua e o motivo')
ok(/data-testid="regua-limite-inferior"/.test(tela) && /data-testid="regua-excesso"/.test(tela), 'Configuração: excesso e limite inferior editáveis')

if (falhas) { console.error(`\n${falhas} falha(s) na régua (#76)`); process.exit(1) }
console.log('\nMotivo do desvio pela régua (#76): ok')
