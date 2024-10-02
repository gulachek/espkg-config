# espkg-config

This package is intended to be a JavaScript utility for parsing pkg-config
files.

## License

This software is heavily inspired by the implementation of pkg-config. Beware
this has a GPL license, so for proprietary software, it's only appropriate to
use as a build tool (and not shipped with your distribution).

## Features

The 3 target use cases this package exposes are equivalents for:

```bash
pkg-config --cflags <mod1> <mod2> ...
pkg-config --libs <mod1> <mod2> ...
pkg-config --libs --static <mod1> <mod2> ...
```

The `PKG_CONFIG_PATH` search path configuration is supported via `searchPaths`.

Any other features are not planned to be supported, and issues can be opened to
request new features.
