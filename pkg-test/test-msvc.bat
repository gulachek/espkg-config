if not exist "bin" mkdir bin
if not exist "lib" mkdir lib
if not exist "pkgconfig" mkdir pkgconfig

REM Make library
cl.exe -I"include" /c hard_math.c -Fo".\bin\hard_math.obj"
lib.exe /OUT:".\lib\hard_math.lib" .\bin\hard_math.obj

copy .\hard_math.msvc.pc .\pkgconfig\hard_math.pc

REM Compile/link exe using espkg-config
node build-msvc.js

.\bin\main.exe
