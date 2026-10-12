#!/usr/bin/env python3
# Observabilidade da esteira (CEO 10/10) — converte as linhas "#<pr> <motivo>" que a fila-merge.sh loga a cada run
# no payload de fn_esteira_pr_estado_gravar. PURO (lê ESTADO_FILE / RUN_URL do ambiente; não toca rede nem GitHub).
# A fila chama via flush_estado() no trap EXIT; o gate check-esteira-observabilidade.ts testa `construir` com fixtures.
#
# Regra: por PR, a ÚLTIMA linha "#<pr> ..." é o motivo final da rodada; `via` e `tem_migration` vêm de QUALQUER linha
# da PR. `estado` é derivado do texto (bate com o log — RD-38), nunca suposto.
import json
import os
import re
import sys


def construir(linhas):
    por_pr = {}
    for ln in linhas:
        m = re.match(r'^#(\d+)', ln)
        if not m:
            continue
        pr = m.group(1)
        d = por_pr.setdefault(pr, {'via': None, 'mig': False, 'linha': ''})
        d['linha'] = ln  # última linha vence = decisão final da rodada
        if 'via rápida' in ln:
            d['via'] = 'rapida'
        elif 'via revisada' in ln:
            d['via'] = 'revisada'
        if 'migration' in ln:
            d['mig'] = True
    estados = []
    for pr, d in por_pr.items():
        ln = d['linha']
        motivo = re.sub(r'^#\d+:?\s*', '', ln).strip()
        if 'MERGEADA' in ln:
            estado = 'mergeada'
        elif 'fora desta rodada' in ln:
            estado = 'fora-da-rodada'
        elif re.search(r'aguardando|espera|atualizada|sem build agora|teto', ln):
            estado = 'esperando'
        elif re.search(r'pulada|nao-publicar|draft', ln):
            estado = 'fora'
        else:
            estado = 'avaliando'
        estados.append({'pr': pr, 'via': d['via'], 'estado': estado, 'motivo': motivo, 'tem_migration': d['mig']})
    estados.sort(key=lambda e: int(e['pr']))
    return estados


def main():
    f = os.environ.get('ESTADO_FILE', '')
    linhas = []
    if f and os.path.exists(f):
        with open(f, encoding='utf-8') as fh:
            linhas = [line.rstrip('\n') for line in fh]
    payload = {'p_run_url': os.environ.get('RUN_URL', ''), 'p_estados': construir(linhas)}
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


if __name__ == '__main__':
    main()
