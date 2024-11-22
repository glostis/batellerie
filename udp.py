import os
from pathlib import Path
from time import time

from pyais.stream import UDPReceiver

host = "0.0.0.0"
port = 12345


# https://stackoverflow.com/a/73195814
def read_n_to_last_line(filename, n=1):
    """Returns the nth before last line of a file (n=1 gives last line)"""
    num_newlines = 0
    with open(filename, "rb") as f:
        try:
            f.seek(-2, os.SEEK_END)
            while num_newlines < n:
                f.seek(-2, os.SEEK_CUR)
                if f.read(1) == b"\n":
                    num_newlines += 1
        except OSError:
            f.seek(0)
        last_line = f.readline().decode()
    return last_line


def main():
    p = Path("./messages.txt")
    p.touch()
    last_line = read_n_to_last_line(p)
    if last_line:
        last_id = int(last_line.split(" ")[0])
    else:
        last_id = 0
    current_id = last_id + 1
    for msg in UDPReceiver(host, port):
        print(int(time()))
        with open("messages.txt", "a") as f:
            f.write(f"{current_id} {int(time())} {msg.raw}\n")
        current_id += 1


if __name__ == "__main__":
    main()
