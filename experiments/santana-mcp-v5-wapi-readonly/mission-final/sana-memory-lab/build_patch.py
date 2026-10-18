"""Build a minimal patch against the audited bridge; no service access."""
from pathlib import Path
import hashlib, shutil
ROOT=Path(__file__).resolve().parent
EXPECTED={'server.py':'f950916b3e396b0d97bbd5014c9d988300f9a33a5634e6282ec0e4d8f5bdebc6','agent_messages.py':'23c6ce2542f729d45f8bbbc157d75760743ef46ee7511f0f9d2f9caedc4bdda7'}
def replace_once(s,old,new):
 if s.count(old)!=1:raise RuntimeError('BASELINE_ANCHOR_MISMATCH')
 return s.replace(old,new,1)

def build():
 dest=ROOT/'bridge-patch';dest.mkdir(exist_ok=True)
 for name,h in EXPECTED.items():
  source=ROOT/'baseline-bridge'/name
  if hashlib.sha256(source.read_bytes()).hexdigest()!=h:raise RuntimeError('BASELINE_HASH_MISMATCH')
  s=source.read_text()
  if name=='server.py':
   s=replace_once(s,'from agent_messages import AgentMessageStore, MAX_MESSAGE_CHARS','from agent_messages import AgentMessageStore, MAX_MESSAGE_CHARS\nfrom result_adapter import official_delivery_result, official_agent_delivery_result')
   s=replace_once(s,'    if not allowed_route:', '''    delivery_route = bool(re.fullmatch(r"/v1/agents/[A-Za-z0-9_-]+/deliveries/[A-Za-z0-9_-]+", suffix))
    allowed_route = allowed_route or delivery_route
    if delivery_route and method != "GET":
        raise ValueError("Delivery reads allow GET only")
    if not allowed_route:''')
   anchor='    if not row["turn_id"] or not row["thread_id"]:'
   s=replace_once(s,anchor,'''    if isinstance(row.get("delivery_id"), str) and re.fullmatch(r"[A-Za-z0-9_-]{1,128}", row["delivery_id"]):
        try:
            delivery = _openbot_request("GET", f"/v1/agents/{BOSS_ID}/deliveries/{row['delivery_id']}")
        except (RuntimeError, OSError, ValueError):
            delivery = None
        if delivery is not None:
            return official_delivery_result(row, delivery, MAX_RESULT_CHARS)
'''+anchor)
   s=replace_once(s,'return {"task_id": row["task_id"], "state": row["state"], "result_available": row["result"] is not None,','return {"task_id": row["task_id"], "run_id": row["run_id"], "delivery_id": row["delivery_id"], "state": row["state"], "result_available": row["result"] is not None,')
   s=replace_once(s,'_agent_messages = AgentMessageStore(EVENT_DB, RUN_DB, _dispatch_agent_message, _authorized_agent, enabled=True)','_agent_messages = AgentMessageStore(EVENT_DB, RUN_DB, _dispatch_agent_message, _authorized_agent, enabled=True, read_delivery=lambda agent_id, delivery_id: _openbot_request("GET", f"/v1/agents/{agent_id}/deliveries/{delivery_id}"))')
  else:
   s=replace_once(s,'from pathlib import Path','from pathlib import Path\nfrom result_adapter import official_agent_delivery_result')
   s=replace_once(s,'def __init__(self, state_path, run_db, send_message, authorized_agent, enabled=False):','def __init__(self, state_path, run_db, send_message, authorized_agent, enabled=False, read_delivery=None):')
   s=replace_once(s,'        self.enabled = bool(enabled)','        self.enabled = bool(enabled)\n        self.read_delivery = read_delivery')
   s=replace_once(s,'    def _read_projection(self, delivery_ids, agent_id):','''    def _read_projection(self, delivery_ids, agent_id):
        if self.read_delivery is not None:
            if not self.authorized_agent(agent_id):
                raise PermissionError("Agent authorization revoked")
            try:
                return official_agent_delivery_result(delivery_ids, lambda delivery_id: self.read_delivery(agent_id, delivery_id), MAX_RESULT_CHARS)
            except (RuntimeError, OSError):
                pass  # old API unavailable; retain the strict, exact projection fallback
''')
  (dest/name).write_text(s)
 for name in ('events.py','task_queue.py'):shutil.copy2(ROOT/'baseline-bridge'/name,dest/name)
 shutil.copy2(ROOT/'candidate/result_adapter.py',dest/'result_adapter.py')

if __name__=='__main__':build()
