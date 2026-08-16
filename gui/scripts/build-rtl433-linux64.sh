#!/bin/bash
# Builds the native Linux receiver binaries bundled with the GUI's Linux
# packages: rtl_433, the rtl-sdr tools (rtl_fm, rtl_adsb, rtl_power, rtl_sdr)
# linked against a static librtlsdr, and the rs1729/RS radiosonde decoders.
# librtlsdr is linked statically; libusb-1.0 stays a (ubiquitous) system dep.
# Requires: gcc, cmake, git, libusb-1.0-0-dev.
# Output: gui/vendor-linux/rtl_433/
set -e

rtlsdr_ver=2.0.2

script_dir=$(dirname "$(realpath -s "$0")")
gui_dir=$(dirname "$script_dir")
source_dir=$(dirname "$gui_dir") # repo root (rtl_433 sources)
work=${RTL433_LINUX_BUILD_DIR:-"$gui_dir/.linux-build"}
prefix="$work/prefix"

mkdir -p "$work" "$prefix"
cd "$work"

# librtlsdr (static) + statically-linked rtl-sdr tools
if [ ! -d rtl-sdr-${rtlsdr_ver} ]; then
    git clone --depth 1 --branch v${rtlsdr_ver} https://github.com/osmocom/rtl-sdr rtl-sdr-${rtlsdr_ver}
fi
# rtl-sdr's CMake links its tools against the SHARED librtlsdr; point the
# tools we ship at the static target instead (same patch as the MinGW build)
sed -i \
    -e 's/target_link_libraries(rtl_adsb rtlsdr convenience_static/target_link_libraries(rtl_adsb rtlsdr_static convenience_static/' \
    -e 's/target_link_libraries(rtl_fm rtlsdr convenience_static/target_link_libraries(rtl_fm rtlsdr_static convenience_static/' \
    -e 's/target_link_libraries(rtl_power rtlsdr convenience_static/target_link_libraries(rtl_power rtlsdr_static convenience_static/' \
    -e 's/target_link_libraries(rtl_sdr rtlsdr convenience_static/target_link_libraries(rtl_sdr rtlsdr_static convenience_static/' \
    rtl-sdr-${rtlsdr_ver}/src/CMakeLists.txt
cmake -S rtl-sdr-${rtlsdr_ver} -B build-rtlsdr \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="$prefix" \
    -DDETACH_KERNEL_DRIVER=ON \
    -DINSTALL_UDEV_RULES=OFF
cmake --build build-rtlsdr -j"$(nproc)"
cmake --install build-rtlsdr

# rtl_433 against the static librtlsdr
cmake -S "$source_dir" -B build-rtl433 \
    -DCMAKE_BUILD_TYPE=Release \
    -DENABLE_RTLSDR=ON \
    -DCMAKE_PREFIX_PATH="$prefix"
cmake --build build-rtl433 -j"$(nproc)"

# radiosonde decoders from rs1729/RS (GPL-3)
if [ ! -d RS ]; then
    git clone --depth 1 https://github.com/rs1729/RS
fi
for dec in rs41mod dfm09mod m10mod m20mod imet54mod; do
    src="RS/demod/mod/${dec}.c"
    [ "$dec" = m20mod ] && src="RS/demod/mod/m10m20mod.c"
    gcc -O2 -o ${dec} "$src" RS/demod/mod/demod_mod.c RS/demod/mod/bch_ecc_mod.c -lm -w
done

out="$gui_dir/vendor-linux/rtl_433"
mkdir -p "$out"
cp build-rtl433/src/rtl_433 "$out/"
# prefer the statically-linked tool builds from the build tree
cp build-rtlsdr/src/rtl_fm build-rtlsdr/src/rtl_adsb build-rtlsdr/src/rtl_power build-rtlsdr/src/rtl_sdr "$out/"
cp rs41mod dfm09mod m10mod m20mod imet54mod "$out/"
strip "$out"/* 2>/dev/null || true
echo "Bundled Linux binaries ready in $out: $(ls "$out" | tr '\n' ' ')"