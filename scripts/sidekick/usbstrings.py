import fcntl, struct, ctypes, os, glob
dev = [p for p in glob.glob("/dev/bus/usb/*/*")
       if open(f"/sys/bus/usb/devices/{os.path.basename(os.path.dirname(p)).lstrip('0') or '0'}-1/devnum").read().strip() == str(int(os.path.basename(p)))][0] if False else "/dev/bus/usb/001/019"
fd = os.open(dev, os.O_RDWR)
buf = ctypes.create_string_buffer(255)
for i in range(1, 20):
    r = bytearray(struct.pack("=BBHHHI4xQ", 0x80, 6, (3 << 8) | i, 0x0409, 255, 1000, ctypes.addressof(buf)))
    try:
        fcntl.ioctl(fd, 0xC0185500, r, True)
    except OSError as e:
        print(f"str {i:2d}: <{e.strerror}>"); continue
    print(f"str {i:2d}: {buf.raw[2:buf.raw[0]].decode('utf-16-le')!r}")
