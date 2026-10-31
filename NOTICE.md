# Sources and licenses

The recipe and patches are distributed under the MIT license in `LICENSE`.
Patched llama.cpp code also retains the ggml authors' MIT notice in
`LICENSES/llama.cpp.txt`. The server also includes nlohmann/json
(`LICENSES/json.hpp.txt`) and cpp-httplib (`LICENSES/cpp-httplib.txt`), both MIT.
External components keep their own licenses.

The image builds and pins:

- [halo-box/strix-llama.cpp](https://github.com/halo-box/strix-llama.cpp)
  `da731374077f2ad9bdffd4848f782b5694b9bb68`: llama.cpp fork, MIT license.
- [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp)
  `0ec4027a2a0183de87c007069adddc06e665f7de`: unmodified baseline, MIT license
  (`LICENSES/llama.cpp.txt`).
- [pwilkin/rocm-systems](https://github.com/pwilkin/rocm-systems)
  `5bdc7e255d1a1a8b6319df3621380722485af8ec` (`ilintar-experiments`):
  ROCr runtime (`projects/rocr-runtime`, NCSA license, `LICENSES/ROCr.txt`) and HIP runtime
  (`projects/clr`, `projects/hip`, MIT license, `LICENSES/HIP.txt`).
- Fedora 44 base images, AMD's ROCm 10.0.0-4 packages and the PyPI packages
  CppHeaderParser 2.7.4 and ply 3.11 (build only), under their own licenses.

The CMake options, the build checks and the `HSA_OVERRIDE_GFX_VERSION` and
`DEBUG_HIP_GRAPH_PM4` settings follow `install.sh` from
[pwilkin/strix-halo](https://github.com/pwilkin/strix-halo)
(`f73872fe20dfdef460653f18e2fe63e5366ae958`), under this license:

```text
MIT License

Copyright (c) 2026 ilintar

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The container layout and runtime settings were also informed by
[kyuz0/amd-strix-halo-toolboxes](https://github.com/kyuz0/amd-strix-halo-toolboxes).
That project has no license. This repository includes no files from it.
