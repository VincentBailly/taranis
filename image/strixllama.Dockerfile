ARG LLAMA_COMMIT=6c9c7573c449a9961904cf4bd3414365df14e517
FROM registry.fedoraproject.org/fedora@sha256:b96f024cecbe9515eb049107d2856e7ad923f7aac09a3c90e7a0d52a46fa3454 AS build
ARG LLAMA_COMMIT
ARG BUILD_JOBS=8
RUN dnf -y --nodocs --setopt=install_weak_deps=False install \
      cmake ninja-build gcc gcc-c++ git-core pkgconf-pkg-config \
      vulkan-loader-devel vulkan-headers glslc spirv-headers-devel openssl-devel \
    && dnf clean all
RUN set -eux; git init -q /src/llama; \
    git -C /src/llama fetch -q --filter=blob:none https://github.com/halo-box/strix-llama.cpp.git "$LLAMA_COMMIT"; \
    git -C /src/llama -c advice.detachedHead=false checkout -q --detach FETCH_HEAD; \
    test "$(git -C /src/llama rev-parse HEAD)" = "$LLAMA_COMMIT"; \
    cmake -S /src/llama -B /build/llama -G Ninja -DCMAKE_BUILD_TYPE=Release \
      -DGGML_VULKAN=ON -DGGML_HIP=OFF -DGGML_CUDA=OFF \
      -DLLAMA_BUILD_TESTS=OFF -DGGML_BUILD_TESTS=OFF; \
    cmake --build /build/llama --parallel "$BUILD_JOBS" --target llama-server; \
    test -z "$(git -C /src/llama status --porcelain)"; \
    mkdir -p /out/bin /out/lib /out/licenses; \
    cp /build/llama/bin/llama-server /out/bin/; cp -a /build/llama/bin/lib*.so* /out/lib/; \
    cp /src/llama/LICENSE /out/licenses/llama.cpp; \
    cd /src/llama; find vendor -type f -iname '*license*' -exec cp --parents '{}' /out/licenses/ \;; \
    { echo "llama_cpp_repo=https://github.com/halo-box/strix-llama.cpp.git"; \
      echo "llama_cpp=$LLAMA_COMMIT"; echo "apply_patches=0"; echo "backend=Vulkan"; \
      echo "# build RPMs"; rpm -qa | sort; } > /out/versions.txt

FROM registry.fedoraproject.org/fedora-minimal@sha256:40a8775ff8dfedd68dedc953e3e7f286c4ee0044bfdd79837d77159c02f52b9f
ARG LLAMA_COMMIT
RUN dnf -y --nodocs --setopt=install_weak_deps=False install \
      mesa-vulkan-drivers vulkan-loader libstdc++ libgomp openssl-libs ca-certificates \
    && dnf clean all
COPY --from=build /out/bin/ /usr/local/bin/
COPY --from=build /out/lib/ /usr/local/lib64/
COPY --from=build /out/licenses/ /usr/share/licenses/strix-llama/
COPY --from=build /out/versions.txt /opt/llama/versions.txt
ENV LD_LIBRARY_PATH=/usr/local/lib64 \
    VK_DRIVER_FILES=/usr/share/vulkan/icd.d/radeon_icd.x86_64.json
RUN set -eu; test -f "$VK_DRIVER_FILES"; \
    ldd /usr/local/bin/llama-server /usr/local/lib64/libggml-vulkan.so.0 > /tmp/ldd; \
    if grep -F 'not found' /tmp/ldd; then exit 1; fi; rm /tmp/ldd; \
    { echo "# runtime RPMs"; rpm -qa | sort; } >> /opt/llama/versions.txt
LABEL org.opencontainers.image.source="https://github.com/halo-box/strix-llama.cpp" \
      org.opencontainers.image.revision="$LLAMA_COMMIT" \
      org.opencontainers.image.licenses="MIT"
ENTRYPOINT ["/usr/local/bin/llama-server"]
