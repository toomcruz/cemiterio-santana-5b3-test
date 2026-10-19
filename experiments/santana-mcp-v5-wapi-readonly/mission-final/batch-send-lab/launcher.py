"""Runs in the EXISTING fixture LAB service, on the SAME loopback port."""
import sys,time
from pathlib import Path
HERE=Path(__file__).resolve().parent
BASE=HERE.parent
sys.path[:0]=[str(HERE),str(BASE)]
import server
from batch_send import Actor,BatchController,FixtureDirectory,SimulatedOfficialChannel,Blocked
from real_review import RealReview,OWNER,OPERATOR
from mcp_extension import install
if server.DATA_SOURCE!='fixture' or server.SEND_ENABLED or server.SEND_MODE!='disabled':
    raise SystemExit('LAB_FIXTURE_DISABLED_SEND_REQUIRED')
directory=FixtureDirectory();channel=SimulatedOfficialChannel()
controller=BatchController(server.AUDIT,directory,channel,lambda a:False)
review=RealReview(controller);controller.verify_session=review.session_active;controller.review_guard=review.require_batch
def actor(identity,token):
    if identity[0]!='chatgpt':return None
    return Actor(OWNER,'chatgpt-lab',OPERATOR,'existing-private-lab-client','lab_client',time.time()+60,time.time())
Handler=install(server,controller,actor,'https://chatgpt.com',real_review=review)
from http.server import ThreadingHTTPServer
if __name__=='__main__':
    from runtime_guard import acquire_runtime_lock
    _runtime_lock_fd=acquire_runtime_lock(server.AUDIT)
    httpd=ThreadingHTTPServer(('127.0.0.1',server.PORT),Handler)
    httpd.serve_forever()
