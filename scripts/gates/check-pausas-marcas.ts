/**
 * Gate de build (#256 · Frioeste SST): na Conferência de pausas a responsável diz o que cada horário é (Saída, Retorno ou
 * Ignorar) e o sistema refaz os pares do dia. Mesma regra de fn_nr36_reler_dia (banco).
 *   tsx scripts/check-pausas-marcas.ts
 */
import { marcasDasPausas, parearMarcas, validarMarcas, normalizarHora, type Marca } from '../../src/lib/ponto/pausasMarcas'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

// caso real (Frioeste, 22/09): o relatório trouxe 13:30–15:02, 15:32–18:42, 19:05–20:17, 20:39–aberta
const arquivo = marcasDasPausas([
  { inicio_local: '13:30', fim_local: '15:02' }, { inicio_local: '15:32', fim_local: '18:42' },
  { inicio_local: '19:05', fim_local: '20:17' }, { inicio_local: '20:39', fim_local: null },
])
ok(arquivo.map(m => `${m.hora}:${m.papel}`).join(' ') === '13:30:saida 15:02:retorno 15:32:saida 18:42:retorno 19:05:saida 20:17:retorno 20:39:saida',
  'marcações do arquivo: início = Saída, fim = Retorno, em ordem')
const lidoComoVeio = parearMarcas(arquivo)
ok(lidoComoVeio.filter(p => p.situacao === 'fechada').map(p => p.minutos).join(',') === '92,190,72', 'lido como veio: pares de 92, 190 e 72 min (o erro do chamado)')

// a responsável diz: 13:30 é um RETORNO (a saída não foi batida) → todos os papéis seguintes se invertem
const inverter = (m: Marca[]) => m.map(x => ({ ...x, papel: x.papel === 'saida' ? 'retorno' : 'saida' } as Marca))
const relido = parearMarcas(inverter(arquivo))
ok(relido[0].situacao === 'sem_saida' && relido[0].fim === '13:30' && relido[0].inicio === null, '13:30 vira retorno sem saída — a saída não é inventada (RD-38)')
ok(relido.filter(p => p.situacao === 'fechada').map(p => `${p.inicio}-${p.fim}=${p.minutos}`).join(' ') === '15:02-15:32=30 18:42-19:05=23 20:17-20:39=22',
  'pausas reais: 15:02→15:32 (30), 18:42→19:05 (23), 20:17→20:39 (22)')

// e acrescenta a saída que faltou (13:08, digitada)
const comSaida = parearMarcas([{ hora: '13:08', papel: 'saida', origem: 'manual' }, ...inverter(arquivo)])
ok(comSaida[0].situacao === 'fechada' && comSaida[0].minutos === 22 && comSaida.every(p => p.situacao === 'fechada'), 'com a saída digitada (13:08) o dia fecha: 4 pausas')

// Ignorar (entrada do turno / almoço) e saída sem retorno
const ign = parearMarcas([{ hora: '07:25', papel: 'ignorar', origem: 'arquivo' }, { hora: '09:07', papel: 'saida', origem: 'arquivo' },
  { hora: '09:31', papel: 'retorno', origem: 'arquivo' }, { hora: '11:02', papel: 'saida', origem: 'arquivo' }, { hora: '13:54', papel: 'saida', origem: 'arquivo' },
  { hora: '14:13', papel: 'retorno', origem: 'arquivo' }])
ok(ign.length === 3 && ign[0].minutos === 24, 'Ignorar tira o horário do pareamento (entrada do turno)')
ok(ign[1].situacao === 'sem_retorno' && ign[1].inicio === '11:02', 'Saída seguida de Saída: a primeira fica sem retorno (volta à Conferência)')
ok(ign[2].minutos === 19, 'o par seguinte segue normal (13:54→14:13 = 19 min)')

// linha já relida sem saída volta como Retorno no editor
ok(marcasDasPausas([{ inicio_local: '13:30', fim_local: null, sem_saida: true }])[0].papel === 'retorno', 'linha sem saída reabre no editor como Retorno')

// validação
ok(validarMarcas([{ hora: '13:30', papel: 'saida', origem: 'arquivo' }, { hora: '13:30', papel: 'retorno', origem: 'manual' }]) !== null, 'horário repetido é recusado')
ok(validarMarcas([{ hora: '13:30', papel: 'ignorar', origem: 'arquivo' }]) !== null, 'só Ignorar é recusado')
ok(validarMarcas(arquivo) === null, 'marcações do arquivo são válidas')
ok(normalizarHora('9:05') === '09:05' && normalizarHora('24:00') === null && normalizarHora('13h') === null, 'horário digitado: 9:05 → 09:05; inválido recusado')

if (falhas) { console.error(`\n[check-pausas-marcas] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-pausas-marcas] releitura saída/retorno conferida.')
