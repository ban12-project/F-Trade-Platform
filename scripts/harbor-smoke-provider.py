#!/usr/bin/env python3
"""Loopback-only synthetic provider for disposable Harbor integration trials."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        # Both smoke cases contain images: require the real SDK to transmit image content.
        has_image = any(
            isinstance(message.get("content"), list)
            and any(part.get("type") == "image_url" for part in message["content"])
            for message in body.get("messages", [])
        )
        valid = (self.path == "/v1/chat/completions" and body.get("model") == "synthetic"
                 and self.headers.get("Authorization") == "Bearer synthetic" and has_image)
        if not valid:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'{"error":{"message":"Synthetic provider request contract failed"}}')
            return
        candidate = json.loads(Path("/app/input/smoke-response.json").read_text())
        response = {"id": "synthetic", "object": "chat.completion", "created": 0,
                    "model": "synthetic", "choices": [{"index": 0, "finish_reason": "stop",
                    "message": {"role": "assistant", "content": json.dumps(candidate)}}],
                    "usage": {"prompt_tokens": 11, "completion_tokens": 12, "total_tokens": 23}}
        encoded = json.dumps(response).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8787), Handler).serve_forever()
