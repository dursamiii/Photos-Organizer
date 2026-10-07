import json
import sys
import os
from concurrent.futures import ThreadPoolExecutor
from thumbnail import generate_thumbnail


WORKER_COUNT = max(1, (os.cpu_count() or 1) - 1)

executor = ThreadPoolExecutor(
    max_workers=WORKER_COUNT
)


def process_command(command):
    action = command.get("action")

    if action == "ping":
        return {
            "success": True,
            "message": "pong",
        }

    if action == "generate_thumbnail":
        result = generate_thumbnail(
            input_path=command["input"],
            output_path=command["output"],
            max_size=command.get("max_size", 500),
        )

        return {
            "success": True,
            **result,
        }

    return {
        "success": False,
        "error": f"Unknown action: {action}",
    }


def send_response(response):
    print(
        json.dumps(response),
        flush=True,
    )


def handle_result(command_id, future):
    try:
        result = future.result()

        send_response({
            "id": command_id,
            **result,
        })

    except Exception as error:
        send_response({
            "id": command_id,
            "success": False,
            "error": str(error),
        })


for line in sys.stdin:
    line = line.strip()

    if not line:
        continue

    try:
        command = json.loads(line)

        command_id = command.get("id")

        future = executor.submit(
            process_command,
            command,
        )

        future.add_done_callback(
            lambda future, command_id=command_id:
                handle_result(command_id, future)
        )

    except Exception as error:
        send_response({
            "success": False,
            "error": str(error),
        })