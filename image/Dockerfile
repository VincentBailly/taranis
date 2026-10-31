# AMD gfx1151 llama-server: optimized Taranis or unmodified upstream baseline.
# Build with build.ts; NOTICE.md lists the sources.

ARG APPLY_PATCHES=1
ARG STOCK_LLAMA_COMMIT=0ec4027a2a0183de87c007069adddc06e665f7de
ARG LLAMA_COMMIT=da731374077f2ad9bdffd4848f782b5694b9bb68
ARG ROCM_SYSTEMS_COMMIT=5bdc7e255d1a1a8b6319df3621380722485af8ec
# Every installed amdrocm* package, dependencies included, must be exactly this version.
ARG ROCM_RPM_VERSION=10.0.0-4
ARG AMD_REPO_FINGERPRINT=D0F004A0025A1145C7807FCD0701EAC4D5E02107
ARG ROCM=/opt/rocm/core-10.0

FROM registry.fedoraproject.org/fedora@sha256:b96f024cecbe9515eb049107d2856e7ad923f7aac09a3c90e7a0d52a46fa3454 AS build-deps
ARG LLAMA_COMMIT ROCM_SYSTEMS_COMMIT ROCM_RPM_VERSION AMD_REPO_FINGERPRINT ROCM APPLY_PATCHES
ARG BUILD_JOBS=16
COPY image/amd-rocm.asc /etc/pki/rpm-gpg/RPM-GPG-KEY-amd-rocm
COPY image/rocm.repo /etc/yum.repos.d/rocm.repo
# The committed key must be AMD's signing key and nothing else.
RUN set -eu; gpg --show-keys --with-colons /etc/pki/rpm-gpg/RPM-GPG-KEY-amd-rocm > /tmp/key; \
    test "$(grep -c '^pub:' /tmp/key)" = 1; \
    test "$(awk -F: '$1 == "fpr" { print $10; exit }' /tmp/key)" = "$AMD_REPO_FINGERPRINT"; rm /tmp/key
RUN dnf -y --nodocs --setopt=install_weak_deps=False install \
      cmake ninja-build gcc gcc-c++ git-core pkgconf-pkg-config python3 python3-setuptools vim-common \
      elfutils-libelf-devel libdrm-devel libglvnd-devel libzstd-devel numactl-devel openssl-devel zlib-devel \
      "amdrocm-core-devel10.0-gfx1151-$ROCM_RPM_VERSION" "amdrocm10.0-gfx1151-$ROCM_RPM_VERSION" \
  && dnf clean all \
  && rpm -q "gpg-pubkey-$(echo "$AMD_REPO_FINGERPRINT" | tr A-F a-f)" \
  && rpm -qa --qf '%{VERSION}-%{RELEASE}\n' 'amdrocm*' | sort -u > /tmp/rocm-versions \
  && { [ "$(cat /tmp/rocm-versions)" = "$ROCM_RPM_VERSION" ] || { echo "amdrocm packages are not all $ROCM_RPM_VERSION:" >&2; rpm -qa 'amdrocm*' >&2; exit 1; }; } \
  && rm /tmp/rocm-versions
ENV ROCM_PATH=$ROCM HIP_PATH=$ROCM PATH=$ROCM/bin:$ROCM/lib/llvm/bin:$PATH \
    LD_LIBRARY_PATH=$ROCM/lib/rocm_sysdeps/lib:$ROCM/lib

FROM build-deps AS build

# Both builds read version data from git, so keep history but skip unneeded blobs.
RUN set -eux; checkout() { git init -q "$3"; git -C "$3" fetch -q --filter=blob:none "$1" "$2"; \
      git -C "$3" -c advice.detachedHead=false checkout -q --detach FETCH_HEAD; test "$(git -C "$3" rev-parse HEAD)" = "$2"; }; \
    checkout https://github.com/pwilkin/rocm-systems.git "$ROCM_SYSTEMS_COMMIT" /src/rocm; \
    checkout https://github.com/halo-box/strix-llama.cpp.git "$LLAMA_COMMIT" /src/llama; \
    git -C /src/rocm grep -q -e DEBUG_HIP_GRAPH_PM4 -- projects/clr

COPY image/requirements.txt /tmp/requirements.txt
RUN python3 -m venv --system-site-packages /venv \
  && /venv/bin/pip install --no-cache-dir --no-build-isolation --require-hashes -r /tmp/requirements.txt

RUN set -eux; export PATH=/venv/bin:$PATH; \
    cmake -S /src/rocm/projects/rocr-runtime -B /build/rocr -G Ninja -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/opt/taranis/rocr -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_PREFIX_PATH=$ROCM -DBUILD_SHARED_LIBS=ON; \
    cmake --build /build/rocr --parallel "$BUILD_JOBS"; cmake --install /build/rocr; \
    test -e /opt/taranis/rocr/lib/libhsa-runtime64.so.1
RUN set -eux; export PATH=/venv/bin:$PATH LD_LIBRARY_PATH=/opt/taranis/rocr/lib:$ROCM/lib:$ROCM/lib/llvm/lib; \
    cmake -S /src/rocm/projects/clr -B /build/hip -G Ninja -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/opt/taranis/hip -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_PREFIX_PATH="/opt/taranis/rocr;$ROCM" \
      -DCLR_BUILD_HIP=ON -DCLR_BUILD_OCL=OFF -DHIP_PLATFORM=amd -DHIP_COMMON_DIR=/src/rocm/projects/hip \
      -DHIPCC_BIN_DIR=$ROCM/bin -DLLVM_ROOT=$ROCM/lib/llvm -DClang_ROOT=$ROCM/lib/llvm \
      -DROCM_PATH=/opt/taranis/rocr -Dhsa-runtime64_DIR=/opt/taranis/rocr/lib/cmake/hsa-runtime64 \
      -DROCCLR_ENABLE_HSA=ON -DROCCLR_ENABLE_PAL=OFF -DHIP_ENABLE_ROCPROFILER_REGISTER=ON -DUSE_PROF_API=ON -D__HIP_ENABLE_PCH=ON; \
    cmake --build /build/hip --parallel "$BUILD_JOBS"; cmake --install /build/hip; \
    test -e /opt/taranis/hip/lib/libamdhip64.so.7

COPY image/*.patch image/series /tmp/patches/
RUN set -eu; case "$APPLY_PATCHES" in \
      1) while read -r patch; do git -C /src/llama apply --check "/tmp/patches/$patch"; \
           git -C /src/llama apply "/tmp/patches/$patch"; done < /tmp/patches/series ;; \
      0) ;; \
      *) echo "APPLY_PATCHES must be 0 or 1" >&2; exit 1 ;; \
    esac

RUN set -eux; \
    cmake -S /src/llama -B /build/llama -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH=$ROCM \
      -DGGML_HIP=ON -DGPU_TARGETS=gfx1151 -DGGML_HIP_GRAPHS=ON -DGGML_HIP_NO_VMM=ON -DGGML_HIP_MMQ_MFMA=ON \
      -DGGML_HIP_RCCL=OFF -DGGML_CUDA_FA=ON -DGGML_CUDA_FA_ALL_QUANTS=OFF -DGGML_VULKAN=OFF -DLLAMA_BUILD_TESTS=ON; \
    cmake --build /build/llama --parallel "$BUILD_JOBS" --target llama-server test-backend-sched-ring; \
    /build/llama/bin/test-backend-sched-ring; \
    LD_LIBRARY_PATH=/opt/taranis/hip/lib:/opt/taranis/rocr/lib:$ROCM/lib:$ROCM/lib/llvm/lib:/build/llama/bin \
      ldd /build/llama/bin/libggml-hip.so.0 > /tmp/ldd; \
    grep -F /opt/taranis/hip/lib/libamdhip64.so /tmp/ldd; grep -F /opt/taranis/rocr/lib/libhsa-runtime64.so /tmp/ldd; \
    mkdir -p /out/bin /out/lib /out/taranis; \
    cp /build/llama/bin/llama-server /out/bin/; cp -a /build/llama/bin/lib*.so* /out/lib/; \
    cp -a /opt/taranis/rocr/lib/libhsa-runtime64.so* /opt/taranis/hip/lib/libamdhip64.so* /opt/taranis/hip/lib/libhiprtc*.so* /out/taranis/; \
    { echo "apply_patches=$APPLY_PATCHES"; echo "llama_cpp=$LLAMA_COMMIT"; echo "rocm_systems=$ROCM_SYSTEMS_COMMIT"; echo "# build stage"; rpm -qa 'amdrocm*' | sort; } > /out/versions.txt

FROM build-deps AS baseline-build
ARG STOCK_LLAMA_COMMIT
RUN set -eux; git init -q /src/llama; \
    git -C /src/llama fetch -q --filter=blob:none https://github.com/ggml-org/llama.cpp.git "$STOCK_LLAMA_COMMIT"; \
    git -C /src/llama -c advice.detachedHead=false checkout -q --detach FETCH_HEAD; \
    test "$(git -C /src/llama rev-parse HEAD)" = "$STOCK_LLAMA_COMMIT"
RUN set -eux; \
    cmake -S /src/llama -B /build/llama -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH=$ROCM \
      -DCMAKE_HIP_COMPILER=$ROCM/lib/llvm/bin/clang++ -DCMAKE_HIP_COMPILER_ROCM_ROOT=$ROCM \
      -DGGML_HIP=ON -DGPU_TARGETS=gfx1151 -DGGML_HIP_GRAPHS=ON -DGGML_HIP_NO_VMM=ON -DGGML_HIP_MMQ_MFMA=ON \
      -DGGML_HIP_RCCL=OFF -DGGML_CUDA_FA=ON -DGGML_CUDA_FA_ALL_QUANTS=OFF -DGGML_VULKAN=OFF \
      -DLLAMA_BUILD_TESTS=OFF -DGGML_BUILD_TESTS=OFF; \
    cmake --build /build/llama --parallel "$BUILD_JOBS" --target llama-server; \
    test -z "$(git -C /src/llama status --porcelain)"; \
    mkdir -p /out/bin /out/lib; \
    cp /build/llama/bin/llama-server /out/bin/; cp -a /build/llama/bin/lib*.so* /out/lib/; \
    { echo "apply_patches=0"; echo "llama_cpp_repo=https://github.com/ggml-org/llama.cpp.git"; \
      echo "llama_cpp=$STOCK_LLAMA_COMMIT"; echo "hip_rocr=packaged"; echo "# build stage"; rpm -qa 'amdrocm*' | sort; } > /out/versions.txt

FROM registry.fedoraproject.org/fedora-minimal@sha256:40a8775ff8dfedd68dedc953e3e7f286c4ee0044bfdd79837d77159c02f52b9f AS runtime-deps
ARG ROCM_RPM_VERSION AMD_REPO_FINGERPRINT ROCM
COPY image/amd-rocm.asc /etc/pki/rpm-gpg/RPM-GPG-KEY-amd-rocm
COPY image/rocm.repo /etc/yum.repos.d/rocm.repo
RUN dnf -y --nodocs --setopt=install_weak_deps=False install \
      "amdrocm10.0-gfx1151-$ROCM_RPM_VERSION" ca-certificates elfutils-libs libatomic libdrm libgomp libstdc++ numactl-libs \
  && dnf clean all \
  && rpm -q "gpg-pubkey-$(echo "$AMD_REPO_FINGERPRINT" | tr A-F a-f)" \
  && rpm -qa --qf '%{VERSION}-%{RELEASE}\n' 'amdrocm*' | sort -u > /tmp/rocm-versions \
  && { [ "$(cat /tmp/rocm-versions)" = "$ROCM_RPM_VERSION" ] || { echo "amdrocm packages are not all $ROCM_RPM_VERSION:" >&2; rpm -qa 'amdrocm*' >&2; exit 1; }; } \
  && rm /tmp/rocm-versions
ENV ROCM_PATH=$ROCM HIP_PATH=$ROCM \
    LD_LIBRARY_PATH=/usr/local/lib64:$ROCM/lib/rocm_sysdeps/lib:$ROCM/lib
COPY LICENSE NOTICE.md /usr/share/licenses/taranis/
COPY LICENSES/ /usr/share/licenses/taranis/third-party/
ENTRYPOINT ["/usr/local/bin/llama-server"]

FROM runtime-deps AS baseline
COPY --from=baseline-build /out/bin/ /usr/local/bin/
COPY --from=baseline-build /out/lib/ /usr/local/lib64/
COPY --from=baseline-build /out/versions.txt /opt/taranis/versions.txt
RUN set -eu; { echo "# runtime image"; rpm -qa 'amdrocm*' | sort; } >> /opt/taranis/versions.txt; \
    ldd /usr/local/bin/llama-server /usr/local/lib64/libggml-hip.so.0 > /tmp/ldd; \
    if grep -F 'not found' /tmp/ldd; then exit 1; fi; \
    grep -F "libamdhip64.so.7 => $ROCM/lib/" /tmp/ldd; \
    grep -F "libhsa-runtime64.so.1 => $ROCM/lib/" /tmp/ldd; rm /tmp/ldd

FROM runtime-deps AS optimized
COPY --from=build /out/bin/ /usr/local/bin/
COPY --from=build /out/lib/ /usr/local/lib64/
COPY --from=build /out/taranis/ /opt/taranis/lib/
COPY --from=build /out/versions.txt /opt/taranis/versions.txt
RUN { echo "# runtime image"; rpm -qa 'amdrocm*' | sort; } >> /opt/taranis/versions.txt
# /opt/taranis/lib leads the search path so the PM4 builds of libamdhip64 and libhsa-runtime64
# win over the packaged ones. The two GPU settings match pwilkin/strix-halo's launcher.
ENV ROCM_PATH=$ROCM HIP_PATH=$ROCM \
    LD_LIBRARY_PATH=/opt/taranis/lib:/usr/local/lib64:$ROCM/lib/rocm_sysdeps/lib:$ROCM/lib \
    HSA_OVERRIDE_GFX_VERSION=11.5.1 DEBUG_HIP_GRAPH_PM4=1
RUN set -eu; ldd /usr/local/bin/llama-server /usr/local/lib64/libggml-hip.so.0 /opt/taranis/lib/libamdhip64.so.7 > /tmp/ldd; \
    if grep -F 'not found' /tmp/ldd; then exit 1; fi; \
    grep -Eq '^\s*libamdhip64\.so\.7 => /opt/taranis/lib/' /tmp/ldd; grep -Eq '^\s*libhsa-runtime64\.so\.1 => /opt/taranis/lib/' /tmp/ldd; rm /tmp/ldd
