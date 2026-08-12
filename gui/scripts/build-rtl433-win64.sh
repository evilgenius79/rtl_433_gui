#!/bin/bash
# Cross-compiles a fully static 64-bit rtl_433.exe (librtlsdr + libusb built in)
# for bundling with the GUI, mirroring the static-x64 leg of .ci/scripts/do_sysroot.sh.
# Runs on Linux with gcc-mingw-w64-x86-64, cmake, 7z and curl.
# Output: gui/vendor/rtl_433/rtl_433.exe
set -e

libusb_ver=1.0.29
rtlsdr_ver=2.0.2

script_dir=$(dirname "$(realpath -s "$0")")
gui_dir=$(dirname "$script_dir")
source_dir=$(dirname "$gui_dir") # repo root (rtl_433 sources)
work=${RTL433_WIN_BUILD_DIR:-"$gui_dir/.win-build"}
sysroot="$work/sysroot64static"

mkdir -p "$work" "$sysroot/usr/include" "$sysroot/usr/lib" "$sysroot/usr/bin"
cd "$work"

# libusb (prebuilt static MinGW lib from the official release)
if [ ! -e libusb/include/libusb.h ]; then
    [ -e libusb-${libusb_ver}.7z ] || curl -L -O https://github.com/libusb/libusb/releases/download/v${libusb_ver}/libusb-${libusb_ver}.7z
    mkdir -p libusb
    7z x -olibusb -y libusb-${libusb_ver}.7z > /dev/null
fi
cp libusb/include/libusb.h "$sysroot/usr/include"
cp libusb/MinGW64/static/libusb-1.0.a "$sysroot/usr/lib"

# librtlsdr (static)
if [ ! -d rtl-sdr-${rtlsdr_ver} ]; then
    git clone --depth 1 --branch v${rtlsdr_ver} https://github.com/osmocom/rtl-sdr rtl-sdr-${rtlsdr_ver}
fi
if [ ! -e "$sysroot/usr/lib/librtlsdr.a" ]; then
    export CMAKE_SYSROOT=$sysroot
    cmake -S rtl-sdr-${rtlsdr_ver} -B build-rtlsdr \
        -DCMAKE_TOOLCHAIN_FILE="$source_dir/cmake/Toolchain-gcc-mingw-w64-x86-64.cmake" \
        -DLIBUSB_FOUND=1 \
        -DLIBUSB_LIBRARIES="$sysroot/usr/lib/libusb-1.0.a" \
        -DLIBUSB_INCLUDE_DIRS="$sysroot/usr/include" \
        -DBUILD_SHARED_LIBS:BOOL=OFF
    cmake --build build-rtlsdr
    cmake --install build-rtlsdr
    rm -rf build-rtlsdr
    mv "$sysroot/usr/lib/librtlsdr_static.a" "$sysroot/usr/lib/librtlsdr.a"
    rm -f "$sysroot/usr/lib/librtlsdr.dll.a" "$sysroot/usr/bin/librtlsdr.dll"
fi

# rtl_433 (static)
export CMAKE_SYSROOT=$sysroot
cmake -S "$source_dir" -B build-rtl433 \
    -DCMAKE_TOOLCHAIN_FILE="$source_dir/cmake/Toolchain-gcc-mingw-w64-x86-64.cmake" \
    -DENABLE_RTLSDR=ON
cmake --build build-rtl433
cmake --install build-rtl433
rm -rf build-rtl433

out="$gui_dir/vendor/rtl_433"
mkdir -p "$out"
cp "$sysroot/usr/bin/rtl_433.exe" "$out/rtl_433.exe"
echo "Bundled binary ready: $out/rtl_433.exe"
