import pyvips

print("pyvips:", pyvips.__version__)
print(
    "libvips:",
    pyvips.version(0),
    pyvips.version(1),
    pyvips.version(2),
)