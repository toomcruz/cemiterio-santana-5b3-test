"""Pure interpretation of the official, authenticated Local Scripts delivery read.

The caller obtains the run exclusively through the configured Boss/routine query.
No latest-message fallback, no dispatch, no retry and no secret handling here.
"""
import re

ID = re.compile(r'^[A-Za-z0-9_-]{1,128}$')

def official_delivery_result(run, delivery, max_chars=12000):
    base = {'run_id': run['run_id'], 'status': run['status'],
            'result_available': False, 'result': None, 'error': run.get('error'),
            'source': 'openbot_local_scripts_delivery', 'truncated': False}
    expected = run.get('delivery_id')
    if not isinstance(expected, str) or not ID.fullmatch(expected):
        return {**base, 'reason': 'DELIVERY_ID_MISSING'}
    if not isinstance(delivery, dict) or delivery.get('id') != expected:
        return {**base, 'reason': 'DELIVERY_ID_CONFLICT'}
    turn = delivery.get('turnId')
    if run.get('turn_id') and turn != run['turn_id']:
        return {**base, 'reason': 'TURN_ID_CONFLICT'}
    if run['status'] != 'succeeded' or delivery.get('status') != 'completed':
        return {**base, 'reason': 'TERMINAL_COMPLETION_NOT_CONFIRMED'}
    answer = delivery.get('answer')
    if not isinstance(turn, str) or not ID.fullmatch(turn):
        return {**base, 'reason': 'TURN_ID_MISSING'}
    if not isinstance(answer, str) or not answer.strip():
        return {**base, 'reason': 'RESULT_MISSING'}
    answer = answer.strip()
    return {**base, 'result_available': True, 'result': answer[:max_chars],
            'turn_id': turn, 'delivery_id': expected, 'truncated': len(answer)>max_chars}

def official_agent_delivery_result(delivery_ids, read_one, max_chars=65536):
    answers=[];states=[]
    for expected in delivery_ids:
        payload=read_one(expected)
        if not isinstance(payload,dict) or payload.get('id')!=expected:
            raise ValueError('Delivery identity conflict')
        status=payload.get('status');states.append(status)
        if status=='completed' and isinstance(payload.get('turnId'),str) and ID.fullmatch(payload['turnId']):
            text=payload.get('answer')
            if isinstance(text,str) and text.strip():answers.append(text.strip())
    failures=any(s in ('failed','interrupted','cancelled') for s in states)
    complete=bool(states) and all(s=='completed' for s in states) and len(answers)==len(states)
    output='\n\n'.join(answers) if complete else ''
    return {'state':'failed' if failures else ('succeeded' if complete else ('result_missing' if states and all(s=='completed' for s in states) else 'running')),
            'result_available':bool(output),'result':output[:max_chars] or None,
            'truncated':len(output)>max_chars,'error':'DELIVERY_FAILED' if failures else None,
            'source':'openbot_local_scripts_delivery'}
