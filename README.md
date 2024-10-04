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

This implementation makes no attempt to remove -I flags that might include directories
known to gcc or msvc (like `CPATH`, `C_INCLUDE_PATH`, etc). This is equivalent to having
the `PKG_CONFIG_ALLOW_SYSTEM_CFLAGS` environment variable set.

There is also no feature to override package variables like `pkg-config`
allows with `PKG_CONFIG_$PACKAGENAME_$VARIABLE`.

`pkg-config` seemingly by default on Windows has an `ENABLE_DEFINE_PREFIX` configuration
variable. When enabled, it seems to attempt to override the `prefix` variable defined in
the `.pc` file with the file's grandparent directory only if the `.pc` file's parent
directory's basename is `pkgconfig`. Then, subsequent variable definitions that begin
with the prefix as the beginning of the variable substitute with this overriden prefix
as well. This is not currently supported by this package because behavior should be
consistent between platforms. An opt-in feature can be requested if there is a very
compelling case for this that the user can choose to set if running on Windows.

Any other features are not planned to be supported, and issues can be opened to
request new features.
