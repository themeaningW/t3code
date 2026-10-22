"""JSON-lines control channel for a notebook's persistent Jupyter kernel."""
import copy
import json
import os
import queue
import signal
import sys
import threading
import uuid

from jupyter_client import KernelManager
from jupyter_client.kernelspec import KernelSpecManager

lock = threading.RLock()
write_lock = threading.Lock()
lifecycle_lock = threading.RLock()
manager = None
client = None
waiters = []
interrupted = threading.Event()
specs = KernelSpecManager().get_all_specs()
state = dict(status="idle", kernelName="python3", kernelId=None, activeCell=None,
             runId=None, results=[], error=None, warning=None, persisted=False,
             kernels=[dict(name=n, displayName=v["spec"]["display_name"])
                      for n, v in specs.items() if v["spec"].get("language", "").lower() == "python"])


def reply(request_id, result=None, error=None):
    with write_lock:
        print(json.dumps(dict(id=request_id, result=result, error=error), ensure_ascii=True), flush=True)


def snapshot():
    with lock:
        return copy.deepcopy(state)


def shutdown():
    global manager, client
    with lifecycle_lock:
        if manager is not None:
            try:
                manager.shutdown_kernel(now=True)
            finally:
                manager = None
        if client is not None:
            client.stop_channels()
            client = None

def force_interrupt(run_id):
    # Native extensions may ignore SIGINT. Terminate only this owned kernel after a grace period.
    with lock:
        if state["status"] != "running" or state["runId"] != run_id:
            return
        state["warning"] = "The kernel did not respond to Stop and was shut down. Variables were cleared."
        state["kernelId"] = None
    shutdown()


def execute(cells, kernel_name):
    global manager, client
    try:
        with lifecycle_lock:
            if manager is None:
                if kernel_name not in specs or specs[kernel_name]["spec"].get("language", "").lower() != "python":
                    raise ValueError("Select an available Python kernel.")
                manager = KernelManager(kernel_name=kernel_name)
                options = dict(cwd=os.getcwd(), stdout=sys.stderr, stderr=sys.stderr)
                if os.name == "nt":
                    options["creationflags"] = 0x08000000
                manager.start_kernel(**options)
                client = manager.client()
                client.start_channels()
                client.wait_for_ready(timeout=45)
                setup_id = client.execute("%matplotlib inline", silent=True, store_history=False)
                while True:
                    setup = client.get_iopub_msg(timeout=45)
                    if setup.get("parent_header", {}).get("msg_id") == setup_id and setup["msg_type"] == "status" and setup["content"]["execution_state"] == "idle":
                        break
                with lock:
                    state["kernelId"] = str(uuid.uuid4())
        budget = 512_000
        for cell in cells:
            if interrupted.is_set():
                raise RuntimeError("Execution interrupted.")
            with lock:
                state["activeCell"] = cell["cellIndex"]
                result = dict(cellIndex=cell["cellIndex"], executionCount=None, outputs=[])
                state["results"].append(result)
            message_id = client.execute(cell["code"], allow_stdin=False, stop_on_error=True)
            while True:
                try:
                    message = client.get_iopub_msg(timeout=1)
                except queue.Empty:
                    if interrupted.is_set():
                        manager.interrupt_kernel()
                    if not manager.is_alive():
                        raise RuntimeError("The Python kernel stopped unexpectedly.")
                    continue
                if message.get("parent_header", {}).get("msg_id") != message_id:
                    continue
                kind, content = message["msg_type"], message["content"]
                output = None
                if kind == "status" and content["execution_state"] == "idle":
                    break
                if kind == "execute_input":
                    if interrupted.is_set():
                        manager.interrupt_kernel()
                    with lock:
                        result["executionCount"] = content["execution_count"]
                elif kind == "clear_output":
                    with lock:
                        result["outputs"].clear()
                elif kind == "stream":
                    output = dict(output_type="stream", name=content["name"], text=content["text"])
                elif kind in ("display_data", "execute_result"):
                    output = dict(output_type=kind, data=content["data"], metadata=content.get("metadata", {}))
                    if kind == "execute_result":
                        output["execution_count"] = content["execution_count"]
                elif kind == "error":
                    output = dict(output_type="error", ename=content["ename"], evalue=content["evalue"], traceback=content["traceback"])
                if output is not None:
                    encoded_size = len(json.dumps(output).encode())
                    with lock:
                        if encoded_size <= budget and len(result["outputs"]) < 100:
                            result["outputs"].append(output)
                            budget -= encoded_size
                        else:
                            state["warning"] = "Output limit reached. Some results were omitted."
                if kind == "error":
                    with lock:
                        state["error"] = content["ename"] + ": " + content["evalue"]
            if state["error"]:
                break
        with lock:
            if interrupted.is_set() and not state["error"]:
                state["error"] = "Execution interrupted."
            state["status"] = "error" if state["error"] else "completed"
    except Exception as exc:
        with lock:
            state["status"] = "error"
            state["error"] = str(exc)
    finally:
        with lock:
            state["activeCell"] = None
            pending = list(waiters)
            waiters.clear()
            finished = snapshot()
        for request_id in pending:
            reply(request_id, finished)


def dispatch(request):
    action = request["action"]
    if action == "status":
        return snapshot()
    if action == "wait":
        with lock:
            if state["status"] == "running":
                waiters.append(request["id"])
                return None
        return snapshot()
    if action == "interrupt":
        interrupted.set()
        timer = threading.Timer(3, force_interrupt, args=(state["runId"],))
        timer.daemon = True
        timer.start()
        if manager is not None:
            manager.interrupt_kernel()
        return snapshot()
    if action == "restart":
        if state["status"] == "running":
            raise ValueError("The notebook is busy. Stop it before restarting.")
        shutdown()
        with lock:
            state.update(status="idle", kernelId=None, results=[], runId=None, error=None, warning=None)
        return snapshot()
    if action == "execute":
        with lock:
            if state["status"] == "running":
                raise ValueError("The notebook is already running.")
            kernel_name = request.get("kernelName", "python3")
            if manager is not None and kernel_name != state["kernelName"]:
                raise ValueError("Restart the kernel before changing Python environments.")
            interrupted.clear()
            state.update(status="running", kernelName=kernel_name, activeCell=None,
                         runId=str(uuid.uuid4()), results=[], error=None, warning=None)
            initial = snapshot()
        threading.Thread(target=execute, args=(request["cells"], kernel_name), daemon=True).start()
        return initial
    raise ValueError("Unknown notebook action.")


def terminate(signum, frame):
    raise SystemExit(0)


signal.signal(signal.SIGTERM, terminate)
try:
    for line in sys.stdin:
        request_id = None
        try:
            request = json.loads(line)
            request_id = request["id"]
            result = dispatch(request)
            if result is not None:
                reply(request_id, result)
        except Exception as exc:
            reply(request_id, error=str(exc))
finally:
    shutdown()
