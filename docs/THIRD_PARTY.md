# 第三方前端依赖

NovaCRM 本身为专有软件（见仓库根目录 `LICENSE`）；下列第三方组件按其各自的许可证授权。

| 文件 | 来源 | 许可证 | 用途 |
|---|---|---|---|
| `dingtalk-lite.js` | npm `dingtalk-jsapi@3.2.9`（仅 `core` 与 `api/runtime/permission/requestAuthCode`） | MIT | 钉钉客户端内免登，仅在钉钉 UA 下按需加载 |

重新生成：

```bash
mkdir /tmp/ddjs && cd /tmp/ddjs && npm init -y && npm i dingtalk-jsapi@3.2.9 esbuild@0.24.0
cat > entry.js <<'JS'
var core = require('dingtalk-jsapi/core');
var requestAuthCode = require('dingtalk-jsapi/api/runtime/permission/requestAuthCode').default;
window.ddLite = { env: core.env, ready: core.ready, error: core.error, requestAuthCode: requestAuthCode };
JS
npx esbuild entry.js --bundle --minify --format=iife --target=es2017 --outfile=dingtalk-lite.js
```

产物不含 `eval` / `new Function`，可在 `script-src 'self'` 的 CSP 下运行。

## dingtalk-jsapi 许可证全文

npm 包 `dingtalk-jsapi@3.2.9` 在 package.json 中声明为 MIT 许可（作者 junlong.hjl），包内未附带许可证文件，以下为 MIT 许可标准文本：

```
MIT License

Copyright (c) junlong.hjl

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
