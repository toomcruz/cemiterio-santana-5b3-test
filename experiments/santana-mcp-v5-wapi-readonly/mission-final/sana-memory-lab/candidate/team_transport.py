"""Adapter for a pre-authorized Team API client, NEVER a Local Scripts bearer.

Authentication is owned by the existing signed-in member client. This adapter
creates no account, session, token, service or HTTP listener. Scope is synthetic
Sana LAB only. start returns a task, NOT a message receipt in the real contract.
"""
from dataclasses import dataclass
import hashlib
import re
from session_router import ProviderReceipt, IsolationGuard

ID = re.compile(r'^[A-Za-z0-9_-]{1,128}$')

@dataclass(frozen=True)
class Observation:
    operation_key: str
    task_id: str
    thread_id: str
    delivery_id: str
    message_id: str
    state: str
    answer: str | None

class TeamTaskTransport:
    lab_only = True
    offline = False
    def __init__(self, member_client, agent_id):
        if (getattr(member_client, 'auth_kind', None) != 'team_member'
            or getattr(member_client, 'authenticated', False) is not True
            or 'agent-tasks-v1' not in getattr(member_client,'capabilities',())
            or agent_id not in getattr(member_client,'allowed_lab_agent_ids',())
            or not isinstance(getattr(member_client,'member_id',None),str)
            or not ID.fullmatch(member_client.member_id)):
            raise IsolationGuard('Authorized Team member with agent-tasks-v1 and LAB agent scope required')
        if not ID.fullmatch(agent_id):raise IsolationGuard('Invalid LAB agent')
        self.client, self.agent_id = member_client, agent_id

    def _call(self, operation, agent_id, **body):
        if agent_id != self.agent_id:raise IsolationGuard('Agent scope mismatch')
        # A signed-in client must enforce its own session expiry/revocation on every call.
        return self.client.request('POST','/v1/agent-tasks/'+operation,{'agentId':agent_id,**body})

    def start_task(self, agent_id, text, client_message_id):
        task=self._call('start',agent_id,text=text,clientMessageId=client_message_id)
        if not isinstance(task,dict) or task.get('agentId')!=agent_id:
            raise IsolationGuard('Task agent mismatch')
        task_id,thread_id=task.get('id'),task.get('threadId')
        if not all(isinstance(x,str) and ID.fullmatch(x) for x in (task_id,thread_id)):
            raise IsolationGuard('Task identifiers missing')
        # The start response has no messageId or deliveries. Do not fabricate IDs.
        return task_id,thread_id,ProviderReceipt(None,None)

    def send_task(self,agent_id,task_id,text,client_message_id):
        if not ID.fullmatch(task_id):raise IsolationGuard('Invalid task ID')
        receipt=self._call('send',agent_id,taskId=task_id,text=text,clientMessageId=client_message_id)
        if not isinstance(receipt,dict):raise IsolationGuard('Invalid receipt')
        ds=receipt.get('deliveries')
        if not isinstance(ds,list) or len(ds)!=1 or ds[0].get('recipientAgentId')!=agent_id:
            raise IsolationGuard('Receipt scope mismatch')
        m,d=receipt.get('messageId'),ds[0].get('id')
        if not all(isinstance(x,str) and ID.fullmatch(x) for x in (m,d)):
            raise IsolationGuard('Receipt identifiers missing')
        return ProviderReceipt(m,d)

    def close_task(self,agent_id,task_id):
        snapshot=self._call('list',agent_id)
        if snapshot.get('agentId')!=agent_id:raise IsolationGuard('Task list scope mismatch')
        task=next((t for t in snapshot.get('tasks',[]) if t.get('id')==task_id),None)
        if not task or task.get('agentId')!=agent_id or task.get('state') not in ('idle','closed') or task.get('activeTurnId') or task.get('queuedMessages'):
            raise IsolationGuard('Cannot close active or unconfirmed task')
        if task['state']!='closed':self._call('close',agent_id,taskId=task_id)

    def read_operation(self,agent_id,task_id,thread_id,operation_key,payload_hash,delivery_id=None,first_turn=False):
        snapshot=self._call('read',agent_id,taskId=task_id)
        listing=self._call('list',agent_id)
        if listing.get('agentId')!=agent_id:raise IsolationGuard('Task list mismatch')
        task=next((t for t in listing.get('tasks',[]) if t.get('id')==task_id),None)
        return correlate_snapshot(snapshot,task,agent_id,task_id,thread_id,operation_key,payload_hash,delivery_id,first_turn,self.client.member_id)


def correlate_snapshot(snapshot,task,agent_id,task_id,thread_id,operation_key,payload_hash,delivery_id,first_turn,member_id):
    """Frozen v7 task snapshot: exact thread, member, delivery and turn.

    Only a newly acknowledged task's sole first input may acquire its delivery
    from the snapshot. A later send with a lost receipt is NEVER matched by text.
    """
    if not isinstance(snapshot,dict) or snapshot.get('agentId')!=agent_id or snapshot.get('threadId')!=thread_id:
        raise IsolationGuard('Task conversation mismatch')
    if not isinstance(task,dict) or (task.get('agentId'),task.get('id'),task.get('threadId'))!=(agent_id,task_id,thread_id):
        raise IsolationGuard('Task metadata mismatch')
    messages=snapshot.get('messages')
    if not isinstance(messages,list) or len(messages)>1000:raise IsolationGuard('Incomplete or invalid snapshot')
    inputs=[m for m in messages if isinstance(m,dict) and m.get('author') in ('user','agent')]
    if not delivery_id:
        if not first_turn or len(inputs)!=1:raise IsolationGuard('Missing authoritative delivery association; never guess by text')
        user=inputs[0]
    else:
        matches=[m for m in inputs if isinstance(m.get('delivery'),dict) and m['delivery'].get('id')==delivery_id]
        if len(matches)!=1:raise IsolationGuard('Exact delivery is not visible')
        user=matches[0]
    text=user.get('text')
    sender=user.get('senderMember')
    delivery=user.get('delivery')
    if (user.get('author')!='user' or not isinstance(sender,dict) or sender.get('id')!=member_id
        or not isinstance(text,str) or hashlib.sha256(text.encode()).hexdigest()!=payload_hash
        or not isinstance(delivery,dict)):
        raise IsolationGuard('Input origin or payload mismatch')
    ids=(user.get('id'),delivery.get('id'),user.get('turnId'))
    if not all(isinstance(x,str) and ID.fullmatch(x) for x in ids):raise IsolationGuard('Input/turn identifiers missing')
    if delivery_id and delivery['id']!=delivery_id:raise IsolationGuard('Delivery conflict')
    if inputs[-1] is not user:raise IsolationGuard('Concurrent external input; human reconciliation required')
    if snapshot.get('activeTurnId') or task.get('activeTurnId') or task.get('queuedMessages') or task.get('state') not in ('idle','closed'):
        return Observation(operation_key,task_id,thread_id,delivery['id'],user['id'],'running',None)
    if task.get('outcome') in ('failed','interrupted'):
        return Observation(operation_key,task_id,thread_id,delivery['id'],user['id'],'failed',None)
    terminal=[m for m in messages if isinstance(m,dict) and m.get('author')=='assistant' and m.get('turnId')==user['turnId'] and m.get('status')=='completed' and m.get('itemType') not in ('commentary','question_prompt','plan','routine_quiet_answer') and isinstance(m.get('text'),str) and m['text'].strip()]
    answer=terminal[-1]['text'] if terminal and task.get('outcome')=='completed' else None
    return Observation(operation_key,task_id,thread_id,delivery['id'],user['id'],'completed' if task.get('outcome')=='completed' else 'running',answer)
