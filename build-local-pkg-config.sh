#!/bin/sh

PKG="pkg-config-0.29.2"

curl -O "https://pkgconfig.freedesktop.org/releases/$PKG.tar.gz" || exit 1
tar xfvz "$PKG.tar.gz" || exit 1
rm "$PKG.tar.gz"

cd "$PKG"
./configure CFLAGS="-g" && make
