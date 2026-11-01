"""Independent AF_PACKET observer inside one owned test network namespace.

Stores endpoint/protocol metadata only. TCP payload and proxy auth headers are
never recorded. Output must remain private because DNS names/IPs can be private.
"""
import ipaddress
import json
import pathlib
import signal
import socket
import struct
import sys


def dns_names(payload):
    if len(payload) < 12 or struct.unpack('!H', payload[4:6])[0] != 1:
        return []
    offset = 12
    labels = []
    while offset < len(payload):
        size = payload[offset]
        offset += 1
        if size == 0:
            return ['.'.join(labels).lower()] if labels and offset + 4 <= len(payload) else []
        if size > 63 or offset + size > len(payload):
            return []
        try:
            label = payload[offset:offset+size].decode('ascii')
        except UnicodeDecodeError:
            return []
        if not all(c.isalnum() or c in '-_' for c in label):
            return []
        labels.append(label)
        offset += size
    return []


def decode(data):
    if len(data) < 14:
        return None
    kind = struct.unpack('!H', data[12:14])[0]
    packet = data[14:]
    if kind == 0x0800 and len(packet) >= 20:
        offset = (packet[0] & 15) * 4
        if packet[0] >> 4 != 4 or not 20 <= offset <= len(packet):
            return {'invalidIp': True}
        proto = packet[9]
        source, target = str(ipaddress.ip_address(packet[12:16])), str(ipaddress.ip_address(packet[16:20]))
        if struct.unpack('!H', packet[6:8])[0] & 0x1fff:
            return {'fragmented': True, 'protocol': proto}
    elif kind == 0x86dd and len(packet) >= 40:
        if packet[0] >> 4 != 6:
            return {'invalidIp': True}
        offset, proto = 40, packet[6]
        source, target = str(ipaddress.ip_address(packet[8:24])), str(ipaddress.ip_address(packet[24:40]))
    else:
        return None
    record = {'source': source, 'target': target, 'protocol': proto}
    transport = packet[offset:]
    if proto in [6, 17] and len(transport) >= 8:
        record['sourcePort'], record['targetPort'] = struct.unpack('!HH', transport[:4])
        if proto == 17:
            payload = transport[8:]
            record['dnsNames'] = dns_names(payload)
            record['stun'] = len(payload) >= 20 and payload[:2] == b'\x00\x01' and payload[4:8] == b'\x21\x12\xa4\x42'
    return record


if __name__ == '__main__':
    output, ready = map(pathlib.Path, sys.argv[1:3])
    running = True
    def stop(*_):
        global running
        running = False
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    packets = []
    capture = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(3))
    capture.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 * 1024 * 1024)
    capture.settimeout(0.2)
    ready.write_text('ready')
    try:
        while running:
            try:
                data, address = capture.recvfrom(65535)
            except TimeoutError:
                continue
            if address[2] != socket.PACKET_OUTGOING:
                continue
            record = decode(data)
            if record:
                packets.append(record)
            if len(packets) > 100000:
                raise RuntimeError('capture_limit')
    finally:
        received, dropped = struct.unpack('II', capture.getsockopt(263, 6, 8))
        capture.close()
        output.write_text(json.dumps({'received': received, 'dropped': dropped, 'packets': packets}))
        output.chmod(0o600)
