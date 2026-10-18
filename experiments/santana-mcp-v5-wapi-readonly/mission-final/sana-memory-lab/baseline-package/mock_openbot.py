"""Deterministic in-memory substitute for the OpenBot agent-tasks-v1 contract.

Does not connect to anything. Tests prove routing and isolation, not LLM behavior.
"""
from __future__ import annotations
from uuid import uuid4
from session_router import ProviderReceipt

class FakeOpenBotTasks:
    lab_only = True
    def __init__(self) -> None:
        self.tasks: dict[str, dict] = {}
        self.closed: set[str] = set()
        self.attempts: list[tuple[str,str,str]] = []
        self.raise_on_send = False

    def start_task(self, agent_id: str, text: str, client_message_id: str):
        task_id = f"task-{uuid4().hex}"
        thread_id = f"thread-{uuid4().hex}"
        self.tasks[task_id] = {"agent_id":agent_id, "thread_id":thread_id,"texts":[text]}
        self.attempts.append(("start",task_id,client_message_id))
        return task_id, thread_id, ProviderReceipt(f"msg-{uuid4().hex}",f"dlv-{uuid4().hex}")

    def send_task(self, agent_id: str, task_id: str, text: str, client_message_id: str):
        if self.raise_on_send:
            raise TimeoutError("simulated unknown provider outcome")
        assert task_id in self.tasks and task_id not in self.closed
        assert self.tasks[task_id]["agent_id"] == agent_id
        self.tasks[task_id]["texts"].append(text)
        self.attempts.append(("send",task_id,client_message_id))
        return ProviderReceipt(f"msg-{uuid4().hex}",f"dlv-{uuid4().hex}")

    def close_task(self, agent_id: str, task_id: str):
        assert self.tasks[task_id]["agent_id"] == agent_id
        self.closed.add(task_id)
