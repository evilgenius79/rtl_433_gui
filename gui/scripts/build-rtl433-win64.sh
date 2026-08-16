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
# --fail keeps HTTP error pages out of the output file; verify the archive and
# retry once from scratch so a truncated download can't get cached (this bit CI once)
if [ ! -e libusb/include/libusb.h ]; then
    for attempt in 1 2; do
        [ -e libusb-${libusb_ver}.7z ] || curl -fL --retry 3 --retry-delay 2 -O \
            https://github.com/libusb/libusb/releases/download/v${libusb_ver}/libusb-${libusb_ver}.7z
        if 7z t libusb-${libusb_ver}.7z > /dev/null 2>&1; then
            break
        fi
        echo "libusb archive corrupt (attempt $attempt), re-downloading" >&2
        rm -f libusb-${libusb_ver}.7z
        [ "$attempt" = 2 ] && exit 1
    done
    mkdir -p libusb
    7z x -olibusb -y libusb-${libusb_ver}.7z > /dev/null
fi
cp libusb/include/libusb.h "$sysroot/usr/include"
cp libusb/MinGW64/static/libusb-1.0.a "$sysroot/usr/lib"

# librtlsdr (static)
if [ ! -d rtl-sdr-${rtlsdr_ver} ]; then
    git clone --depth 1 --branch v${rtlsdr_ver} https://github.com/osmocom/rtl-sdr rtl-sdr-${rtlsdr_ver}
fi
# rtl-sdr's CMake always links its tools against the SHARED librtlsdr; we ship
# rtl_adsb.exe and rtl_fm.exe and want them self-contained, so point them at
# the static target
sed -i \
    -e 's/target_link_libraries(rtl_adsb rtlsdr convenience_static/target_link_libraries(rtl_adsb rtlsdr_static convenience_static/' \
    -e 's/target_link_libraries(rtl_fm rtlsdr convenience_static/target_link_libraries(rtl_fm rtlsdr_static convenience_static/' \
    -e 's/target_link_libraries(rtl_power rtlsdr convenience_static/target_link_libraries(rtl_power rtlsdr_static convenience_static/' \
    -e 's/target_link_libraries(rtl_sdr rtlsdr convenience_static/target_link_libraries(rtl_sdr rtlsdr_static convenience_static/' \
    rtl-sdr-${rtlsdr_ver}/src/CMakeLists.txt
if [ ! -e "$sysroot/usr/lib/librtlsdr.a" ]; then
    export CMAKE_SYSROOT=$sysroot
    cmake -S rtl-sdr-${rtlsdr_ver} -B build-rtlsdr \
        -DCMAKE_TOOLCHAIN_FILE="$source_dir/cmake/Toolchain-gcc-mingw-w64-x86-64.cmake" \
        -DLIBUSB_FOUND=1 \
        -DLIBUSB_LIBRARIES="$sysroot/usr/lib/libusb-1.0.a" \
        -DLIBUSB_INCLUDE_DIRS="$sysroot/usr/include" \
        -DBUILD_SHARED_LIBS:BOOL=OFF \
        -DLINK_RTLTOOLS_AGAINST_STATIC_LIB=ON \
        -DCMAKE_EXE_LINKER_FLAGS="-static"
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

# radiosonde decoders from rs1729/RS (GPL-3): read FM-demodulated s16 audio
# on stdin and emit JSON telemetry per frame
if [ ! -d RS ]; then
    git clone --depth 1 https://github.com/rs1729/RS
fi
for dec in rs41mod dfm09mod m10mod m20mod imet54mod; do
    src="RS/demod/mod/${dec}.c"
    [ "$dec" = m20mod ] && src="RS/demod/mod/m10m20mod.c"
    x86_64-w64-mingw32-gcc -O2 -static -o ${dec}.exe \
        "$src" RS/demod/mod/demod_mod.c RS/demod/mod/bch_ecc_mod.c -lm -w
done

out="$gui_dir/vendor/rtl_433"
mkdir -p "$out"
cp "$sysroot/usr/bin/rtl_433.exe" "$out/rtl_433.exe"
# rtl_adsb feeds the aircraft map with raw Mode S frames; rtl_fm feeds the
# pager / radiosonde / AIS / listen pipelines; rtl_power feeds the spectrum
# scan; rtl_sdr streams raw IQ for the live FFT waterfall
cp "$sysroot/usr/bin/rtl_adsb.exe" "$out/rtl_adsb.exe"
cp "$sysroot/usr/bin/rtl_fm.exe" "$out/rtl_fm.exe"
cp "$sysroot/usr/bin/rtl_power.exe" "$out/rtl_power.exe"
cp "$sysroot/usr/bin/rtl_sdr.exe" "$out/rtl_sdr.exe"
cp rs41mod.exe dfm09mod.exe m10mod.exe m20mod.exe imet54mod.exe "$out/"
echo "Bundled binaries ready in $out: $(ls "$out" | tr '\n' ' ')"
