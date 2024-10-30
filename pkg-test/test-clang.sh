#!/bin/sh

mkdir -p bin lib pkgconfig

# Make library
clang -Iinclude -c hard_math.c -o bin/hard_math.o
clang --emit-static-lib -o lib/libhard_math.a bin/hard_math.o

cat <<EOF > pkgconfig/hard_math.pc
Name: Hard Math
Description: Test library that does hard math functions
Version: 1.2.3

Cflags: -Iinclude
Libs: -Llib -lhard_math
EOF

# Compile/link exe using espkg-config
node build-clang.js

bin/main
